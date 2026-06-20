// generate-unit-core — the pure "render(objective) → prose" worker, extracted from
// generate-unit/index.ts so it can be reused by every orchestrator that renders a page:
//
//   generate-unit   (sync HTTP — the single workshop call, kept for back-compat / paragraph level)
//   generate-page   (async orchestrator — one page, writes a book_generations proposal row)
//   generate-book   (self-chaining orchestrator — write-all, one page per invocation)
//   build-revision  (self-chaining orchestrator — the revise build cascade)
//
// This module does NO auth, NO access check, and NO task-row writes — it just builds context and
// calls Claude. The callers own auth and the task row. Prompt assembly is byte-for-byte the same as
// the original generate-unit (the dev bridge mirrors it), so the output is unchanged.
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type Brief, briefContext, mandateContext } from "./brief.ts";
import { callClaude as callClaudeApi, textFromClaude, type CallMeta } from "./claude.ts";
import { getActiveModels, DEFAULT_LOW_MODEL } from "./model-config.ts";
import { type CharacterState, type PageState, type RelationshipState } from "./page-state.ts";
import { canonContext, type CanonPacket } from "./canon-core.ts";
import { type Foundations, type CastMember, type WorldNode, type Narration } from "./foundations-core.ts";
import { tiptapToText } from "./words.ts";
import { extractJsonBlock } from "./json.ts";
import { readSteer, steerBlock } from "./steer.ts";
const PRECEDING_PAGES = 2; // how many prior text pages of full prose to include for continuity


// A single editorial note to address when revising a page (from book_evaluations result).
export interface ReviseIssue {
  section?: string;
  severity?: string;
  note: string;
  evidence?: string;
  suggestion?: string;
}

// The character ledger (the state axis) and the full page-state shape are the canonical types in
// _shared/page-state.ts; re-export CharacterState here for existing call sites.
export type { CharacterState };

interface CommonParams {
  bookId: number;
  pageId?: number | null;
  // Optional link to the durable task row this render serves, recorded on the ai_calls log.
  log?: { taskTable?: string; taskId?: number };
  // Auth user who triggered this render; null/absent = automated/system call.
  userId?: string | null;
}

// beat-to-prose (write): render prose from the page's beat (or objective). No existing prose involved.
export interface WriteParams extends CommonParams {
  level: "paragraph" | "page";
  objective?: string;
  pageObjective?: string;
  precedingText?: string;
}

// revise-prose: rework a page's EXISTING prose to address editorial notes, preserving what works.
export interface ReviseParams extends CommonParams {
  objective?: string;
  issues: ReviseIssue[];
}

// F3b/F4a: bible shape — book-level cross-cutting defaults (voice, facts, narration).
// Consumers already read `bible.voice_sample` loosely; these interfaces close the type gap so later
// stages (F3b fact ledger, F4a narration) can read/write typed fields without inventing the shape.
// Do NOT rewire existing `b.bible?.voice_sample` accesses — they keep working (BibleFact/BibleNarration
// are additive). Mirror exported to apps/web/src/lib/bible.ts.
export interface BibleFact { fact: string; page_index: number }
export interface BibleNarration {
  person?: "first" | "close-third" | "omniscient";
  tense?: "past" | "present";
  distance?: string;
}
export interface Bible {
  voice_sample?: string;
  facts?: BibleFact[];
  narration?: BibleNarration;
}

interface BookRow {
  id: number;
  name: string;
  brief: Brief | null;
  bible: Bible | null;
  canon: CanonPacket | null;
  steers: unknown;
  // F1/F2/F3a: stable creative decisions — cast voices, relationships, world node
  foundations: Foundations | null;
  // F4a: per-layer craft guidance authored in the studio; keyed by layer name
  craft_notes: Record<string, string> | null;
}

// Voice source for prose generation. foundations.voice_exemplar is the canonical authoring record;
// bible.voice_sample is a legacy mirror, no longer written — kept ONLY as a read-fallback for books
// authored before the mirror was collapsed. New voice edits flow through foundations.
function resolveVoice(b: BookRow): string | null {
  return b.foundations?.voice_exemplar?.text?.trim() || b.bible?.voice_sample?.trim() || null;
}

// ── Transforms ───────────────────────────────────────────────────────────────
// Two isolated unit transforms share the context + Claude + summary machinery below but keep their
// own entry points and context decisions (the create/render path vs the signal-driven revise path).

const meta = (fn: string, p: CommonParams): CallMeta => ({
  fn,
  bookId: p.bookId,
  taskTable: p.log?.taskTable ?? null,
  taskId: p.log?.taskId ?? null,
  userId: p.userId ?? null,
});

const wordCount = (s: string | null | undefined): number => {
  const t = (s ?? "").trim();
  return t ? t.split(/\s+/).length : 0;
};

// Link a page to the ai_call whose prose generation last wrote it (admin lineage). Best-effort: a
// failure here only loses the convenience link, it never fails the write.
async function stampGeneratingCall(client: SupabaseClient, pageId: number, callId: number | null | undefined) {
  if (!callId) return;
  try {
    await client.from("pages").update({ last_ai_call_id: callId }).eq("id", pageId);
  } catch (e) {
    console.error("generate-unit-core: last_ai_call_id stamp failed (non-fatal):", e);
  }
}

async function loadBook(client: SupabaseClient, bookId: number): Promise<BookRow> {
  const { data: book, error } = await client
    .from("books").select("id, name, subtitle, author, brief, bible, canon, steers, foundations, craft_notes").eq("id", bookId).single();
  if (error || !book) throw new Error("Book not found");
  return book as unknown as BookRow;
}

// beat-to-prose (the beat→prose edge): render a page's prose from its beat (or objective). Idempotent
// — an empty page creates, a written page re-renders (the caller overwrites). NOT for revising prose.
export async function beatToProse(client: SupabaseClient, apiKey: string, p: WriteParams): Promise<string> {
  if (!p.objective?.trim()) throw new Error("objective is required");
  const [b, ctx, models] = await Promise.all([
    loadBook(client, p.bookId),
    buildUnitContext(client, p.bookId, p.pageId ?? null, p.level),
    getActiveModels(),
  ]);

  // Prose is written from the page's BEAT when one exists (the concrete plan), else the objective.
  let beat: string | null = null;
  if (p.pageId) {
    const { data: pg } = await client.from("pages").select("metadata").eq("id", p.pageId).maybeSingle();
    beat = ((pg?.metadata as { beat?: string } | null)?.beat ?? "").trim() || null;
  }

  const m = meta("beat-to-prose", p);
  // The labeled artifact manifest: the named inputs that compose this prose call's prompt, logged to
  // ai_calls.artifacts so the admin sees what fed the page (the merged prompt is still in `input`).
  m.artifacts = {
    mode: "write",
    objective: (p.objective ?? "").trim() || null,
    beat,
    brief: b.brief,
    voice_sample_used: !!resolveVoice(b),
    character_states: ctx.characterStates,
    open_loops: ctx.openLoops,
    story_so_far: ctx.storySoFar,
    preceding_prose: ctx.precedingProseIds.length
      ? { page_ids: ctx.precedingProseIds, word_count: wordCount(ctx.precedingProse) }
      : null,
  };
  // F3b: established facts from bible.facts with page_index < current (write mode)
  const currentPageIndex = await getPageIndex(client, p.pageId ?? null);
  const establishedFacts = renderEstablishedFacts(b.bible?.facts, currentPageIndex);
  // F4a: prose-layer craft note
  const craftNoteProse = b.craft_notes?.["prose"] ?? b.craft_notes?.["foundations"] ?? null;
  // C4: per-page word target. Content pages = lines in objectiveMap starting with `- "` (non-section).
  const _wtTarget = (b.brief?.scope?.word_target ?? 0);
  const _contentCount = _wtTarget > 0 ? ctx.objectiveMap.split("\n").filter((l) => l.startsWith(`- "`)).length : 0;
  const perPageWordTarget = (_wtTarget > 0 && _contentCount > 0) ? Math.round(_wtTarget / _contentCount) : 0;

  const text = await renderProse(apiKey, models.high, {
    brief: b.brief, voiceSample: resolveVoice(b), canon: b.canon, bookName: b.name,
    level: p.level, mode: "write", steer: readSteer(b.steers, "prose"), objective: (p.objective ?? "").trim(), beat, issues: null, currentText: null,
    pageObjective: p.pageObjective?.trim() || null, precedingText: p.precedingText?.trim() || null,
    objectiveMap: ctx.objectiveMap, storySoFar: ctx.storySoFar, precedingProse: ctx.precedingProse, currentPageLabel: ctx.currentPageLabel, openLoops: ctx.openLoops, characterStates: ctx.characterStates,
    foundations: b.foundations, craftNoteProse,
    relationshipStates: ctx.relationshipStates,
    establishedFacts,
    storyTime: ctx.storyTime,
    pov: ctx.pov,
    narration: b.foundations?.narration ?? null,
    perPageWordTarget,
  }, m);

  if (p.level === "page" && p.pageId) {
    await stampGeneratingCall(client, p.pageId, m.loggedCallId); // page → the call that wrote it
    await maybeSummarize(client, apiKey, p.pageId, text, m, models.low);
    await maybeExtractCharacterStates(client, apiKey, p.bookId, p.pageId, text, m, models.low);
  }
  return text;
}

// revise-prose: rework a page's EXISTING prose to address editorial notes, preserving its strengths
// and the author's voice. Signal-driven (the notes), always page-level — never creates from scratch.
export async function revisePage(client: SupabaseClient, apiKey: string, p: ReviseParams): Promise<string> {
  if (!p.pageId) throw new Error("pageId is required for revise");
  if (!Array.isArray(p.issues) || p.issues.length === 0) throw new Error("issues are required for revise");
  const [b, ctx, models] = await Promise.all([
    loadBook(client, p.bookId),
    buildUnitContext(client, p.bookId, p.pageId, "page"),
    getActiveModels(),
  ]);

  const { data: pg } = await client.from("pages").select("content").eq("id", p.pageId).maybeSingle();
  const currentText = tiptapToText(pg?.content).trim() || null;
  if (!currentText) throw new Error("Page has no prose to revise");

  const m = meta("revise-prose", p);
  m.artifacts = {
    mode: "revise",
    objective: (p.objective ?? "").trim() || null,
    issues: p.issues,
    brief: b.brief,
    voice_sample_used: !!resolveVoice(b),
    character_states: ctx.characterStates,
    open_loops: ctx.openLoops,
    story_so_far: ctx.storySoFar,
    current_prose: { word_count: wordCount(currentText) },
    preceding_prose: ctx.precedingProseIds.length
      ? { page_ids: ctx.precedingProseIds, word_count: wordCount(ctx.precedingProse) }
      : null,
  };
  // F3b: established facts from bible.facts with page_index < current (revise mode)
  const revisePageIndex = await getPageIndex(client, p.pageId);
  const reviseEstablishedFacts = renderEstablishedFacts(b.bible?.facts, revisePageIndex);
  // F4a: prose-layer craft note
  const reviseCraftNoteProse = b.craft_notes?.["prose"] ?? b.craft_notes?.["foundations"] ?? null;

  const text = await renderProse(apiKey, models.high, {
    brief: b.brief, voiceSample: resolveVoice(b), canon: b.canon, bookName: b.name,
    level: "page", mode: "revise", steer: "", objective: (p.objective ?? "").trim(), beat: null, issues: p.issues, currentText,
    pageObjective: null, precedingText: null,
    objectiveMap: ctx.objectiveMap, storySoFar: ctx.storySoFar, precedingProse: ctx.precedingProse, currentPageLabel: ctx.currentPageLabel, openLoops: ctx.openLoops, characterStates: ctx.characterStates,
    foundations: b.foundations, craftNoteProse: reviseCraftNoteProse,
    relationshipStates: ctx.relationshipStates,
    establishedFacts: reviseEstablishedFacts,
    storyTime: ctx.storyTime,
    pov: ctx.pov,
    narration: b.foundations?.narration ?? null,
  }, m);

  await stampGeneratingCall(client, p.pageId, m.loggedCallId); // page → the call that revised it
  await maybeSummarize(client, apiKey, p.pageId, text, m, models.low);
  await maybeExtractCharacterStates(client, apiKey, p.bookId, p.pageId, text, m, models.low);
  return text;
}

// F3b: look up a page's index from the DB so we can filter bible.facts by page_index < current.
// Returns null when pageId is null (paragraph-level or unknown) — caller skips the facts block.
async function getPageIndex(client: SupabaseClient, pageId: number | null): Promise<number | null> {
  if (pageId == null) return null;
  const { data } = await client.from("pages").select("page_index").eq("id", pageId).maybeSingle();
  return (data as { page_index: number } | null)?.page_index ?? null;
}

// F3b: render an ESTABLISHED FACTS block from bible.facts for facts with page_index < currentIndex.
// Returns null when there are no qualifying facts (block is skipped).
function renderEstablishedFacts(facts: BibleFact[] | null | undefined, currentIndex: number | null): string | null {
  if (!facts?.length || currentIndex == null) return null;
  const prior = facts.filter((f) => f.page_index < currentIndex);
  if (!prior.length) return null;
  const lines = prior.map((f) => `- ${f.fact}`).join("\n");
  return `ESTABLISHED FACTS (do not contradict — these were set in earlier pages):\n${lines}`;
}

// Cheap one-paragraph "story so far" summary for later pages' continuity. Best-effort.
// F3c: also extracts a story-time stamp ({when,elapsed}) from the summarizer and persists it.
async function maybeSummarize(client: SupabaseClient, apiKey: string, pageId: number, text: string, m: CallMeta, summaryModel?: string) {
  try {
    const result = await summarize(apiKey, text, m, summaryModel);
    if (result.summary) await persistSummary(client, pageId, result.summary, result.time ?? null);
  } catch (e) {
    console.error("generate-unit-core: summary step failed (non-fatal):", e);
  }
}

// ── Context assembly ─────────────────────────────────────────────────────────
interface PageLite {
  id: number;
  page_index: number;
  page_type: string | null;
  title: string | null;
  metadata: PageState | null;
}

export async function buildUnitContext(
  client: SupabaseClient,
  bookId: number,
  pageId: number | null,
  level: "paragraph" | "page"
): Promise<{
  objectiveMap: string;
  storySoFar: string | null;
  precedingProse: string | null;
  precedingProseIds: number[];
  currentPageLabel: string | null;
  openLoops: string | null;
  characterStates: string | null;
  // F2: formatted relationship states from most recent prior page
  relationshipStates: string | null;
  // F3c: story time from the current page's planned metadata
  storyTime: string | null;
  // F4a: POV character from current page metadata
  pov: string | null;
}> {
  const { data: pages } = await client
    .from("pages")
    .select("id, page_index, page_type, title, metadata")
    .eq("book_id", bookId)
    .eq("archived", false)
    .order("page_index", { ascending: true });

  const list = (pages as PageLite[] | null) ?? [];
  const current = pageId != null ? list.find((p) => p.id === pageId) ?? null : null;

  const objectiveMap = list
    .map((p) => {
      const obj = p.metadata?.objective?.trim();
      const here = current && p.id === current.id ? "  ← you are here" : "";
      if (p.page_type === "section") return `\n# ${p.title || "(untitled section)"}${obj ? ` — ${obj}` : ""}${here}`;
      return `- "${p.title || "(untitled)"}"${obj ? ` — ${obj}` : ""}${here}`;
    })
    .join("\n");

  const currentPageLabel = current ? `"${current.title || "(untitled)"}"` : null;

  let precedingProse: string | null = null;
  let precedingProseIds: number[] = [];
  let storySoFar: string | null = null;
  if (level === "page" && current) {
    const priorText = list.filter((p) => p.page_type === "text" && p.page_index < current.page_index);

    const summarized = priorText.slice(0, Math.max(0, priorText.length - PRECEDING_PAGES));
    const soFar = summarized
      .map((p) => p.metadata?.summary?.trim())
      .filter((s): s is string => !!s);
    storySoFar = soFar.length ? soFar.join("\n") : null;

    const priorIds = priorText.slice(-PRECEDING_PAGES).map((p) => p.id);
    precedingProseIds = priorIds;
    if (priorIds.length) {
      const { data: priorPages } = await client
        .from("pages")
        .select("id, page_index, title, content")
        .in("id", priorIds)
        .order("page_index", { ascending: true });
      const chunks = ((priorPages as Array<{ title: string | null; content: unknown }> | null) ?? [])
        .map((p) => {
          const t = tiptapToText(p.content).trim();
          return t ? `### ${p.title || "(untitled)"}\n${t}` : "";
        })
        .filter(Boolean);
      precedingProse = chunks.length ? chunks.join("\n\n") : null;
    }
  }

  const openLoops = current ? await buildOpenLoops(client, bookId, list, current) : null;

  // Character ledger: the latest full snapshot from the most recent prior page that carries one.
  let characterStates: string | null = null;
  if (level === "page" && current) {
    const prior = list.filter((p) => p.page_index < current.page_index && (p.metadata?.character_states?.length ?? 0) > 0);
    const latest = prior.at(-1)?.metadata?.character_states;
    if (latest?.length) characterStates = formatCharacterStates(latest);
  }

  // F2: Relationship ledger — latest snapshot from the most recent prior page that carries one.
  let relationshipStates: string | null = null;
  if (level === "page" && current) {
    const priorRel = list.filter((p) => p.page_index < current.page_index && (p.metadata?.relationship_states?.length ?? 0) > 0);
    const latestRel = priorRel.at(-1)?.metadata?.relationship_states;
    if (latestRel?.length) relationshipStates = formatRelationshipStates(latestRel);
  }

  // F3c: story-time — from the current page's planned metadata.time (may be absent for new pages)
  const storyTime = (() => {
    if (level !== "page" || !current) return null;
    const t = current.metadata?.time;
    if (!t) return null;
    const parts = [t.when && `when: ${t.when}`, t.elapsed && `elapsed: ${t.elapsed}`].filter(Boolean);
    return parts.length ? parts.join("; ") : null;
  })();

  // F4a: POV character from current page metadata
  const pov = (level === "page" && current?.metadata?.pov) ? current.metadata.pov : null;

  return { objectiveMap, storySoFar, precedingProse, precedingProseIds, currentPageLabel, openLoops, characterStates, relationshipStates, storyTime, pov };
}

// The character ledger as a prompt block: stable arc poles in parens, then the changing state.
export function formatCharacterStates(states: CharacterState[]): string {
  const lines = states.map((c) => {
    const arc = [c.want && `wants ${c.want}`, c.wound && `wound: ${c.wound}`].filter(Boolean).join("; ");
    const now = [
      c.knows?.length ? `knows ${c.knows.join("; ")}` : "",
      c.feels ? `feels ${c.feels}` : "",
      c.has?.length ? `has ${c.has.join("; ")}` : "",
      c.believes ? `believes ${c.believes}` : "",
    ].filter(Boolean).join(", ");
    return `- ${c.name}${arc ? ` (${arc})` : ""}: ${now || "—"}`;
  });
  return `CHARACTER STATES (as of the previous page — keep each character consistent with what they currently know, feel, have and believe; do not reset them, and let what happens here move them):\n${lines.join("\n")}`;
}

// F2: Relationship ledger as a prompt block — current charges of each dyad.
export function formatRelationshipStates(states: RelationshipState[]): string {
  const lines = states.map((r) => `- ${r.pair}: ${r.charge}${r.note ? ` (${r.note})` : ""}`);
  return `RELATIONSHIP STATES (as of the previous page — let these charges drive the scene; flips here should feel earned):\n${lines.join("\n")}`;
}

// Promise/payoff ledger as page-level instruction: which threads to SEED, PAY OFF, or WITHHOLD on
// this page. Reads book_thread_anchors (role='promise'→SEED, role='resolution'→PAY OFF) — the flat
// setup_page_id/payoff_page_id columns were dropped in the anchors migration (beat-core.ts:117-135
// is the reference implementation). Robust while a build is in flight and statuses are still flipping.
async function buildOpenLoops(
  client: SupabaseClient,
  bookId: number,
  list: PageLite[],
  current: PageLite,
): Promise<string | null> {
  const { data: rows } = await client
    .from("book_threads")
    .select("name, description, book_thread_anchors(page_id, role)")
    .eq("book_id", bookId);
  const threads = (rows as Array<{
    name: string;
    description: string | null;
    book_thread_anchors: Array<{ page_id: number | null; role: string }> | null;
  }> | null) ?? [];
  if (threads.length === 0) return null;

  const pageIndexOf = (pid: number | null): number | null => {
    if (pid == null) return null;
    const p = list.find((x) => x.id === pid);
    return p ? p.page_index : null;
  };
  const ci = current.page_index;

  const lines: string[] = [];
  for (const t of threads) {
    const anchors = t.book_thread_anchors ?? [];
    const desc = t.description ? ` — ${t.description}` : "";

    // Is this page a promise (SEED) anchor?
    if (anchors.some((a) => a.page_id === current.id && a.role === "promise")) {
      lines.push(`- SEED "${t.name}"${desc}: plant this naturally; it pays off LATER, so do NOT resolve it here.`);
      continue;
    }
    // Is this page a resolution (PAY OFF) anchor?
    if (anchors.some((a) => a.page_id === current.id && a.role === "resolution")) {
      lines.push(`- PAY OFF "${t.name}"${desc}: deliver this promise here; make it feel earned.`);
      continue;
    }
    // Otherwise: WITHHOLD if the thread was seeded before this page and its resolution is after it (or unset).
    const promisePageId = anchors.find((a) => a.role === "promise")?.page_id ?? null;
    const resolutionPageId = anchors.find((a) => a.role === "resolution")?.page_id ?? null;
    const si = pageIndexOf(promisePageId);
    const pi = pageIndexOf(resolutionPageId);
    if (si != null && si < ci && (pi == null || pi > ci)) {
      lines.push(`- WITHHOLD "${t.name}"${desc}: already in play; keep it alive but do NOT resolve it here.`);
    }
  }
  return lines.length ? `OPEN LOOPS (promises in play on this page — manage them deliberately):\n${lines.join("\n")}` : null;
}

// tiptapToText lives in _shared/words.ts now; re-export so existing importers (generate-book) keep working.
export { tiptapToText };

// ── Prompt assembly ──────────────────────────────────────────────────────────
const SYSTEM = `You are a skilled prose writer helping an author render their book.
The author works in OBJECTIVES: a short statement of what a unit of the book must achieve.
Your job is to write the prose that achieves the given objective, in the book's voice and
consistent with the rest of the book.

Rules:
- Write ONLY the prose. No preamble, no titles, no headings (no "#" lines), no markdown
  fences, no meta commentary. The page already has its title — never restate it.
- Honor the book's brief as a non-negotiable contract — its VOICE (genre, audience, tone, premise)
  AND its MANDATE (what the book must deliver: the success criteria, heat/explicitness, genre
  obligations, and length). When a voice sample is provided it is the strongest STYLE anchor:
  match its register, rhythm, and diction above all else, including above the register of any beat
  or objective text. But style anchoring governs HOW the page reads, never WHAT it delivers — it is
  never license to soften, abstract, or fade-to-black a mandated beat, nor to fall short of length.
- The beat is a STORY PLAN — follow what it says must happen and in what order, but ignore
  its prose style entirely. The beat tells you WHAT; the brief and voice sample tell you HOW.
- Use the outline and preceding prose for consistency, facts, AND dramatic irony. The reader
  has seen every preceding page; you may write for that shared awareness even when the POV
  character hasn't — let the reader know more than the narrator does when the story calls for it.
  Do NOT repeat what's already been written; do NOT continue or finish a sentence from the
  preceding prose — begin this unit cleanly with a new sentence.
- Write a COMPLETE passage that ends at a natural stopping point — a finished sentence.
  Never stop mid-sentence.
- Serve the objective precisely; do not wander beyond what it asks.
- Match the requested length: a single paragraph means ONE paragraph.
- CAST VOICES & POV: If CAST VOICES are provided, render each character's dialogue in their
  distinct idiolect (diction, tics, register). Let the POV character's history color what they
  notice and how they phrase things — interiority should feel earned by their background.
- NARRATION: Honor the POV and NARRATION block exactly — person, tense, and distance are the
  author's structural choice, not suggestions.
- ESTABLISHED FACTS & WORLD: Never contradict any fact in the ESTABLISHED FACTS block or any
  rule in the WORLD block. These are hard continuity constraints.`;

const SYSTEM_REVISE = `You are a developmental line editor revising a page of an author's book to address specific editorial notes.

Rules:
- Output ONLY the revised page prose. No preamble, no titles, no headings ("#" lines), no
  markdown fences, no meta commentary, no list of what you changed.
- Address EVERY note. Make the concrete change each note calls for — don't merely gesture at it.
- PRESERVE what works: keep the page's strengths, structure, and the author's voice. Change
  only what the notes require — this is a revision, not a rewrite from scratch.
- Honor the book's brief (genre, audience, tone, premise) and stay consistent with the
  surrounding pages (names, facts, continuity).
- Return a COMPLETE page that ends on a finished sentence.`;


interface PromptArgs {
  brief: Brief | null;
  voiceSample: string | null;
  canon: CanonPacket | null;
  bookName: string;
  level: "paragraph" | "page";
  mode: "write" | "revise";
  /** The author's sticky "prose" steer (write mode only); "" when none. */
  steer: string;
  objective: string;
  beat: string | null;
  issues: ReviseIssue[] | null;
  currentText: string | null;
  pageObjective: string | null;
  precedingText: string | null;
  objectiveMap: string;
  storySoFar: string | null;
  precedingProse: string | null;
  currentPageLabel: string | null;
  openLoops: string | null;
  characterStates: string | null;
  // F1/F2/F3a/F4a stable context
  foundations: Foundations | null;
  craftNoteProse: string | null;   // the prose-layer craft note from books.craft_notes
  // F2: per-page relationship states (from the most recent prior page with relationship_states)
  relationshipStates: string | null;
  // F3b: established facts from bible.facts with page_index < current
  establishedFacts: string | null;
  // F3c: story-time for this page (from metadata.time)
  storyTime: string | null;
  // F4a: POV character for this page
  pov: string | null;
  // F4a: book-level narration defaults (from foundations.narration)
  narration: Narration | null;
  // C4: per-page word target derived from brief.scope.word_target / content-page count (0 = omit)
  perPageWordTarget?: number;
}

function formatIssues(issues: ReviseIssue[]): string {
  return issues
    .map((is) => {
      const sev = is.severity ? `[${is.severity}] ` : "";
      const cat = is.section ? `(${is.section}) ` : "";
      const ev = is.evidence ? `  evidence: "${is.evidence}"` : "";
      const sug = is.suggestion ? `  → ${is.suggestion}` : "";
      return `- ${sev}${cat}${is.note}${ev}${sug}`;
    })
    .join("\n");
}

// A short blocklist of phrases that read as machine-generated; paired with the voice sample so the
// renderer has both a target to imitate and tells to avoid (the biggest single "this is AI" signal).
const VOICE_TELLS = `"a testament to", "in a world where", "little did they know", "sent shivers down", "couldn't help but", "a mix of … and …", "navigating the complexities of", and neat moral-of-the-story endings`;

// Render a CAST VOICES block from foundations.cast: only for members that have at least one of
// idiolect/history/tag. Returns null when no member qualifies (block is skipped entirely).
function renderCastVoices(cast: CastMember[] | undefined): string | null {
  if (!cast?.length) return null;
  const lines = cast
    .filter((m) => m.idiolect?.trim() || m.history?.trim() || m.tag?.trim())
    .map((m) => {
      const label = [m.name, m.tag?.trim() && `— ${m.tag.trim()}`].filter(Boolean).join(" ");
      const body = [`speaks ${m.idiolect?.trim() || "—"}`, m.history?.trim()].filter(Boolean).join(". ");
      return `- ${label}: ${body}`;
    });
  if (!lines.length) return null;
  return `CAST VOICES (render each character's dialogue in their idiolect; let a character's history color what they notice and how they phrase things):\n${lines.join("\n")}`;
}

// Render the WORLD block from foundations.world. Returns null when empty.
function renderWorld(world: WorldNode | undefined): string | null {
  if (!world) return null;
  const parts: string[] = [];
  if (world.setting?.trim()) parts.push(world.setting.trim());
  if (world.period?.trim()) parts.push(`period: ${world.period.trim()}`);
  if (world.rules?.length) parts.push(`rules:\n${world.rules.map((r) => `- ${r}`).join("\n")}`);
  if (!parts.length) return null;
  return `WORLD (setting, period, and rules — never contradict these):\n${parts.join("\n")}`;
}

// Render NARRATION from foundations.narration. Returns null when unset.
function renderNarration(narration: Narration | null | undefined): string | null {
  if (!narration) return null;
  const parts = [
    narration.person && `in ${narration.person}`,
    narration.tense && `${narration.tense} tense`,
    narration.distance?.trim(),
  ].filter(Boolean);
  if (!parts.length) return null;
  return `NARRATION (the book's default narrative mode — honor it):\nNarrate ${parts.join(", ")}.`;
}

function stablePrefix(args: PromptArgs): string {
  const castVoices = renderCastVoices(args.foundations?.cast ?? undefined);
  const world = renderWorld(args.foundations?.world ?? undefined);
  const narration = renderNarration(args.narration);
  const _mandate = mandateContext(args.brief);
  return [
    `BOOK: ${args.bookName}`,
    `\nBRIEF — binding contract (voice AND deliverables):\n${briefContext(args.brief, { scope: "band", success: true, none: "(no brief set — infer a sensible neutral voice)", empty: "(brief is empty — infer a sensible neutral voice)" })}`,
    _mandate ? `\nMANDATE — NON-NEGOTIABLE (the book has FAILED if any of these are not delivered; do not treat them as flavor):\n${_mandate}` : "",
    args.canon ? `\nCANON (settled facts from the previous book — honor, never contradict, never retell):\n${canonContext(args.canon)}` : "",
    args.voiceSample
      ? `\nVOICE SAMPLE (write in THIS voice — match its rhythm, sentence shapes, diction and restraint; this exemplar is a stronger style anchor than any instruction):\n"""\n${args.voiceSample}\n"""\nAvoid AI-tell crutches: ${VOICE_TELLS}.`
      : "",
    // F1: per-character voice differentiation (after voice sample, before outline)
    castVoices ? `\n${castVoices}` : "",
    // F3a: pinned world/setting node
    world ? `\n${world}` : "",
    // F4a: book-level narration defaults
    narration ? `\n${narration}` : "",
    // F4a: prose-layer craft note authored in the studio (currently never reached draft — close the gap)
    args.craftNoteProse?.trim() ? `\nCRAFT NOTE (author's guidance for this book's prose — apply it):\n${args.craftNoteProse.trim()}` : "",
    args.objectiveMap ? `\nOUTLINE (the book's pages and their objectives, in order):\n${args.objectiveMap}` : "",
  ].filter(Boolean).join("\n");
}

function variablePart(args: PromptArgs): string {
  if (args.mode === "revise") {
    const parts: string[] = [];
    if (args.storySoFar) {
      parts.push(`STORY SO FAR (summaries of earlier pages, for continuity):\n${args.storySoFar}`);
    }
    if (args.precedingProse) {
      parts.push(`PRECEDING PROSE (the page(s) just before this one — for continuity of voice, facts, and dramatic irony; the reader has seen everything here):\n"""\n${args.precedingProse}\n"""`);
    }
    const where = args.currentPageLabel ? ` ${args.currentPageLabel}` : "";
    if (args.objective) parts.push(`This page${where} is meant to achieve: ${args.objective}`);
    if (args.characterStates) parts.push(args.characterStates);
    if (args.relationshipStates) parts.push(args.relationshipStates);
    if (args.openLoops) parts.push(args.openLoops);
    if (args.establishedFacts) parts.push(args.establishedFacts);
    if (args.storyTime) parts.push(`STORY TIME: ${args.storyTime}`);
    if (args.pov) parts.push(`POV: ${args.pov}`);
    parts.push(`CURRENT PAGE PROSE (revise this in place):\n"""\n${args.currentText ?? ""}\n"""`);
    parts.push(`THE EDITOR'S NOTES TO ADDRESS ON THIS PAGE:\n${formatIssues(args.issues ?? [])}`);
    parts.push(`Revise the page to address every note above while preserving its strengths, the book's voice, and continuity with the rest of the book. Return the full revised page prose only.`);
    return parts.join("\n\n");
  }

  const parts: string[] = [];
  if (args.storySoFar) {
    parts.push(`STORY SO FAR (summaries of earlier pages, for continuity):\n${args.storySoFar}`);
  }
  if (args.precedingProse) {
    parts.push(`PRECEDING PROSE (the pages just before this one — for continuity of voice, facts, and dramatic irony; the reader has seen everything here, so you may write for that shared awareness even when the POV character hasn't; do not continue or finish its last sentence, and do not repeat what's already been said):\n"""\n${args.precedingProse}\n"""`);
  }
  if (args.characterStates && args.level === "page") {
    parts.push(args.characterStates);
  }
  // F2: relationship states alongside character states (page-level only)
  if (args.relationshipStates && args.level === "page") {
    parts.push(args.relationshipStates);
  }
  if (args.openLoops && args.level === "page") {
    parts.push(args.openLoops);
  }
  // F3b: established facts the model must not contradict (page-level only)
  if (args.establishedFacts && args.level === "page") {
    parts.push(args.establishedFacts);
  }
  // F3c: story-time orientation
  if (args.storyTime && args.level === "page") {
    parts.push(`STORY TIME: ${args.storyTime}`);
  }
  // F4a: POV — page-level pov when set. Narrative mode (person/tense) comes from the NARRATION block
  // above (foundations.narration); here we just render a POV line so the model holds the viewpoint.
  if (args.level === "page") {
    const povName = args.pov ?? null;
    if (povName) parts.push(`POV: ${povName}`);
  }
  if (args.level === "paragraph") {
    if (args.pageObjective) parts.push(`This paragraph sits on a page whose objective is: ${args.pageObjective}`);
    if (args.precedingText) parts.push(`The prose immediately before this paragraph (continue naturally):\n"""\n${args.precedingText}\n"""`);
    parts.push(`\nWrite ONE paragraph that achieves this objective:\n${args.objective}`);
  } else {
    // C4: inject per-page word target (page level only, write mode)
    if (args.mode !== "revise" && (args.perPageWordTarget ?? 0) > 0) {
      parts.push(`TARGET LENGTH: aim for ~${args.perPageWordTarget} words for this page. This is a hard requirement from the brief's length mandate — do not stop short; write the full scene.`);
    }
    const where = args.currentPageLabel ? ` for the page ${args.currentPageLabel}` : "";
    if (args.beat) {
      // Beat present: write to the beat (the page's concrete plan), in service of the objective.
      // Explicitly separate WHAT (beat) from HOW (voice sample / brief) so the model doesn't
      // absorb the beat's prose register as a style signal.
      parts.push(`\nWrite the prose${where} (multiple paragraphs as needed) that realizes this BEAT. The beat is the STORY PLAN — follow what it says must happen and in what order; do not imitate its prose style. All voice, tone, and register come from the brief and voice sample above.\nOBJECTIVE (the aim): ${args.objective}\nBEAT (the story plan — what must happen, not how to sound): ${args.beat}`);
    } else {
      parts.push(`\nWrite the prose${where} that achieves this objective (multiple paragraphs as needed):\n${args.objective}`);
    }
  }
  if (args.steer) parts.push(steerBlock(args.steer).trimStart());
  return parts.join("\n\n");
}

// ── Claude call ──────────────────────────────────────────────────────────────
async function renderProse(apiKey: string, model: string, args: PromptArgs, meta: CallMeta): Promise<string> {
  const data = await callClaudeApi(apiKey, {
    model,
    max_tokens: args.mode === "revise" || args.level === "page" ? 8000 : 600,
    system: [{ type: "text", text: args.mode === "revise" ? SYSTEM_REVISE : SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: stablePrefix(args), cache_control: { type: "ephemeral" } },
          { type: "text", text: variablePart(args) },
        ],
      },
    ],
  }, meta);

  const text = textFromClaude(data).trim();
  if (!text) throw new Error("Claude returned no text content.");
  return stripLeadingHeadings(text);
}

function stripLeadingHeadings(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].trim() === "" || /^#{1,6}\s+/.test(lines[i].trim()))) i++;
  return lines.slice(i).join("\n").trim() || text;
}

// ── Summary (layer D) ────────────────────────────────────────────────────────
// F3c: the summarizer now returns a tiny JSON envelope `{summary, time}` so we can also extract
// a story-time stamp in the same call. Shape:
//   { "summary": "1-2 sentence summary", "time": { "when": "...", "elapsed": "..." } }
// `time` is optional — the model omits it when time cannot be inferred.
// The summary string behavior is preserved; `time` is additive and stored in metadata.time.
interface SummarizeResult { summary: string; time?: { when?: string; elapsed?: string } }

async function summarize(apiKey: string, prose: string, meta: CallMeta, summaryModel?: string): Promise<SummarizeResult> {
  const data = await callClaudeApi(apiKey, {
    model: summaryModel ?? DEFAULT_LOW_MODEL,
    max_tokens: 300,
    system: [{
      type: "text",
      text: `Summarize this page of a book and extract any story-time cue.
Output JSON ONLY (no prose, no fences):
{"summary":"1-2 sentences: what happens and any new facts a later page needs","time":{"when":"time of day/story moment if clear","elapsed":"duration since story start if clear"}}
Omit "time" or its sub-keys if they cannot be inferred from the prose. "summary" is required.`,
      cache_control: { type: "ephemeral" },
    }],
    messages: [{ role: "user", content: prose.slice(0, 12000) }],
  }, { ...meta, fn: "summarize", artifacts: null });
  const raw = textFromClaude(data).trim();
  // Parse the JSON envelope; fall back to treating the whole response as a plain summary if it fails
  // (backward compat — old callers may not have had JSON output, and we never want to lose the summary).
  try {
    const parsed = JSON.parse(extractJsonBlock(raw)) as { summary?: unknown; time?: unknown };
    const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : raw;
    const timeRaw = parsed.time && typeof parsed.time === "object" ? parsed.time as Record<string, unknown> : null;
    const when = typeof timeRaw?.when === "string" && timeRaw.when.trim() ? timeRaw.when.trim() : undefined;
    const elapsed = typeof timeRaw?.elapsed === "string" && timeRaw.elapsed.trim() ? timeRaw.elapsed.trim() : undefined;
    const time = (when || elapsed) ? { when, elapsed } : undefined;
    return { summary, time };
  } catch {
    // JSON parse miss — treat entire response as the summary string (graceful degradation)
    return { summary: raw };
  }
}

async function persistSummary(client: SupabaseClient, pageId: number, summary: string, time: { when?: string; elapsed?: string } | null) {
  const { data } = await client.from("pages").select("metadata").eq("id", pageId).maybeSingle();
  const existing = (data?.metadata as Record<string, unknown> | null) ?? {};
  const metadata: Record<string, unknown> = { ...existing, summary };
  if (time) metadata.time = time; // F3c: store story-time alongside summary
  await client.from("pages").update({ metadata }).eq("id", pageId);
}

// ── Character + Relationship ledger (the state axis) ─────────────────────────────────────────
// After a page's prose is written, stamp a FULL snapshot of every character's state AND every
// relationship's current charge onto the page (pages.metadata.*). The next page's prose context
// reads this (buildUnitContext) — so characters and dyads accrete state instead of resetting.
// F2: relationship_states are now extracted in the SAME JSON envelope as characters (one LLM call).
// Best-effort: a failure here only weakens continuity, it never fails the write.
async function maybeExtractCharacterStates(
  client: SupabaseClient,
  apiKey: string,
  bookId: number,
  pageId: number,
  prose: string,
  m: CallMeta,
  model?: string,
) {
  try {
    const [priorChars, priorRel] = await Promise.all([
      priorCharacterStates(client, bookId, pageId),
      priorRelStates(client, bookId, pageId),
    ]);
    const extracted = await extractStates(apiKey, prose, priorChars, priorRel, m, model);
    if (extracted.characters.length || extracted.relationship_states.length) {
      const { data } = await client.from("pages").select("metadata").eq("id", pageId).maybeSingle();
      const existing = (data?.metadata as Record<string, unknown> | null) ?? {};
      const metadata: Record<string, unknown> = { ...existing };
      if (extracted.characters.length) metadata.character_states = extracted.characters;
      if (extracted.relationship_states.length) metadata.relationship_states = extracted.relationship_states;
      await client.from("pages").update({ metadata }).eq("id", pageId);
    }
    // F3b: fold world deltas from this page into books.bible.facts (best-effort, errors swallowed)
    await maybeFoldWorldFacts(client, bookId, pageId, m);
  } catch (e) {
    console.error("generate-unit-core: character-state extraction failed (non-fatal):", e);
  }
}

// The latest full character snapshot from a page strictly before this one (most recent wins).
async function priorCharacterStates(client: SupabaseClient, bookId: number, pageId: number): Promise<CharacterState[]> {
  const { data: rows } = await client
    .from("pages").select("id, page_index, metadata")
    .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
  const list = (rows as PageLite[] | null) ?? [];
  const cur = list.find((p) => p.id === pageId);
  if (!cur) return [];
  const prior = list.filter((p) => p.page_index < cur.page_index && (p.metadata?.character_states?.length ?? 0) > 0).at(-1);
  return prior?.metadata?.character_states ?? [];
}

// F2: latest relationship snapshot from a page strictly before this one.
async function priorRelStates(client: SupabaseClient, bookId: number, pageId: number): Promise<RelationshipState[]> {
  const { data: rows } = await client
    .from("pages").select("id, page_index, metadata")
    .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
  const list = (rows as PageLite[] | null) ?? [];
  const cur = list.find((p) => p.id === pageId);
  if (!cur) return [];
  const prior = list.filter((p) => p.page_index < cur.page_index && (p.metadata?.relationship_states?.length ?? 0) > 0).at(-1);
  return prior?.metadata?.relationship_states ?? [];
}

// F2: combined extractor — one LLM call returns {characters, relationship_states}.
// relationship_states shape: [{pair, charge, note}] — carry forward unchanged dyads,
// update when the page shifts a charge.
async function extractStates(
  apiKey: string,
  prose: string,
  priorChars: CharacterState[],
  priorRel: RelationshipState[],
  meta: CallMeta,
  model?: string,
): Promise<{ characters: CharacterState[]; relationship_states: RelationshipState[] }> {
  const priorCharsBlock = priorChars.length ? JSON.stringify(priorChars) : "(none yet — first page with characters)";
  const priorRelBlock = priorRel.length ? JSON.stringify(priorRel) : "(none yet)";
  const data = await callClaudeApi(apiKey, {
    model: model ?? DEFAULT_LOW_MODEL,
    max_tokens: 2000,
    system: [{
      type: "text",
      text: `You track character and relationship state across a story for continuity. Given the PRIOR states and a NEW page of prose, output the UPDATED state of EVERY character AND EVERY relationship.
Rules for characters: carry forward unchanged characters exactly; update knows/feels/has/believes for any the page affected; keep want and wound stable once set; add a character only if they clearly matter going forward. Be terse; omit empty fields.
Rules for relationships: carry forward unchanged dyads exactly; update charge/note when the page clearly shifts a dyad; add a dyad only if the page establishes a significant bond. Use the pair format "Name A / Name B" consistently. Be terse.
Output JSON ONLY (no prose, no fences):
{"characters":[{"name":"","want":"","wound":"","believes":"","knows":[""],"feels":"","has":[""]}],"relationship_states":[{"pair":"Name A / Name B","charge":"","note":""}]}`,
      cache_control: { type: "ephemeral" },
    }],
    messages: [{
      role: "user",
      content: `PRIOR CHARACTER STATES:\n${priorCharsBlock}\n\nPRIOR RELATIONSHIP STATES:\n${priorRelBlock}\n\nNEW PAGE PROSE:\n${prose.slice(0, 12000)}\n\nOutput the updated states for every character and every relationship. JSON only.`,
    }],
  }, { ...meta, fn: "extract-character-states", artifacts: null });

  const text = textFromClaude(data).trim();
  return parseExtractedStates(text);
}

function parseExtractedStates(text: string): { characters: CharacterState[]; relationship_states: RelationshipState[] } {
  let parsed: { characters?: unknown; relationship_states?: unknown };
  try {
    parsed = JSON.parse(extractJsonBlock(text));
  } catch {
    return { characters: [], relationship_states: [] };
  }
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const arr = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out = v.map((x) => String(x ?? "").trim()).filter(Boolean);
    return out.length ? out : undefined;
  };
  const characters = Array.isArray(parsed.characters)
    ? (parsed.characters as Array<Record<string, unknown>>)
        .map((c) => ({
          name: str(c.name) ?? "",
          want: str(c.want), wound: str(c.wound), believes: str(c.believes),
          knows: arr(c.knows), feels: str(c.feels), has: arr(c.has),
        }))
        .filter((c) => c.name)
        .slice(0, 24)
    : [];
  const relationship_states = Array.isArray(parsed.relationship_states)
    ? (parsed.relationship_states as Array<Record<string, unknown>>)
        .map((r) => ({
          pair: str(r.pair) ?? "",
          charge: str(r.charge) ?? "",
          note: str(r.note),
        }))
        .filter((r) => r.pair && r.charge)
        .slice(0, 32)
    : [];
  return { characters, relationship_states };
}

// F3b: fold this page's extracted_delta entries of type "world" into books.bible.facts.
// Appends, deduplicates by fact text (case-insensitive), and writes back. Best-effort.
async function maybeFoldWorldFacts(
  client: SupabaseClient,
  bookId: number,
  pageId: number,
  _m: CallMeta,
) {
  try {
    const { data: pg } = await client.from("pages").select("page_index, metadata").eq("id", pageId).maybeSingle();
    if (!pg) return;
    const metadata = pg.metadata as PageState | null;
    const worldDeltas = (metadata?.extracted_delta ?? []).filter((d) => d.type === "world");
    if (!worldDeltas.length) return;

    const { data: bookRow } = await client.from("books").select("bible").eq("id", bookId).maybeSingle();
    const existingBible = (bookRow?.bible ?? {}) as Record<string, unknown>;
    const existingFacts = Array.isArray(existingBible.facts)
      ? (existingBible.facts as BibleFact[])
      : [];
    // Dedup by fact text (case-insensitive trim).
    const existingTexts = new Set(existingFacts.map((f) => f.fact.trim().toLowerCase()));
    const newFacts: BibleFact[] = [];
    for (const d of worldDeltas) {
      // Use d.to as the canonical fact text; fall back to rendering subject + to if to is short.
      const factText = d.to?.trim() || `${d.subject}: ${d.to}`.trim();
      if (!factText || existingTexts.has(factText.toLowerCase())) continue;
      existingTexts.add(factText.toLowerCase());
      newFacts.push({ fact: factText, page_index: pg.page_index });
    }
    if (!newFacts.length) return;
    const updatedBible = { ...existingBible, facts: [...existingFacts, ...newFacts] };
    await client.from("books").update({ bible: updatedBible }).eq("id", bookId);
  } catch (e) {
    console.error("generate-unit-core: world-facts fold failed (non-fatal):", e);
  }
}
