// options-core — the pure "generate wide alternative objectives" worker, extracted so the sync
// endpoint (objective-options) AND the durable dispatcher (ai-run) share byte-identical logic.
// Does NO auth, NO access check, NO row writes — callers own those (mirrors beat-core.ts).
//
// Two modes, both producing 3 wide-varying objectives grounded on the story-so-far:
//   COMMITTED — { pageId } → prefix built from the real pages table.
//   DRAFT     — { scaffold, pageIndex } → prefix built from an in-memory scaffold draft (pre-commit).
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callClaude, type CallMeta } from "./claude.ts";
import { getActiveModels } from "./model-config.ts";

export interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

interface PageLite { id: number; page_type: string | null; title: string | null; metadata: { objective?: string } | null }
export interface DraftPage { pageType: "section" | "text"; title?: string; objective?: string }
interface SlotLite { pageType: string | null; title?: string | null; objective?: string }

export interface ObjectiveOptionsParams {
  bookId: number;
  pageId?: number;
  scaffold?: { pages?: DraftPage[] };
  pageIndex?: number;
  userId?: string | null;
}

const SYSTEM = `You are a book architect generating ALTERNATIVE OBJECTIVES for one outline slot.

An OBJECTIVE is 1–2 sentences stating what a page must achieve — its job in the story, not what happens beat-by-beat. The objective is the contract the beat and prose will fulfill.

You will be given the committed objectives for all pages before this slot as the story-so-far context. Use them as the causal foundation — something has to happen here that follows from where the story has arrived.

Generate exactly 3 ALTERNATIVES. Each must:
- Connect causally to the committed prefix (follow "therefore" or "but" from what came before)
- Honor the spine's throughline
- Be GENUINELY DIFFERENT from each other — different angle, direction, or emotional register
- Vary in ambition across the set: one quieter interior move, one larger external turn, one unexpected diagonal

Each option is a clean OBJECTIVE — 1–2 sentences of what the page must achieve. Do NOT label it with the technique ("Unexpected diagonal:", "Plant the mother:", etc.), do NOT add meta-commentary or stage directions, do NOT mention the reader. Just the objective itself.

Output JSON ONLY (no prose, no fences):
{ "options": ["<option 1>", "<option 2>", "<option 3>"] }`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}${brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : ""}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty)";
}

function prefixContext(slots: SlotLite[], targetIdx: number): { prefix: string; current: string; title: string } {
  const target = slots[targetIdx];
  const prefixLines: string[] = [];
  for (let i = 0; i < targetIdx; i++) {
    const p = slots[i];
    if (p.pageType === "section") prefixLines.push(`# ${p.title || "(untitled section)"}`);
    else prefixLines.push(`- "${p.title || "(untitled)"}" — ${p.objective?.trim() || "(no objective yet)"}`);
  }
  return {
    prefix: prefixLines.join("\n") || "(this is the first page — no preceding objectives)",
    current: target?.objective?.trim() || "",
    title: target?.title?.trim() || "(untitled)",
  };
}

function parseOptions(text: string): string[] {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  const parsed = JSON.parse(raw);
  const arr: unknown[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.options) ? parsed.options : []);
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

// Generate the 3 alternatives. Throws on bad input / no output (callers map to a row error or HTTP).
export async function objectiveOptions(client: SupabaseClient, apiKey: string, p: ObjectiveOptionsParams): Promise<string[]> {
  const draftMode = Array.isArray(p.scaffold?.pages) && typeof p.pageIndex === "number";
  if (!draftMode && !p.pageId) throw new Error("pageId, or scaffold+pageIndex, are required");

  const { data: book, error: bookError } = await client
    .from("books").select("id, name, brief, spine").eq("id", p.bookId).single();
  if (bookError || !book) throw new Error("Book not found");

  let slots: SlotLite[];
  let targetIdx: number;
  if (draftMode) {
    slots = (p.scaffold!.pages ?? []).map((d) => ({ pageType: d.pageType, title: d.title, objective: d.objective }));
    targetIdx = p.pageIndex!;
    if (targetIdx < 0 || targetIdx >= slots.length) throw new Error("pageIndex out of range");
  } else {
    const { data: pages } = await client.from("pages").select("id, page_index, page_type, title, metadata")
      .eq("book_id", p.bookId).eq("archived", false).order("page_index", { ascending: true });
    const list = (pages as PageLite[] | null) ?? [];
    targetIdx = list.findIndex((pg) => pg.id === p.pageId);
    if (targetIdx === -1) throw new Error("Page not found in this book");
    slots = list.map((pg) => ({ pageType: pg.page_type, title: pg.title, objective: pg.metadata?.objective }));
  }

  const brief = book.brief as Brief | null;
  const spine = (book.spine as { text?: string } | null)?.text?.trim() || null;
  const { prefix, current, title } = prefixContext(slots, targetIdx);
  const { high: model } = await getActiveModels();
  const meta: CallMeta = { fn: "objective-options", bookId: p.bookId, userId: p.userId ?? null };

  const userContent =
    `BOOK: ${book.name}\n\nBRIEF:\n${briefContext(brief)}` +
    (spine ? `\n\nBOOK SPINE (the throughline — alternatives must serve it):\n${spine}` : "") +
    `\n\nOBJECTIVES SO FAR (story-so-far — use as causal foundation):\n${prefix}` +
    `\n\nTHIS SLOT: "${title}"` +
    (current ? `\n\nCURRENT OBJECTIVE (what's there now — vary away from it):\n${current}` : "\n\n(No objective set yet for this slot.)") +
    `\n\nGenerate 3 wide-varying alternatives for this slot. JSON only.`;

  const data = await callClaude(apiKey, {
    model,
    max_tokens: 1024,
    temperature: 1,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  }, meta);

  const text = ((data.content ?? []) as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  if (!text) throw new Error("Claude returned no options.");

  const options = parseOptions(text);
  if (options.length === 0) throw new Error("Claude returned an empty options list.");
  return options;
}
