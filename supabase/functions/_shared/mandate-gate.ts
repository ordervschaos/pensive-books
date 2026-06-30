// mandate-gate.ts — the conformance BACKSTOP ("gate (a)").
//
// The mechanism fix (C1–C4) makes the brief's MANDATE — heat, length, comedy/genre — travel with
// authority through every generation stage, so conformance is the default. This gate is the
// confirm-don't-enforce backstop on top: given a finished book, it scores the manuscript against the
// SAME MANDATE block the generator was handed and reports per-axis verdicts, catching the residual
// misses (a model that fades-to-black despite an explicit mandate, a draft that stops short of length,
// a comedy that drifts earnest). It REPORTS; it does not block. A future re-roll can consume the report.
//
// Two kinds of check:
//   • length  — deterministic (word count vs brief.scope.word_target); no model call.
//   • heat / genre / success — one LLM judge call against the manuscript.
import { type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callLLM, textFromLLM, type CallMeta } from "./llm.ts";
import { type Brief, mandateContext } from "./brief.ts";
import { getActiveModels } from "./model-config.ts";
import { tiptapToText } from "./words.ts";
import { extractJsonBlock } from "./json.ts";

export type Verdict = "pass" | "partial" | "fail";

export interface MandateAxisVerdict {
  axis: "length" | "heat" | "genre" | "success";
  verdict: Verdict;
  detail: string;       // one-line human-readable finding
  evidence?: string;    // a number, a quote, or a page reference
}

export interface ConformanceReport {
  overall: Verdict;
  axes: MandateAxisVerdict[];
  wordCount: number;
  wordTarget: number | null;
}

interface PageRow {
  page_index: number;
  page_type: string | null;
  title: string | null;
  content: unknown;
}

const countWords = (s: string): number => {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
};

// Worst verdict wins: any fail → fail; else any partial → partial; else pass.
function rollup(axes: MandateAxisVerdict[]): Verdict {
  if (axes.some((a) => a.verdict === "fail")) return "fail";
  if (axes.some((a) => a.verdict === "partial")) return "partial";
  return "pass";
}

// ── Length: deterministic, no model ──────────────────────────────────────────
// Undershoot is the failure 1150 hit (12.3k of a 25k novella). Overshoot is a softer miss.
export function lengthConformance(target: number | null, wordCount: number): MandateAxisVerdict {
  if (!target) {
    return { axis: "length", verdict: "pass", detail: "No word target set — length not mandated.", evidence: `${wordCount} words` };
  }
  const ratio = wordCount / target;
  const pct = Math.round(ratio * 100);
  const evidence = `${wordCount.toLocaleString()} / ${target.toLocaleString()} words (${pct}%)`;
  if (ratio >= 0.85 && ratio <= 1.25) return { axis: "length", verdict: "pass", detail: "Within range of the target length.", evidence };
  if (ratio < 0.85 && ratio >= 0.6) return { axis: "length", verdict: "partial", detail: "Runs short of the target length.", evidence };
  if (ratio > 1.25 && ratio <= 1.5) return { axis: "length", verdict: "partial", detail: "Runs over the target length.", evidence };
  if (ratio < 0.6) return { axis: "length", verdict: "fail", detail: "Far below the target length — the book is unfinished against its scope.", evidence };
  return { axis: "length", verdict: "fail", detail: "Far over the target length.", evidence };
}

// ── Manuscript assembly ──────────────────────────────────────────────────────
function buildManuscript(pages: PageRow[]): { manuscript: string; wordCount: number } {
  let wordCount = 0;
  const body = pages
    .map((p) => {
      if ((p.page_type ?? "") === "section") return `\n\n## ${p.title ?? ""}\n`;
      const text = tiptapToText(p.content).trim();
      wordCount += countWords(text);
      return `\n\n----- ${p.title ?? `Page ${p.page_index}`} -----\n${text}`;
    })
    .join("");
  return { manuscript: body, wordCount };
}

// ── Heat / genre / success: one LLM judge call ────────────────────────────────
const JUDGE_SYSTEM =
  `You are a CONFORMANCE AUDITOR for a book-generation pipeline. You are given a book's brief MANDATE ` +
  `(what the author promised the finished book would deliver) and its full manuscript. For each axis, ` +
  `judge strictly and from evidence whether the FINISHED PROSE delivers the mandate — this is a delivery ` +
  `check, not an editorial review of quality. The most important failure to catch: a mandate that was ` +
  `LAUNDERED OUT — e.g. an explicit/sensual heat requirement that the prose quietly fades-to-black, or a ` +
  `comedy mandate the book abandons as it gets earnest.\n\n` +
  `Judge exactly these axes:\n` +
  `- "heat": does intimacy render at the mandated explicitness? If the MANDATE (content type, or an ` +
  `ecchi/romance genre, or a "turning on"/"scintillating" success criterion) implies on-the-page heat, do ` +
  `the key intimate scenes appear ON THE PAGE, or do they fade to black / cut away at the decisive moment? ` +
  `FAIL = mandated heat is faded/absent; PARTIAL = present but timid/uneven; PASS = delivered.\n` +
  `- "genre": is the genre obligation honored THROUGHOUT (a comedy stays funny, a thriller stays tense)? ` +
  `FAIL = it drifts substantially; PARTIAL = it slips in places; PASS = sustained.\n` +
  `- "success": are the author's success_criteria met by the finished book?\n` +
  `If an axis is not mandated by anything in the brief, return verdict "pass" with detail "not mandated".\n\n` +
  `Return ONLY this JSON, no prose, no fences:\n` +
  `{"axes":[{"axis":"heat","verdict":"pass|partial|fail","detail":"<one line>","evidence":"<short quote or page title>"}, ...]}`;

// Judge an arbitrary span of prose (a scene, a chapter, the whole book) against the brief's mandate.
// Exported so the editor agent can check a single scene's prose against the genre/heat/success contract
// without running the whole-book gate (which is page-based — see runMandateGate).
export async function judgeProse(apiKey: string, model: string, brief: Brief, manuscript: string, meta: CallMeta): Promise<MandateAxisVerdict[]> {
  const mandate = mandateContext(brief) || "(no explicit mandate set)";
  const user =
    `BRIEF MANDATE (what the book promised to deliver):\n${mandate}\n\n` +
    `GENRE: ${brief.genre ?? "(unset)"}\nSUCCESS CRITERIA: ${brief.success_criteria ?? "(unset)"}\n\n` +
    `Judge the manuscript below against the mandate. JSON only.`;
  const data = await callLLM(
    apiKey,
    {
      model,
      max_tokens: 1200,
      system: [
        { type: "text", text: JUDGE_SYSTEM },
        { type: "text", text: `FULL MANUSCRIPT:\n${manuscript}`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: user }],
    },
    meta,
  );
  const text = textFromLLM(data);
  try {
    const parsed = JSON.parse(extractJsonBlock(text)) as { axes?: MandateAxisVerdict[] };
    return (parsed.axes ?? []).filter((a) => a && a.axis && a.verdict);
  } catch {
    return [{ axis: "heat", verdict: "partial", detail: "Judge response could not be parsed — inspect by hand.", evidence: text.slice(0, 160) }];
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
export async function runMandateGate(
  client: SupabaseClient,
  apiKey: string,
  bookId: number,
  log?: { taskTable?: string; taskId?: number; userId?: string | null },
): Promise<ConformanceReport> {
  const { data: book, error: bookErr } = await client.from("books").select("id, name, brief").eq("id", bookId).single();
  if (bookErr || !book) throw new Error("Book not found");
  const brief = (book.brief as Brief | null) ?? {};

  const { data: pages, error: pagesErr } = await client
    .from("pages").select("page_index, page_type, title, content")
    .eq("book_id", bookId).eq("archived", false).order("page_index", { ascending: true });
  if (pagesErr) throw new Error(`fetch pages: ${pagesErr.message}`);
  if (!pages || pages.length === 0) throw new Error("Book has no pages to check.");

  const { manuscript, wordCount } = buildManuscript(pages as PageRow[]);
  const target = brief.scope?.word_target ?? null;

  const lengthAxis = lengthConformance(target, wordCount);

  const { high: model } = await getActiveModels();
  const meta: CallMeta = { fn: "mandate-gate", bookId, taskTable: log?.taskTable ?? null, taskId: log?.taskId ?? null, userId: log?.userId ?? null };
  const proseAxes = await judgeProse(apiKey, model, brief, manuscript, meta);

  const axes = [lengthAxis, ...proseAxes];
  return { overall: rollup(axes), axes, wordCount, wordTarget: target };
}
