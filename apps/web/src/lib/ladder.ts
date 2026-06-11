// ladder — the client for the resolution ladder's transforms + node persistence (one place).
//
// The Resolution Map and the node editor drive every edge through here, instead of each component
// re-implementing the dual-backend call + the metadata/edge-hash bookkeeping. See
// docs/multiresolution-outline.md.
//
//   brief → spine → objective → beat → prose
//
// Two halves:
//   transforms.*  — call an edge function (bridge in dev, edge in prod), return the produced text.
//   save* / read* — persist a node to its real home (books.spine / pages.metadata) and stamp the
//                   edge hashes so the dirty graph stays correct.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { briefToPromptContext, type Brief } from "@/lib/brief";
import { metaHash, stampEdge, type PageMeta } from "@/lib/planProvenance";

export type NodeLayer = "spine" | "objective" | "beat";

// ── Transform calls (produce text; no persistence) ───────────────────────────
async function call<T extends string>(fn: string, body: Record<string, unknown>, pick: T): Promise<string> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/${fn}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return String(d[pick] ?? "").trim();
  }
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return String((data as Record<string, unknown>)?.[pick] ?? "").trim();
}

// Like `call`, but for an endpoint that returns an array of strings (e.g. several beat takes).
async function callList(fn: string, body: Record<string, unknown>, pick: string): Promise<string[]> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/${fn}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return ((d[pick] as unknown[]) ?? []).map((s) => String(s).trim()).filter(Boolean);
  }
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return (((data as Record<string, unknown>)?.[pick] as unknown[]) ?? []).map((s) => String(s).trim()).filter(Boolean);
}

export const transforms = {
  // down (expand)
  briefToSpine: (bookId: number) => call("brief-to-spine", { bookId }, "spine"),
  objectiveToBeat: (bookId: number, pageId: number, objective: string) => call("objective-to-beat", { bookId, pageId, objective }, "beat"),
  // objective → several un-judged beat takes, for the serial human-pick UI.
  beatCandidates: (bookId: number, pageId: number, objective: string, n = 3) =>
    callList("objective-to-beat", { bookId, pageId, objective, candidates: n }, "candidates"),
  beatToProse: (bookId: number, pageId: number, objective: string) => call("beat-to-prose", { bookId, pageId, level: "page", objective }, "text"),
  // up (distill)
  objectivesToSpine: (bookId: number) => call("objectives-to-spine", { bookId }, "spine"),
  beatToObjective: (bookId: number, pageId: number, beat: string) => call("beat-to-objective", { bookId, pageId, beat }, "objective"),
  proseToBeat: (bookId: number, pageId: number, proseText: string) => call("prose-to-beat", { bookId, pageId, proseText }, "beat"),
  // revise (signal-driven, preserves) — the short plan nodes; prose has its own heavier reviser.
  reviseNode: (bookId: number, layer: NodeLayer, current: string, instruction: string, pageId?: number) =>
    call("revise-node", { bookId, pageId, layer, current, instruction }, "text"),
  // wide alternatives for one objective slot, grounded on the committed prefix before it.
  objectiveOptions: (bookId: number, pageId: number) =>
    callList("objective-options", { bookId, pageId }, "options"),
  // wide alternative spines from the brief — 3 different directions to choose from.
  spineOptions: (bookId: number) =>
    callList("spine-options", { bookId }, "options"),
};

// ── Node reads ───────────────────────────────────────────────────────────────
async function pageMeta(pageId: number): Promise<PageMeta> {
  const { data } = await supabase.from("pages").select("metadata").eq("id", pageId).maybeSingle();
  return (data?.metadata as PageMeta | null) ?? {};
}

/** Current text of a node (spine = book level; objective/beat = a page's metadata). */
export async function readNode(bookId: number, layer: NodeLayer, pageId?: number): Promise<string> {
  if (layer === "spine") {
    const { data } = await supabase.from("books").select("spine").eq("id", bookId).maybeSingle();
    return ((data?.spine as { text?: string } | null)?.text ?? "").trim();
  }
  const m = await pageMeta(pageId!);
  return ((layer === "objective" ? m.objective : m.beat) ?? "").trim();
}

/** The page's prose as plain text (the beat distill's source). */
export async function readProse(pageId: number): Promise<string> {
  const { data } = await supabase.from("pages").select("content").eq("id", pageId).maybeSingle();
  return bodyText(data?.content);
}

// ── Node writes (persist + stamp the touched edges) ──────────────────────────
/** Save the book spine, reconciled with the current brief (brief→spine is the one-way top edge). */
export async function saveSpine(bookId: number, text: string): Promise<void> {
  const { data } = await supabase.from("books").select("brief").eq("id", bookId).maybeSingle();
  const brief_hash = metaHash(briefToPromptContext((data?.brief as Brief | null) ?? null) ?? "");
  const { error } = await supabase.from("books").update({ spine: { text, brief_hash } }).eq("id", bookId);
  if (error) throw error;
}

/**
 * Save a page objective. `reconcileBeat` stamps the objective→beat edge as in-sync (used when the
 * objective was DISTILLED from the beat — they now agree); a plain hand-edit leaves the beat to go
 * stale against the new objective, which is correct.
 */
export async function saveObjective(bookId: number, pageId: number, text: string, opts: { reconcileBeat?: boolean } = {}): Promise<void> {
  let m: PageMeta = { ...(await pageMeta(pageId)), objective: text };
  if (opts.reconcileBeat && m.beat?.trim()) m = stampEdge(m, "objective_beat", text, m.beat);
  const { error } = await supabase.from("pages").update({ metadata: m }).eq("id", pageId);
  if (error) throw error;
}

/**
 * Save a page beat. Always stamps the objective→beat edge against the current objective (saving a
 * beat declares it the plan for that objective). `proseText`, when given (a distill from prose), also
 * stamps beat→prose in-sync and clears the legacy prose hash.
 */
export async function saveBeat(bookId: number, pageId: number, text: string, opts: { proseText?: string } = {}): Promise<void> {
  let m: PageMeta = { ...(await pageMeta(pageId)), beat: text };
  m = stampEdge(m, "objective_beat", m.objective, text);
  if (opts.proseText != null) {
    m = stampEdge(m, "beat_prose", text, opts.proseText);
    delete m.prose_src_hash;
  }
  const { error } = await supabase.from("pages").update({ metadata: m }).eq("id", pageId);
  if (error) throw error;
}

// Body text excluding the leading title heading — decides if a page has real prose.
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text" ? String(n.text ?? "") : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}
