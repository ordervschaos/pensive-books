// manuscriptAgent — client surface for the book's manuscript agent (kind='manuscript' row in
// book_agent_runs, driven by the manuscript-agent edge fn) and the ONE write path for its staged changes.
//
// The agent only ever STAGES changes (row.proposals); every write to books/pages happens here, in the
// author's browser, on an explicit accept — whole change, whole page, one block, or one word hunk.
// The canvas (components/canvas) computes the diff live and calls resolvePartial/acceptChange/rejectChange.
import { supabase } from "@/integrations/supabase/client";
import type { TaskRow } from "@/hooks/useLatestTaskRow";
import type { EditorJSON } from "@/types/editor";
import { bodyText, docFromBody } from "./manuscriptText";

// ── Shapes (mirror supabase/functions/manuscript-agent/shared.ts) ──
export type ManuscriptChange =
  | { id: string; kind: "page_edit"; pageId: number; title?: string | null; before: string; after: string; note?: string }
  | { id: string; kind: "page_add"; afterPageId: number | null; pageType: "text" | "section"; title: string; text: string; note?: string }
  | { id: string; kind: "page_delete"; pageId: number; note?: string }
  | { id: string; kind: "book_edit"; field: "name" | "subtitle" | "author"; before: string; after: string; note?: string };

export interface ManuscriptStep {
  t: "user" | "note" | "read" | "ask" | "answer" | "plan" | "done" | "finding" | "action" | "applied" | "discarded";
  label: string;
  options?: string[];
  findings?: { ref: string; finding: string }[];
  action?: "publish" | "open_page" | "open_studio";
  pageId?: number;
  change?: ManuscriptChange; // on applied/discarded — the resolved change, for the collapsed card
}

export interface ManuscriptRunRow extends TaskRow {
  kind: string;
  steps: ManuscriptStep[] | null;
  pending: { question: string; options?: string[] } | null;
  proposals: ManuscriptChange[] | null;
  report: string | null;
  cancel_requested: boolean;
  error: string | null;
  context_model: string | null;
  title: string | null;
}
export const MANUSCRIPT_RUN_SELECT = "id, book_id, kind, status, created_at, updated_at, steps, pending, proposals, report, cancel_requested, error, context_model, title";

export interface ManuscriptPage { id: number; page_index: number; page_type: "text" | "section"; title: string | null; content: EditorJSON | null; updated_at?: string | null }
export interface ManuscriptBook { id: number; name: string; subtitle: string | null; author: string | null; is_public: boolean; cover_url?: string | null }

// ── Edge fn calls ──
async function invoke(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke("manuscript-agent", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
}
/** Send a message to the book's manuscript thread (creates it on first use). `model` = a tier key or "default". */
export async function sendManuscriptMessage(bookId: number, message: string, model?: string | null): Promise<void> {
  await invoke({ bookId, message, model: model && model !== "default" ? model : null });
}
/** Answer the agent's pending question, resuming the parked turn. */
export async function answerManuscriptAgent(runId: number, answer: string): Promise<void> {
  await invoke({ runId, answer });
}

// ── Page writes ──
const nowIso = () => new Date().toISOString();

/** Write a page's title + body text back as a (format-preserving) doc. */
export async function writePageBody(page: ManuscriptPage, title: string, body: string): Promise<void> {
  const content = docFromBody(page.content, title, body);
  const { error } = await supabase.from("pages").update({ title: title.trim() || "Untitled", content, updated_at: nowIso() }).eq("id", page.id);
  if (error) throw new Error(error.message);
}

/** Save an in-place editor doc (the author typing on the canvas). */
export async function savePageDoc(pageId: number, doc: EditorJSON, title: string): Promise<void> {
  const { error } = await supabase.from("pages").update({ title: title.trim() || "Untitled", content: doc, updated_at: nowIso() }).eq("id", pageId);
  if (error) throw new Error(error.message);
}

// Renumber pages to `orderedIds`. Two phases through a negative temp range so the partial unique index
// (book_id, page_index) WHERE archived=false can never see two live pages on one index mid-shift.
async function reorderPages(bookId: number, orderedIds: number[], current: Map<number, number>): Promise<void> {
  const moving = orderedIds.map((id, idx) => ({ id, idx })).filter(({ id, idx }) => current.get(id) !== idx);
  if (!moving.length) return;
  const park = moving.map(({ id }, i) => ({ id, book_id: bookId, page_index: -(i + 1) }));
  const { error: e1 } = await supabase.from("pages").upsert(park);
  if (e1) throw new Error(e1.message);
  const final = moving.map(({ id, idx }) => ({ id, book_id: bookId, page_index: idx }));
  const { error: e2 } = await supabase.from("pages").upsert(final);
  if (e2) throw new Error(e2.message);
}

async function addPage(bookId: number, c: Extract<ManuscriptChange, { kind: "page_add" }>, pages: ManuscriptPage[]): Promise<number> {
  const { data, error } = await supabase.rpc("create_next_page", { p_book_id: bookId }).select().single();
  if (error) throw new Error(error.message);
  const id = (data as { id: number }).id;
  const content = docFromBody(null, c.title, c.pageType === "section" ? "" : c.text);
  const { error: e2 } = await supabase.from("pages").update({ title: c.title, page_type: c.pageType, content, updated_at: nowIso() }).eq("id", id);
  if (e2) throw new Error(e2.message);
  const live = [...pages].sort((a, b) => a.page_index - b.page_index).map((p) => p.id);
  const at = c.afterPageId == null ? 0 : live.indexOf(c.afterPageId) + 1;
  const ordered = [...live.slice(0, at), id, ...live.slice(at)];
  const current = new Map(pages.map((p) => [p.id, p.page_index]));
  current.set(id, live.length); // the RPC appended it at the end
  await reorderPages(bookId, ordered, current);
  return id;
}

async function deletePage(bookId: number, pageId: number, pages: ManuscriptPage[]): Promise<void> {
  const { error } = await supabase.from("pages").update({ archived: true, updated_at: nowIso() }).eq("id", pageId);
  if (error) throw new Error(error.message);
  const remaining = [...pages].filter((p) => p.id !== pageId).sort((a, b) => a.page_index - b.page_index).map((p) => p.id);
  await reorderPages(bookId, remaining, new Map(pages.map((p) => [p.id, p.page_index])));
}

async function editBook(bookId: number, field: "name" | "subtitle" | "author", value: string): Promise<void> {
  const { error } = await supabase.from("books").update({ [field]: value, updated_at: nowIso() }).eq("id", bookId);
  if (error) throw new Error(error.message);
}

// ── Resolution on the run row ──
// Fresh read-modify-write: a concurrent resolver (second tab) is detected and this becomes a no-op.
// `patch` replaces the change (a partial accept leaves the rest staged); null removes it and leaves a
// collapsed applied/discarded card in the feed — state change, not erasure.
async function updateChange(runId: number, change: ManuscriptChange, verb: "applied" | "discarded" | null, patch: ManuscriptChange | null, label: string): Promise<void> {
  const { data } = await supabase.from("book_agent_runs").select("steps, proposals").eq("id", runId).maybeSingle();
  const steps = Array.isArray(data?.steps) ? (data!.steps as ManuscriptStep[]) : [];
  const current = Array.isArray(data?.proposals) ? (data!.proposals as ManuscriptChange[]) : [];
  if (!current.some((p) => p.id === change.id)) return;
  const proposals = patch ? current.map((p) => (p.id === change.id ? patch : p)) : current.filter((p) => p.id !== change.id);
  const nextSteps = verb ? [...steps, { t: verb, label, change } as ManuscriptStep] : steps;
  const { error } = await supabase.from("book_agent_runs").update({ steps: nextSteps, proposals }).eq("id", runId);
  if (error) throw new Error(error.message);
}

export function changeLabel(c: ManuscriptChange, pages: ManuscriptPage[]): string {
  const p = (id: number) => { const pg = pages.find((x) => x.id === id); return pg ? `p${pg.page_index + 1} "${(pg.title ?? "").trim() || "Untitled"}"` : `page #${id}`; };
  switch (c.kind) {
    case "page_edit": return `${c.title != null ? "retitle + edit" : "edit"} ${p(c.pageId)}`;
    case "page_add": return `add ${c.pageType === "section" ? "section" : "page"} "${c.title}"`;
    case "page_delete": return `delete ${p(c.pageId)}`;
    case "book_edit": return `${c.field} → "${c.after}"`;
  }
}

/** Accept a change whole. */
export async function acceptChange(bookId: number, runId: number, c: ManuscriptChange, pages: ManuscriptPage[]): Promise<void> {
  const label = changeLabel(c, pages);
  if (c.kind === "page_edit") {
    const page = pages.find((p) => p.id === c.pageId);
    if (!page) throw new Error("That page is no longer in the book.");
    await writePageBody(page, c.title ?? page.title ?? "", c.after);
  } else if (c.kind === "page_add") {
    await addPage(bookId, c, pages);
  } else if (c.kind === "page_delete") {
    if (!pages.some((p) => p.id === c.pageId)) throw new Error("That page is no longer in the book.");
    await deletePage(bookId, c.pageId, pages);
  } else {
    await editBook(bookId, c.field, c.after);
  }
  await updateChange(runId, c, "applied", null, label);
}

/** Reject a change whole (nothing written; a discarded card keeps it readable in the feed). */
export async function rejectChange(runId: number, c: ManuscriptChange, pages: ManuscriptPage[]): Promise<void> {
  await updateChange(runId, c, "discarded", null, changeLabel(c, pages));
}

/**
 * A partial resolution of a page_edit: write `before` (the live text with accepted hunks) to the page and
 * keep the rest staged (`after` minus rejected hunks). When nothing is left to review, resolve the change.
 * `title`: "accept" writes the proposed title, "reject" drops it, undefined leaves it staged.
 */
export async function resolvePartial(runId: number, c: Extract<ManuscriptChange, { kind: "page_edit" }>, page: ManuscriptPage, next: { before: string; after: string }, title?: "accept" | "reject"): Promise<void> {
  const liveBody = bodyText(page.content);
  const liveTitle = (page.title ?? "").trim();
  const nextTitle = title === "accept" ? (c.title ?? liveTitle) : liveTitle;
  if (next.before !== liveBody || nextTitle !== liveTitle) await writePageBody(page, nextTitle, next.before);
  const keepTitle = title == null && c.title != null;
  const done = next.before === next.after && !keepTitle;
  if (done) {
    const anyAccepted = next.before !== liveBody || title === "accept";
    await updateChange(runId, c, anyAccepted ? "applied" : "discarded", null, `${anyAccepted ? "" : "no part of "}${changeLabel(c, [page])}`);
    return;
  }
  const patch: ManuscriptChange = { ...c, before: next.before, after: next.after, ...(keepTitle ? { title: c.title } : { title: undefined }) };
  await updateChange(runId, c, null, patch, "");
}
