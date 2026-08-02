// eval-pairwise — compare two suite runs by PREFERENCE rather than by absolute score.
//
// Why this exists: grading the same premise twice with the same judge returned 4.75 and 5.0. That
// run-to-run noise is the size of the difference an A/B is trying to detect, so absolute rubric means
// cannot separate two decent agent versions. A judge shown both candidates at once is doing a comparison
// instead of calibrating an internal scale, and comparisons are far more stable.
//
// POSITION BIAS is handled by running BOTH orders (A first, then B first) rather than by randomising.
// Randomising spreads the bias across trials and hopes it averages out; running both orders cancels it
// deterministically AND makes it measurable — if the same candidate wins whichever slot it is in, the
// verdict is real; if the winner follows the slot, that pair is a tie caused by position, and you learn
// that rather than banking a false win.
//
//   pnpm dna:pairwise --a baseline --b variant          # two suite labels
//   pnpm dna:pairwise --a baseline --b variant --tasks thin-brief
//
// Reads scripts/.agent-suite-<label>.json from both sides, pairs runs by fixture + trial index, and writes
// scripts/.agent-pairwise-<a>-vs-<b>.json.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { harnessLlm, harnessLlmAvailable } from "./harness/llm.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (f: string, d?: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : d; };
const A = argVal("--a"), B = argVal("--b");
if (!A || !B) throw new Error("usage: pnpm dna:pairwise --a <label> --b <label> [--tasks a,b]");
if (!harnessLlmAvailable()) throw new Error("pairwise judge needs DEEPSEEK_API_KEY in supabase/functions/.env");
const ONLY = (argVal("--tasks") ?? "").split(",").filter(Boolean);

const SYSTEM = `You are a commissioning editor comparing two PREMISE packages written for the same book brief.

Each package is a LOGLINE plus the DRAMATIC QUESTION derived from it.

Judge on, in order of weight:
1. Does it honour the brief and the author's stated intent — including what the author said they did NOT want?
2. Is the dramatic question genuinely at stake — a real choice with a price, not a restatement of the logline?
3. Is it specific? Concrete and particular beats grand and generic.
4. Would a reader pick this book up?

Ignore length, formatting, and polish. Do not reward invented spectacle: stakes that the brief did not ask
for are a FAULT, not a virtue.

Reply with JSON only:
{"winner": "FIRST" | "SECOND" | "TIE", "confidence": "high" | "low", "reason": "<one sentence>"}`;

interface SuiteRun { taskId: string; trial: number; bookId: number | null; failure?: string }
interface Suite { label: string; results: SuiteRun[] }

function loadSuite(label: string): Suite {
  const p = join(here, `.agent-suite-${label}.json`);
  try { return JSON.parse(readFileSync(p, "utf8")) as Suite; }
  catch { throw new Error(`no suite report at ${p} — run \`pnpm dna:suite --label ${label}\` first`); }
}

/** The graded artefact for a run: read from the grader's report so both sides are read identically. */
function candidate(bookId: number): { logline: string; question: string } | null {
  try {
    const g = JSON.parse(readFileSync(join(here, `.agent-eval-${bookId}.json`), "utf8"));
    const logline = String(g.logline ?? "").trim();
    const question = String(g.dramatic_question ?? "").trim();
    return logline || question ? { logline, question } : null;
  } catch { return null; }
}

const render = (c: { logline: string; question: string }) =>
  `LOGLINE: ${c.logline || "(none)"}\nDRAMATIC QUESTION: ${c.question || "(none)"}`;

interface Verdict { winner: string; confidence: string; reason: string }
function parseVerdict(raw: string): Verdict | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Partial<Verdict>;
    const w = String(o.winner ?? "").toUpperCase();
    if (!["FIRST", "SECOND", "TIE"].includes(w)) return null;
    return { winner: w, confidence: String(o.confidence ?? "low"), reason: String(o.reason ?? "").slice(0, 300) };
  } catch { return null; }
}

async function judgeOnce(first: string, second: string, brief: string): Promise<Verdict | null> {
  const user = `THE BRIEF AND WHAT THE AUTHOR ASKED FOR:\n${brief}\n\n=== PACKAGE ONE ===\n${first}\n\n=== PACKAGE TWO ===\n${second}\n\nWhich package is better?`;
  return parseVerdict(await harnessLlm({ system: SYSTEM, user, maxTokens: 300 }));
}

const suiteA = loadSuite(A), suiteB = loadSuite(B);
const tasks = [...new Set(suiteA.results.map((r) => r.taskId))].filter((t) => !ONLY.length || ONLY.includes(t));

const briefs = JSON.parse(readFileSync(join(here, "eval-premise-tasks.json"), "utf8")) as {
  tasks: { id: string; brief: unknown; author: { keyed?: { answer: string }[] } }[];
};
function briefFor(taskId: string): string {
  const t = briefs.tasks.find((x) => x.id === taskId);
  if (!t) return "(brief unavailable)";
  // The author's facts are part of "what was asked for" — a package that ignores what the author said in
  // the interview should lose, and the judge cannot see that from the written brief alone.
  const facts = (t.author.keyed ?? []).map((k) => `- ${k.answer}`).join("\n");
  return `${JSON.stringify(t.brief, null, 2)}\n\nWHAT THE AUTHOR SAID WHEN ASKED:\n${facts}`;
}

const pairs: { taskId: string; trial: number; a: number; b: number }[] = [];
for (const taskId of tasks) {
  const as = suiteA.results.filter((r) => r.taskId === taskId && r.bookId && !r.failure);
  const bs = suiteB.results.filter((r) => r.taskId === taskId && r.bookId && !r.failure);
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    pairs.push({ taskId, trial: i + 1, a: as[i].bookId!, b: bs[i].bookId! });
  }
}
if (!pairs.length) throw new Error("no comparable pairs — both suites need successful runs on the same fixtures");

console.log(`\n── pairwise: ${A} vs ${B} · ${pairs.length} pair(s), both orders each ──\n`);
const rows: Record<string, unknown>[] = [];
let aWins = 0, bWins = 0, ties = 0, positional = 0;

for (const p of pairs) {
  const ca = candidate(p.a), cb = candidate(p.b);
  if (!ca || !cb) { console.log(`  ${p.taskId}#${p.trial}: missing grader report — skipped`); continue; }
  const brief = briefFor(p.taskId);

  // Both orders. v1 puts A first; v2 puts B first.
  const v1 = await judgeOnce(render(ca), render(cb), brief);
  const v2 = await judgeOnce(render(cb), render(ca), brief);
  const pick1 = v1 ? (v1.winner === "FIRST" ? "A" : v1.winner === "SECOND" ? "B" : "TIE") : "?";
  const pick2 = v2 ? (v2.winner === "FIRST" ? "B" : v2.winner === "SECOND" ? "A" : "TIE") : "?";

  let outcome: string;
  if (pick1 === "?" || pick2 === "?") outcome = "unparsed";
  else if (pick1 === pick2) outcome = pick1;              // agreed across both orders — a real verdict
  else if (pick1 === "TIE" || pick2 === "TIE") outcome = "TIE";
  else { outcome = "TIE(position)"; positional++; }        // the winner followed the SLOT, not the text

  if (outcome === "A") aWins++; else if (outcome === "B") bWins++; else ties++;
  rows.push({ ...p, order1: pick1, order2: pick2, outcome, reason1: v1?.reason, reason2: v2?.reason });
  console.log(`  ${p.taskId}#${p.trial}  A=${p.a} B=${p.b}  order1:${pick1} order2:${pick2} → ${outcome}`);
  if (v1?.reason) console.log(`      ${v1.reason}`);
}

const decided = aWins + bWins;
console.log(`\n${A}: ${aWins}   ${B}: ${bWins}   tie: ${ties}   (of ${rows.length} pairs)`);
if (positional) console.log(`⚠ ${positional} pair(s) flipped with position — those are ties, not wins.`);
console.log(
  decided === 0
    ? "No decided pairs: these two are indistinguishable on this fixture set."
    : `Decided pairs: ${aWins}-${bWins}. With ${rows.length} pairs this is indicative only — a 1-pair edge is noise.`,
);

const out = join(here, `.agent-pairwise-${A}-vs-${B}.json`);
writeFileSync(out, JSON.stringify({ a: A, b: B, aWins, bWins, ties, positional, rows }, null, 2));
console.log(`\nwrote ${out}`);
