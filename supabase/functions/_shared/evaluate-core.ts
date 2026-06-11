// evaluate-core — the pure "editor's read" worker, extracted from evaluate-book/index.ts so both the
// user-triggered evaluation AND the closed auto-revise loop run the byte-identical map-reduce eval and
// write book_evaluations the same way. No auth, no row insert — the caller owns those and passes the
// evalId of a book_evaluations row already in 'pending'.
//
// A 50+ page book needs a ~9k-token report; one call takes ~150s and collides with the Supabase
// worker wall-clock. We split the REPORT (not the book) across calls that each read the WHOLE
// manuscript — so no global judgment (arc, payoff, obligatory scenes) is made on a partial book — and
// each emits only a slice of the report. They run in parallel; a verdict call synthesizes.
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { EDITOR_STANCE, FICTION_RUBRIC } from "../evaluate-book/rubric.ts";
import { captureException, isBillingError } from "./sentry.ts";
import { callClaude as callClaudeApi, type CallMeta } from "./claude.ts";

export interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
}
export interface BookRow {
  id: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  brief: Brief | null;
}

// brief.scope.band values that mean non-fiction (mirrors apps/web/src/lib/brief.ts).
export const NONFICTION_BANDS = new Set(["essay", "guide", "nonfiction_book", "comprehensive"]);

const SECTION_TITLES: Record<string, string> = {
  character: "Character",
  plot: "Plot",
  pacing: "Pacing",
  dialogue: "Dialogue",
  prose: "Prose & Style",
  genre_contract: "Genre Contract",
  world_building: "World-Building",
  resonance: "Emotional & Thematic Resonance",
  mechanics: "Presentation & Mechanics",
};
// Three parallel groups. Each call reads the whole book but only writes these dimensions.
const GROUPS: { name: string; sections: string[] }[] = [
  { name: "story", sections: ["character", "plot", "pacing"] },
  { name: "craft", sections: ["dialogue", "prose"] },
  { name: "whole", sections: ["genre_contract", "world_building", "resonance", "mechanics"] },
];
const CANONICAL_ORDER = [
  "character", "plot", "pacing", "dialogue", "prose",
  "genre_contract", "world_building", "resonance", "mechanics",
];

// Run a full evaluation for a book_evaluations row already inserted as 'pending'; updates it to
// 'done' (with result + word_count) or 'error'. Mirrors the original evaluate-book background body.
export async function runEvaluation(
  service: SupabaseClient,
  apiKey: string,
  evalId: number,
  book: BookRow,
  evalModel: string,
) {
  try {
    const { data: pages, error: pagesError } = await service
      .from("pages")
      .select("id, title, content, html_content, page_index, page_type")
      .eq("book_id", book.id)
      .eq("archived", false)
      .order("page_index", { ascending: true });
    if (pagesError) throw new Error(`fetch pages: ${pagesError.message}`);
    if (!pages || pages.length === 0) throw new Error("Book has no pages to evaluate.");

    const { manuscript, wordCount } = buildManuscript(book, pages as PageRow[]);
    const logBase: Omit<CallMeta, "fn"> = { bookId: book.id, taskTable: "book_evaluations", taskId: evalId };
    const result = await evaluateMapReduce(apiKey, evalModel, book, manuscript, logBase);

    const { error: updateError } = await service
      .from("book_evaluations")
      .update({ status: "done", result, word_count: wordCount })
      .eq("id", evalId);
    if (updateError) throw new Error(`save result: ${updateError.message}`);
  } catch (e) {
    console.error(`evaluate-core run ${evalId} failed:`, e);
    const billing = isBillingError(e);
    await captureException(e, { function: "evaluate-core", book_id: String(book.id), billing: String(billing) });
    const userMsg = billing
      ? "AI credits exhausted — the team has been notified."
      : String((e as Error)?.message ?? e).slice(0, 1000);
    await service
      .from("book_evaluations")
      .update({ status: "error", error: userMsg })
      .eq("id", evalId);
  }
}

// ── Manuscript assembly ──────────────────────────────────────────────────────
interface PageRow {
  id: number;
  title: string | null;
  content: unknown;
  html_content: string | null;
  page_index: number;
  page_type: string | null;
}

function buildManuscript(book: BookRow, pages: PageRow[]) {
  const head = [
    `TITLE: ${book.name}${book.subtitle ? ` — ${book.subtitle}` : ""}`,
    book.author ? `AUTHOR: ${book.author}` : null,
    briefContext(book.brief),
    "",
    "MANUSCRIPT (each page is marked with its real id — cite issues using ONLY these ids):",
  ].filter(Boolean).join("\n");

  let wordCount = 0;
  const body = pages
    .map((p) => {
      const text = pageText(p);
      wordCount += countWords(text);
      const kind = p.page_type === "section" ? " (section divider)" : "";
      return `\n[id=${p.id} · #${p.page_index} · "${p.title ?? "Untitled"}"${kind}]\n${text}`;
    })
    .join("\n");

  return { manuscript: `${head}\n${body}`, wordCount };
}

function briefContext(brief: Brief | null): string | null {
  if (!brief) return null;
  const lines: string[] = ["AUTHOR'S BRIEF (the contract to judge against):"];
  const b = brief.scope?.band;
  const wt = brief.scope?.word_target;
  if (b || wt) lines.push(`- Scope: ${[b, wt ? `≈${wt.toLocaleString()} words` : null].filter(Boolean).join(" · ")}`);
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length > 1 ? lines.join("\n") : null;
}

// Tiptap JSON → plain text, with html_content as fallback.
function pageText(p: PageRow): string {
  const fromJson = tiptapToText(p.content).trim();
  if (fromJson) return fromJson;
  if (p.html_content) return p.html_content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

function tiptapToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  let out = "";
  for (const child of n.content ?? []) out += tiptapToText(child);
  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(n.type ?? "")) {
    out += "\n\n";
  }
  return out;
}

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

// ── Map-reduce evaluation ────────────────────────────────────────────────────
interface Triage { genre_contract: string; premise: string; is_speculative: boolean }
interface Section {
  id: string; title: string; stance: string; assessment: string;
  strengths?: string[]; issues?: unknown[];
}

async function evaluateMapReduce(apiKey: string, evalModel: string, book: BookRow, manuscript: string, logBase: Omit<CallMeta, "fn">) {
  const sharedSystem = [
    { type: "text", text: EDITOR_STANCE },
    { type: "text", text: FICTION_RUBRIC, cache_control: { type: "ephemeral" } },
    { type: "text", text: manuscript, cache_control: { type: "ephemeral" } },
  ];

  const triage = await runTriage(apiKey, evalModel, sharedSystem, logBase);

  const settled = await Promise.allSettled(
    GROUPS.map((g) => runGroup(apiKey, evalModel, sharedSystem, g, triage, logBase))
  );
  const sections: Section[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") sections.push(...r.value);
    else await captureException(r.reason, { function: "evaluate-core", phase: "group" });
  }
  if (sections.length === 0) {
    const firstErr = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw firstErr?.reason instanceof Error ? firstErr.reason : new Error("All evaluation passes failed.");
  }

  const ordered = sections
    .filter((s) => CANONICAL_ORDER.includes(s.id) && (s.id !== "world_building" || triage.is_speculative))
    .sort((a, b) => CANONICAL_ORDER.indexOf(a.id) - CANONICAL_ORDER.indexOf(b.id));

  let verdict;
  try {
    verdict = await runVerdict(apiKey, evalModel, book, ordered, triage, logBase);
  } catch (e) {
    await captureException(e, { function: "evaluate-core", phase: "verdict" });
    verdict = fallbackVerdict(ordered, triage);
  }

  return { verdict, sections: ordered };
}

async function runTriage(apiKey: string, evalModel: string, system: unknown[], logBase: Omit<CallMeta, "fn">): Promise<Triage> {
  const text = await anthropicCall(apiKey, evalModel, { ...logBase, fn: "evaluate-triage" }, {
    system,
    user:
      `You have the full manuscript above. In one pass, identify the book's genre contract so the ` +
      `detailed evaluation can judge against it.\n\nOutput ONLY this JSON (no prose, no fences):\n` +
      `{ "genre_contract": "<the contract: category + what it promises the reader; if an author ` +
      `brief is given treat it as the contract, else infer and say you inferred it>", "premise": ` +
      `"<one-sentence premise>", "is_speculative": <true if speculative/historical (fantasy, SF, ` +
      `historical, magical realism) so World-Building applies, else false> }`,
    maxTokens: 1500,
    effort: "low",
    timeoutMs: 45_000,
  });
  const t = extractJSON(text) as Partial<Triage>;
  return {
    genre_contract: String(t.genre_contract ?? "unspecified"),
    premise: String(t.premise ?? ""),
    is_speculative: Boolean(t.is_speculative),
  };
}

async function runGroup(
  apiKey: string,
  evalModel: string,
  system: unknown[],
  group: { name: string; sections: string[] },
  triage: Triage,
  logBase: Omit<CallMeta, "fn">
): Promise<Section[]> {
  const ids = group.sections.filter((id) => id !== "world_building" || triage.is_speculative);
  const menu = ids.map((id) => `${id} ("${SECTION_TITLES[id]}")`).join(", ");
  const text = await anthropicCall(apiKey, evalModel, { ...logBase, fn: `evaluate-group:${group.name}` }, {
    system,
    user:
      `You have read the full manuscript above. The genre contract (already identified) is: ` +
      `"${triage.genre_contract}". Judge against it.\n\n` +
      `Evaluate ONLY these dimensions, using the matching rubric sections: ${menu}.\n\n` +
      `Output ONLY this JSON (no prose, no fences):\n` +
      `{ "sections": [ { "id": "<one of: ${ids.join(" | ")}>", "title": "<human title>", ` +
      `"stance": "strong | solid | needs work", "assessment": "<the editor's read of this ` +
      `dimension, in prose>", "strengths": ["<evidence-backed positive>"], "issues": [ { ` +
      `"severity": "high | medium | low", "note": "<the problem>", "evidence": "<exact quote or ` +
      `specific moment>", "suggestion": "<concrete revision>", "page_ref": { "id": <real page id>, ` +
      `"title": "<page title>", "index": <page_index> } } ] } ] }\n\n` +
      `One object per dimension above. Every issue needs evidence and a suggestion. page_ref uses a ` +
      `REAL id= from the manuscript, or null for whole-book issues. Severity reflects reader impact.`,
    maxTokens: 12000,
    effort: "medium",
    timeoutMs: 105_000,
  });
  const parsed = extractJSON(text) as { sections?: Section[] };
  if (!Array.isArray(parsed.sections)) throw new Error(`group ${group.name}: no sections array`);
  return parsed.sections
    .filter((s) => s && ids.includes(s.id))
    .map((s) => ({ ...s, title: SECTION_TITLES[s.id] ?? s.title }));
}

async function runVerdict(apiKey: string, evalModel: string, book: BookRow, sections: Section[], triage: Triage, logBase: Omit<CallMeta, "fn">) {
  const lite = sections.map((s) => ({
    id: s.id,
    stance: s.stance,
    assessment: s.assessment,
    issues: (s.issues as { severity?: string; note?: string }[] | undefined)?.map((i) => ({
      severity: i.severity,
      note: i.note,
    })),
  }));
  const text = await anthropicCall(apiKey, evalModel, { ...logBase, fn: "evaluate-verdict" }, {
    system: [{ type: "text", text: EDITOR_STANCE }],
    user:
      `You are writing the top-level verdict of an editor's read of "${book.name}". The per-dimension ` +
      `findings are already produced (genre contract: "${triage.genre_contract}"; premise: ` +
      `"${triage.premise}").\n\nFINDINGS:\n${JSON.stringify(lite)}\n\n` +
      `Synthesize the holistic verdict — weigh the dimensions against each other and pick the ` +
      `highest-leverage fixes. Output ONLY this JSON (no prose, no fences):\n` +
      `{ "genre_contract": "<the contract, refined>", "stance": "<short holistic label, e.g. ` +
      `'promising premise, early draft — structural revision before line polish'>", "letter": ` +
      `"<2-4 sentence editorial letter: what the book is, its core strength, its most urgent ` +
      `problem>", "priorities": ["<highest-leverage fix>", "<next>", "<next>"] }`,
    maxTokens: 3500,
    effort: "medium",
    timeoutMs: 55_000,
  });
  const v = extractJSON(text) as Record<string, unknown>;
  if (!v.letter && !Array.isArray(v.priorities)) throw new Error("verdict: missing letter/priorities");
  return {
    genre_contract: String(v.genre_contract ?? triage.genre_contract),
    stance: String(v.stance ?? ""),
    letter: String(v.letter ?? ""),
    priorities: Array.isArray(v.priorities) ? v.priorities.map(String) : [],
  };
}

function fallbackVerdict(sections: Section[], triage: Triage) {
  const worst = sections.some((s) => s.stance === "needs work")
    ? "needs work"
    : sections.some((s) => s.stance === "solid") ? "solid" : "strong";
  const priorities = sections
    .flatMap((s) => (s.issues as { severity?: string; note?: string }[] | undefined) ?? [])
    .filter((i) => i.severity === "high")
    .slice(0, 3)
    .map((i) => i.note ?? "")
    .filter(Boolean);
  return {
    genre_contract: triage.genre_contract,
    stance: `Overall: ${worst} — see the section notes below.`,
    letter: "The section-by-section read is below. (Automated top-level synthesis was unavailable for this run.)",
    priorities,
  };
}

// ── Anthropic plumbing ───────────────────────────────────────────────────────
async function anthropicCall(
  apiKey: string,
  evalModel: string,
  meta: CallMeta,
  opts: { system: unknown[]; user: string; maxTokens: number; effort: string; timeoutMs: number }
): Promise<string> {
  const data = await callClaudeApi(apiKey, {
    model: evalModel,
    max_tokens: opts.maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort },
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  }, meta, { signal: AbortSignal.timeout(opts.timeoutMs) });

  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content.");
  return text;
}

function extractJSON(text: string): unknown {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  else {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1 && last > first) raw = raw.slice(first, last + 1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Could not parse model output as JSON: ${(e as Error).message}`);
  }
}
