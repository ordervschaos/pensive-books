// pairwise — A-vs-B preference judging for premise-rung outputs.
//
// WHY THIS EXISTS, measured rather than assumed: grading the SAME text with the SAME absolute-rubric judge
// twice returned 5.0 and then 4.75 (`stakes_grounded` moved 5→4). That run-to-run noise is the same size as
// the difference an A/B would be hunting for, so absolute means cannot resolve two decent variants. A
// pairwise judge compares two candidates against each other instead of calibrating an internal scale, which
// is a much easier judgement and a far more stable one.
//
// POSITION BIAS IS REAL AND HANDLED. LLM judges systematically favour one slot. Every pair is therefore
// judged TWICE — once as (A,B) and once as (B,A) — and a pair only counts as decided when both orders agree.
// Disagreement is reported as a TIE, not silently resolved: "the judge could not tell these apart" is a
// finding, and averaging it away would manufacture a winner out of position bias.
import { harnessLlm } from "./llm.ts";

const SYSTEM = `You are a fiction editor comparing two candidate premises for the SAME book, written from the SAME brief.

Judge which is the stronger foundation for a novel. Weigh, in order:
1. FIDELITY — does it honour the brief and the author's stated intent, without inventing a different book?
2. DRAMATIC ENGINE — is there a real, priced question ("can she X without losing Y?") rather than a situation?
3. SPECIFICITY — concrete, particular, and unmistakably this story rather than a genre template.
4. RESTRAINT — it must not inflate a quiet book into a plotty one, or invent stakes the brief never asked for.

Answer with STRICT JSON and nothing else:
{"winner": "A" | "B" | "tie", "why": "<one sentence, naming the deciding difference>"}

"tie" is a legitimate answer and you should use it when neither is clearly better. Do not invent a winner.`;

export interface Candidate { label: string; logline: string; dramaticQuestion: string }
export interface PairVerdict {
  winner: string | "tie";
  agreed: boolean;          // both orderings agreed — the only case that counts as decided
  raw: { order: string; winner: string; why: string }[];
}

function render(c: Candidate): string {
  return `LOGLINE: ${c.logline || "(none)"}\nDRAMATIC QUESTION: ${c.dramaticQuestion || "(none)"}`;
}

async function judgeOnce(brief: string, first: Candidate, second: Candidate): Promise<{ winner: string; why: string }> {
  const user = `THE BRIEF THE AUTHOR GAVE:\n${brief}\n\n---\nCANDIDATE A:\n${render(first)}\n\n---\nCANDIDATE B:\n${render(second)}`;
  const text = await harnessLlm({ system: SYSTEM, user, maxTokens: 300 });
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`pairwise judge returned no JSON: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]) as { winner?: string; why?: string };
  const w = String(parsed.winner ?? "tie").trim().toUpperCase();
  return { winner: w === "A" || w === "B" ? w : "tie", why: String(parsed.why ?? "").trim() };
}

/**
 * Judge one pair in BOTH orders. `winner` is a real label only when the two orders agree; otherwise "tie"
 * with agreed:false, which distinguishes "genuinely equal" from "the judge just favoured a slot".
 */
export async function judgePair(brief: string, a: Candidate, b: Candidate): Promise<PairVerdict> {
  const ab = await judgeOnce(brief, a, b);          // a is slot A
  const ba = await judgeOnce(brief, b, a);          // a is slot B — same pair, flipped
  const abPick = ab.winner === "A" ? a.label : ab.winner === "B" ? b.label : "tie";
  const baPick = ba.winner === "A" ? b.label : ba.winner === "B" ? a.label : "tie";
  const agreed = abPick === baPick && abPick !== "tie";
  return {
    winner: agreed ? abPick : "tie",
    agreed,
    raw: [
      { order: `${a.label}|${b.label}`, winner: abPick, why: ab.why },
      { order: `${b.label}|${a.label}`, winner: baPick, why: ba.why },
    ],
  };
}

/** Aggregate many pair verdicts into a win/loss/tie tally per label. */
export function tally(verdicts: PairVerdict[], labels: [string, string]) {
  const wins: Record<string, number> = { [labels[0]]: 0, [labels[1]]: 0 };
  let ties = 0, flipped = 0;
  for (const v of verdicts) {
    if (!v.agreed) { ties++; if (v.raw[0].winner !== "tie" && v.raw[1].winner !== "tie") flipped++; continue; }
    wins[v.winner] = (wins[v.winner] ?? 0) + 1;
  }
  return {
    ...wins,
    ties,
    // Pairs where each ORDER picked a different candidate — a direct read on how much position bias is in
    // play. A high number means the judge is not discriminating and the comparison should not be trusted.
    positionFlips: flipped,
    decided: verdicts.length - ties,
    total: verdicts.length,
  };
}
