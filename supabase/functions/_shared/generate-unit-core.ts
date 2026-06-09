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
import { callClaude as callClaudeApi, type CallMeta } from "./claude.ts";
import { getActiveModels } from "./model-config.ts";
const PRECEDING_PAGES = 2; // how many prior text pages of full prose to include for continuity

export interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}

// A single editorial note to address when revising a page (from book_evaluations result).
export interface ReviseIssue {
  section?: string;
  severity?: string;
  note: string;
  evidence?: string;
  suggestion?: string;
}

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

interface BookRow {
  id: number;
  name: string;
  brief: Brief | null;
  bible: { text?: string } | null;
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

async function loadBook(client: SupabaseClient, bookId: number): Promise<BookRow> {
  const { data: book, error } = await client
    .from("books").select("id, name, subtitle, author, brief, bible").eq("id", bookId).single();
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
  const text = await renderProse(apiKey, models.high, {
    brief: b.brief, bible: b.bible?.text?.trim() || null, bookName: b.name,
    level: p.level, mode: "write", objective: (p.objective ?? "").trim(), beat, issues: null, currentText: null,
    pageObjective: p.pageObjective?.trim() || null, precedingText: p.precedingText?.trim() || null,
    objectiveMap: ctx.objectiveMap, storySoFar: ctx.storySoFar, precedingProse: ctx.precedingProse, currentPageLabel: ctx.currentPageLabel,
  }, m);

  if (p.level === "page" && p.pageId) await maybeSummarize(client, apiKey, p.pageId, text, m, models.low);
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
  const text = await renderProse(apiKey, models.high, {
    brief: b.brief, bible: b.bible?.text?.trim() || null, bookName: b.name,
    level: "page", mode: "revise", objective: (p.objective ?? "").trim(), beat: null, issues: p.issues, currentText,
    pageObjective: null, precedingText: null,
    objectiveMap: ctx.objectiveMap, storySoFar: ctx.storySoFar, precedingProse: ctx.precedingProse, currentPageLabel: ctx.currentPageLabel,
  }, m);

  await maybeSummarize(client, apiKey, p.pageId, text, m, models.low);
  return text;
}

// Cheap one-paragraph "story so far" summary for later pages' continuity. Best-effort.
async function maybeSummarize(client: SupabaseClient, apiKey: string, pageId: number, text: string, m: CallMeta, summaryModel?: string) {
  try {
    const summary = await summarize(apiKey, text, m, summaryModel);
    if (summary) await persistSummary(client, pageId, summary);
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
  metadata: { objective?: string; summary?: string } | null;
}

export async function buildUnitContext(
  client: SupabaseClient,
  bookId: number,
  pageId: number | null,
  level: "paragraph" | "page"
): Promise<{ objectiveMap: string; storySoFar: string | null; precedingProse: string | null; currentPageLabel: string | null }> {
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
  let storySoFar: string | null = null;
  if (level === "page" && current) {
    const priorText = list.filter((p) => p.page_type === "text" && p.page_index < current.page_index);

    const summarized = priorText.slice(0, Math.max(0, priorText.length - PRECEDING_PAGES));
    const soFar = summarized
      .map((p) => p.metadata?.summary?.trim())
      .filter((s): s is string => !!s);
    storySoFar = soFar.length ? soFar.join("\n") : null;

    const priorIds = priorText.slice(-PRECEDING_PAGES).map((p) => p.id);
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

  return { objectiveMap, storySoFar, precedingProse, currentPageLabel };
}

export function tiptapToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  let out = "";
  for (const child of n.content ?? []) out += tiptapToText(child);
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(n.type ?? "")) out += "\n\n";
  return out;
}

// ── Prompt assembly ──────────────────────────────────────────────────────────
const SYSTEM = `You are a skilled prose writer helping an author render their book.
The author works in OBJECTIVES: a short statement of what a unit of the book must achieve.
Your job is to write the prose that achieves the given objective, in the book's voice and
consistent with the rest of the book.

Rules:
- Write ONLY the prose. No preamble, no titles, no headings (no "#" lines), no markdown
  fences, no meta commentary. The page already has its title — never restate it.
- Honor the book's brief — genre, audience, tone, premise — as the voice contract.
- Use the bible, outline, and preceding prose ONLY for consistency — keep names, facts, and
  tone aligned, and don't repeat what's already been written. Do NOT continue or finish a
  sentence from the preceding prose: begin this unit cleanly with a new sentence.
- Write a COMPLETE passage that ends at a natural stopping point — a finished sentence.
  Never stop mid-sentence.
- Serve the objective precisely; do not wander beyond what it asks.
- Match the requested length: a single paragraph means ONE paragraph.`;

const SYSTEM_REVISE = `You are a developmental line editor revising a page of an author's book to address specific editorial notes.

Rules:
- Output ONLY the revised page prose. No preamble, no titles, no headings ("#" lines), no
  markdown fences, no meta commentary, no list of what you changed.
- Address EVERY note. Make the concrete change each note calls for — don't merely gesture at it.
- PRESERVE what works: keep the page's strengths, structure, and the author's voice. Change
  only what the notes require — this is a revision, not a rewrite from scratch.
- Honor the book's brief (genre, audience, tone, premise) and stay consistent with the bible
  and the surrounding pages (names, facts, continuity).
- Return a COMPLETE page that ends on a finished sentence.`;

function briefContext(brief: Brief | null): string {
  if (!brief) return "(no brief set — infer a sensible neutral voice)";
  const lines: string[] = [];
  if (brief.scope?.band) lines.push(`- Scope: ${brief.scope.band}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : "(brief is empty — infer a sensible neutral voice)";
}

interface PromptArgs {
  brief: Brief | null;
  bible: string | null;
  bookName: string;
  level: "paragraph" | "page";
  mode: "write" | "revise";
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

function stablePrefix(args: PromptArgs): string {
  return [
    `BOOK: ${args.bookName}`,
    `\nBRIEF (the voice contract):\n${briefContext(args.brief)}`,
    args.bible ? `\nBOOK BIBLE (established facts — characters, world, style; stay strictly consistent):\n${args.bible}` : "",
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
      parts.push(`PRECEDING PROSE (the page(s) just before this one — for continuity of voice and facts ONLY):\n"""\n${args.precedingProse}\n"""`);
    }
    const where = args.currentPageLabel ? ` ${args.currentPageLabel}` : "";
    if (args.objective) parts.push(`This page${where} is meant to achieve: ${args.objective}`);
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
    parts.push(`PRECEDING PROSE (the pages just before this one — for continuity of voice and facts ONLY; do not continue or finish its last sentence, and don't repeat it):\n"""\n${args.precedingProse}\n"""`);
  }
  if (args.level === "paragraph") {
    if (args.pageObjective) parts.push(`This paragraph sits on a page whose objective is: ${args.pageObjective}`);
    if (args.precedingText) parts.push(`The prose immediately before this paragraph (continue naturally):\n"""\n${args.precedingText}\n"""`);
    parts.push(`\nWrite ONE paragraph that achieves this objective:\n${args.objective}`);
  } else {
    const where = args.currentPageLabel ? ` for the page ${args.currentPageLabel}` : "";
    if (args.beat) {
      // Beat present: write to the beat (the page's concrete plan), in service of the objective.
      parts.push(`\nWrite the prose${where} (multiple paragraphs as needed) that realizes this BEAT — the page's plan for what happens, in order — while fulfilling its objective.\nOBJECTIVE (the aim): ${args.objective}\nBEAT (follow this plan): ${args.beat}`);
    } else {
      parts.push(`\nWrite the prose${where} that achieves this objective (multiple paragraphs as needed):\n${args.objective}`);
    }
  }
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

  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
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
async function summarize(apiKey: string, prose: string, meta: CallMeta, summaryModel?: string): Promise<string> {
  const data = await callClaudeApi(apiKey, {
    model: summaryModel ?? "claude-haiku-4-5-20251001",
    max_tokens: 250,
    system: [{
      type: "text",
      text: "Summarize this page of a book in 1-2 sentences: what happens and any new facts (characters, places, changes in state) a later page would need to stay consistent. Plain text only, no preamble.",
      cache_control: { type: "ephemeral" },
    }],
    messages: [{ role: "user", content: prose.slice(0, 12000) }],
  }, { ...meta, fn: "summarize" });
  return (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
}

async function persistSummary(client: SupabaseClient, pageId: number, summary: string) {
  const { data } = await client.from("pages").select("metadata").eq("id", pageId).maybeSingle();
  const metadata = { ...((data?.metadata as Record<string, unknown> | null) ?? {}), summary };
  await client.from("pages").update({ metadata }).eq("id", pageId);
}
