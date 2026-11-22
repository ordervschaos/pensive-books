// manuscript-agent tool executor — the read/search/notes/action tools, the per-turn <book> state, and
// propose_changes validation (raw tool input → stored ManuscriptChange[] against the LIVE pages).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type AgentStep, type BookRow, type ManuscriptChange, type PageRow, bodyText, pageHandle, wordCount } from "./shared.ts";
import { canvasSnapshot, parseCanvas, type CanvasSnapshot } from "./canvas.ts";

const PAGE_COLS = "id, page_index, page_type, title, content, archived";

/** Resolve browser context only inside the authorized book. Invalid/stale anchors are omitted. */
async function readCanvas(service: SupabaseClient, bookId: number, value: unknown, staged: ManuscriptChange[]): Promise<CanvasSnapshot | null> {
  const target = parseCanvas(value);
  if (!target || target.kind !== "page") return canvasSnapshot(target, [], staged);
  const { data, error } = await service.from("pages").select("id, page_index, title")
    .eq("book_id", bookId).eq("id", target.pageId).eq("archived", false).maybeSingle();
  if (error) throw new Error(error.message);
  return canvasSnapshot(target, data ? [data] : [], staged);
}

async function loadBook(service: SupabaseClient, bookId: number): Promise<{ book: BookRow | null; pages: PageRow[] }> {
  const [{ data: book }, { data: pages }] = await Promise.all([
    service.from("books").select("id, name, subtitle, author, is_public").eq("id", bookId).maybeSingle(),
    service.from("pages").select(PAGE_COLS).eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true }),
  ]);
  return { book: (book as BookRow | null) ?? null, pages: (pages as PageRow[] | null) ?? [] };
}

/** The live <book> block injected every turn: the book's fields, the page list, and the staged changes. */
async function bookState(service: SupabaseClient, bookId: number, staged: ManuscriptChange[]): Promise<string> {
  const { book, pages } = await loadBook(service, bookId);
  const q = (s: string | null | undefined) => JSON.stringify((s ?? "").trim());
  let words = 0;
  const lines = pages.map((p) => {
    const w = p.page_type === "text" ? wordCount(bodyText(p.content)) : 0;
    words += w;
    return `${p.page_index} · #${p.id} · ${p.page_type ?? "text"} · ${q(p.title)}${p.page_type === "text" ? ` · ${w}w` : ""}`;
  });
  const head = `<book id=${bookId} name=${q(book?.name)} subtitle=${q(book?.subtitle)} author=${q(book?.author)} public=${book?.is_public ? "yes" : "no"} pages=${pages.length} words=${words} note="the LIVE book this turn; pages as index · id · type · title · words">`;
  const stagedBlock = staged.length
    ? `\n<staged_changes note="already proposed, awaiting the author's review — don't propose these again">\n${staged.map(describeChange).join("\n")}\n</staged_changes>`
    : "";
  return `${head}\n${lines.join("\n")}\n</book>${stagedBlock}`;
}

function describeChange(c: ManuscriptChange): string {
  switch (c.kind) {
    case "page_edit": return `${c.id} · page_edit #${c.pageId}${c.title != null ? ` retitle→${JSON.stringify(c.title)}` : ""} · ${c.note ?? ""}`;
    case "page_add": return `${c.id} · page_add after #${c.afterPageId ?? "start"} · ${JSON.stringify(c.title)} · ${c.note ?? ""}`;
    case "page_delete": return `${c.id} · page_delete #${c.pageId} · ${c.note ?? ""}`;
    case "book_edit": return `${c.id} · book_edit ${c.field} → ${JSON.stringify(c.after)} · ${c.note ?? ""}`;
  }
}

// ── Tool execution ──
// deno-lint-ignore no-explicit-any
async function toolResults(service: SupabaseClient, bookId: number, toolUses: any[], steps: AgentStep[], overrides: Record<string, string> = {}): Promise<unknown[]> {
  const outs = await Promise.all(toolUses.map((t) => execTool(service, bookId, t, overrides)));
  for (const o of outs) if (o.step) steps.push(o.step);
  return outs.map((o) => o.result);
}

const ok = (id: string, content: string) => ({ type: "tool_result", tool_use_id: id, content });
const err = (id: string, content: string) => ({ type: "tool_result", tool_use_id: id, content, is_error: true });

// deno-lint-ignore no-explicit-any
async function execTool(service: SupabaseClient, bookId: number, t: any, overrides: Record<string, string>): Promise<{ result: unknown; step?: AgentStep }> {
  if (overrides[t.id] != null) return { result: err(t.id, overrides[t.id]) };
  const input = (t.input ?? {}) as Record<string, unknown>;

  if (t.name === "read_pages") {
    const ids = (Array.isArray(input.pageIds) ? input.pageIds : []).map(Number).filter((n) => Number.isInteger(n)).slice(0, 8);
    if (!ids.length) return { result: err(t.id, "pageIds must be a non-empty array of page ids.") };
    const { data } = await service.from("pages").select(PAGE_COLS).eq("book_id", bookId).eq("archived", false).in("id", ids);
    const rows = ((data as PageRow[] | null) ?? []).sort((a, b) => a.page_index - b.page_index);
    if (!rows.length) return { result: err(t.id, "No such pages in this book.") };
    const out = rows.map((p) => `<page id=${p.id} index=${p.page_index} type=${p.page_type ?? "text"} title=${JSON.stringify((p.title ?? "").trim())}>\n${bodyText(p.content)}\n</page>`).join("\n\n");
    const missing = ids.filter((id) => !rows.some((r) => r.id === id));
    const label = rows.length === 1 ? `read ${pageHandle(rows[0])}` : `read ${rows.length} pages (${rows.map((r) => `p${r.page_index + 1}`).join(", ")})`;
    return { result: ok(t.id, missing.length ? `${out}\n\n(not found: ${missing.join(", ")})` : out), step: { t: "read", label } };
  }

  if (t.name === "search_pages") {
    const q = String(input.query ?? "").trim();
    if (!q) return { result: err(t.id, "query is required.") };
    const { pages } = await loadBook(service, bookId);
    const needle = q.toLowerCase();
    const hits: string[] = [];
    for (const p of pages) {
      const text = bodyText(p.content);
      const hay = text.toLowerCase();
      let from = 0, n = 0;
      while (n < 3) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        const s = Math.max(0, at - 80), e = Math.min(text.length, at + needle.length + 80);
        hits.push(`#${p.id} ${pageHandle(p)}: …${text.slice(s, e).replace(/\s+/g, " ")}…`);
        from = at + needle.length; n++;
      }
      if (hits.length >= 24) break;
    }
    return { result: ok(t.id, hits.length ? hits.join("\n") : `No page contains "${q}".`), step: { t: "read", label: `searched "${q}" — ${hits.length} hit${hits.length === 1 ? "" : "s"}` } };
  }

  if (t.name === "record_notes") {
    const notes = (Array.isArray(input.notes) ? input.notes : []) as { ref?: unknown; finding?: unknown }[];
    const findings = notes.map((n) => ({ ref: String(n?.ref ?? "").trim().slice(0, 40), finding: String(n?.finding ?? "").trim().slice(0, 400) })).filter((f) => f.finding).slice(0, 20);
    if (!findings.length) return { result: err(t.id, "notes must carry at least one finding.") };
    return { result: ok(t.id, "ok"), step: { t: "finding", label: `noted ${findings.length} thing${findings.length === 1 ? "" : "s"}`, findings } };
  }

  if (t.name === "suggest_action") {
    const action = String(input.action ?? "");
    if (!["publish", "open_page", "open_studio"].includes(action)) return { result: err(t.id, "action must be publish | open_page | open_studio.") };
    const pageId = Number(input.pageId);
    if (action === "open_page" && !Number.isInteger(pageId)) return { result: err(t.id, "open_page needs a pageId.") };
    const label = String(input.label ?? "").trim().slice(0, 80) || (action === "publish" ? "Publish the book" : action === "open_page" ? "Open the page" : "Open the Studio");
    const step: AgentStep = { t: "action", label, action: action as AgentStep["action"], ...(action === "open_page" ? { pageId } : {}) };
    return { result: ok(t.id, "ok"), step };
  }

  return { result: err(t.id, `Unknown tool ${t.name}.`) };
}

// ── propose_changes validation ──
const newId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

type Outcome = { ok: true; summary: string; changes: ManuscriptChange[] } | { ok: false; error: string };

async function validateProposal(service: SupabaseClient, bookId: number, input: { summary?: unknown; changes?: unknown }, staged: ManuscriptChange[]): Promise<Outcome> {
  const summary = String(input.summary ?? "").trim().slice(0, 300);
  const raw = Array.isArray(input.changes) ? input.changes as Record<string, unknown>[] : [];
  if (!summary) return { ok: false, error: "summary is required." };
  if (!raw.length) return { ok: false, error: "changes must carry at least one change." };
  const { book, pages } = await loadBook(service, bookId);
  if (!book) return { ok: false, error: "Book not found." };
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: ManuscriptChange[] = [];
  const problems: string[] = [];
  const note = (c: Record<string, unknown>) => { const n = String(c.note ?? "").trim().slice(0, 200); return n ? { note: n } : {}; };

  raw.forEach((c, i) => {
    const kind = String(c.kind ?? "");
    const where = `changes[${i}]`;
    if (kind === "page_edit") {
      const pageId = Number(c.pageId);
      const page = byId.get(pageId);
      if (!page) { problems.push(`${where}: no page #${c.pageId}.`); return; }
      if (staged.some((s) => s.kind === "page_edit" && s.pageId === pageId)) { problems.push(`${where}: page #${pageId} already has a staged edit — wait for the author to review it.`); return; }
      const before = bodyText(page.content);
      let after = before;
      if (typeof c.after === "string") after = normalizeText(c.after);
      else if (Array.isArray(c.edits)) {
        for (const [j, e] of (c.edits as { find?: unknown; replace?: unknown }[]).entries()) {
          const find = String(e?.find ?? ""), replace = String(e?.replace ?? "");
          if (!find) { problems.push(`${where}.edits[${j}]: find is empty.`); return; }
          const first = after.indexOf(find);
          if (first < 0) { problems.push(`${where}.edits[${j}]: find text not present in page #${pageId} — quote it verbatim from read_pages (markup included).`); return; }
          if (after.indexOf(find, first + 1) >= 0) { problems.push(`${where}.edits[${j}]: find text occurs more than once in page #${pageId} — include more surrounding text.`); return; }
          after = after.slice(0, first) + replace + after.slice(first + find.length);
        }
        after = normalizeText(after);
      }
      const title = typeof c.title === "string" ? c.title.trim().slice(0, 200) : null;
      const retitle = title != null && title !== (page.title ?? "").trim();
      if (after === before && !retitle) { problems.push(`${where}: page #${pageId} is unchanged (give after/edits, or a new title).`); return; }
      out.push({ id: newId(), kind: "page_edit", pageId, before, after, ...(retitle ? { title } : {}), ...note(c) });
      return;
    }
    if (kind === "page_add") {
      const afterRaw = c.afterPageId;
      const afterPageId = afterRaw == null ? null : Number(afterRaw);
      if (afterPageId != null && !byId.has(afterPageId)) { problems.push(`${where}: no page #${afterRaw} to insert after.`); return; }
      const pageType = c.pageType === "section" ? "section" : "text";
      const title = String(c.title ?? "").trim().slice(0, 200);
      const text = pageType === "section" ? "" : normalizeText(String(c.text ?? ""));
      if (!title && !text) { problems.push(`${where}: a new page needs a title or text.`); return; }
      out.push({ id: newId(), kind: "page_add", afterPageId, pageType, title: title || "Untitled", text, ...note(c) });
      return;
    }
    if (kind === "page_delete") {
      const pageId = Number(c.pageId);
      if (!byId.has(pageId)) { problems.push(`${where}: no page #${c.pageId}.`); return; }
      if (staged.some((s) => s.kind === "page_delete" && s.pageId === pageId)) { problems.push(`${where}: page #${pageId} is already staged for deletion.`); return; }
      out.push({ id: newId(), kind: "page_delete", pageId, ...note(c) });
      return;
    }
    if (kind === "book_edit") {
      const field = String(c.field ?? "");
      if (!["name", "subtitle", "author"].includes(field)) { problems.push(`${where}: field must be name | subtitle | author.`); return; }
      const after = String(c.value ?? "").trim().slice(0, 300);
      const before = (book[field as "name" | "subtitle" | "author"] ?? "").trim();
      if (after === before) { problems.push(`${where}: ${field} is already ${JSON.stringify(before)}.`); return; }
      if (staged.some((s) => s.kind === "book_edit" && s.field === field)) { problems.push(`${where}: ${field} already has a staged edit.`); return; }
      out.push({ id: newId(), kind: "book_edit", field: field as "name" | "subtitle" | "author", before, after, ...note(c) });
      return;
    }
    problems.push(`${where}: unknown kind ${JSON.stringify(kind)}.`);
  });

  if (problems.length) return { ok: false, error: problems.join(" ") };
  return { ok: true, summary, changes: out };
}

// The projection's normal form: blocks separated by exactly one blank line, no trailing whitespace —
// so an `after` the model typed with stray spacing diffs cleanly against the live text.
function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((b) => b.replace(/[ \t]+$/gm, "").trim()).filter(Boolean).join("\n\n");
}

export { bookState, readCanvas, toolResults, validateProposal };
