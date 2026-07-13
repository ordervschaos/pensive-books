// judge.ts — the LLM-as-judge for ai_call_evals (phase 2). Shared by the edge function
// evaluate-ai-call; the dev bridge mirrors this prompt text (and adds repo-aware code amendments).
//
// The judge reads ONE logged ai_call — what instructions (system) and context (input) it was given,
// and what it produced (output) — and scores how well the output served that context, with concrete
// findings and suggested amendments.

import { extractJsonBlock } from "./json.ts";

// Local-only default (mirrors model-config.ts's localBridgeUp trick): when this worker has
// CLAUDE_LOCAL_URL in its own env — never true when deployed — judging rides the claude-local shim
// instead of the metered API. Prod always gets the fixed model.
export function getJudgeModel(): string {
  return Deno.env.get("CLAUDE_LOCAL_URL") ? "claude-local" : "claude-sonnet-4-6";
}

// Keep the judge prompt bounded — some calls (a full-book eval) carry a whole manuscript.
const CTX_CAP = 24_000;
const OUT_CAP = 16_000;

export const JUDGE_SYSTEM =
  `You are a strict evaluation judge for an AI book-writing system. You are given one AI call: the ` +
  `INSTRUCTIONS it was given (system), the CONTEXT it was given (the assembled prompt — which may ` +
  `include a brief, a story bible, an outline of objectives, preceding prose, or a manuscript), and ` +
  `the OUTPUT it produced. Judge ONLY whether the output served the instructions and context it was ` +
  `actually given — not whether the book is good in the abstract.\n\n` +
  `Score each criterion 1-5 (5 = excellent, 1 = failed):\n` +
  `- objective_fidelity: did the output achieve what the instructions/objective asked?\n` +
  `- context_use: did it honor the provided context (bible facts, continuity, the outline) without ` +
  `contradicting or ignoring it?\n` +
  `- instruction_following: did it obey hard constraints (format, JSON-only, length, "no headings", etc.)?\n` +
  `- quality: is the output well-crafted for its kind (prose, plan, scaffold, report)?\n\n` +
  `Then list findings (specific problems, each with evidence quoted from the output) and amendments ` +
  `(concrete fixes). Each amendment has a target:\n` +
  `- "output": how this specific output should change.\n` +
  `- "prompt": how the instructions/context for this kind of call should change to prevent the issue.\n` +
  `- "code": a change to the prompt-assembly code that builds this call.\n\n` +
  `Output ONLY this JSON (no prose, no fences):\n` +
  `{ "scores": { "objective_fidelity": <1-5>, "context_use": <1-5>, "instruction_following": <1-5>, ` +
  `"quality": <1-5> }, "verdict": "<one short line>", "findings": [ { "criterion": ` +
  `"<objective_fidelity|context_use|instruction_following|quality>", "severity": "high|medium|low", ` +
  `"note": "<the problem>", "evidence": "<exact quote from the output>" } ], "amendments": [ { ` +
  `"target": "output|prompt|code", "suggestion": "<the fix>", "rationale": "<why>" } ] }`;

export interface JudgeableCall {
  fn: string;
  system: string | null;
  // deno-lint-ignore no-explicit-any
  input: any; // the messages array logged on ai_calls
  output: string | null;
}

// Flatten the logged messages array back to readable context text for the judge.
// deno-lint-ignore no-explicit-any
function contextText(input: any): string {
  if (input == null) return "(no context recorded)";
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return JSON.stringify(input);
  return input
    // deno-lint-ignore no-explicit-any
    .map((m: any) => {
      const c = m?.content;
      if (typeof c === "string") return c;
      if (Array.isArray(c)) return c.map((b) => (typeof b === "string" ? b : b?.text ?? "")).join("\n");
      return "";
    })
    .join("\n\n");
}

export function buildJudgeUser(call: JudgeableCall): string {
  const ctx = contextText(call.input);
  const out = call.output ?? "(no output)";
  return (
    `CALL TYPE (fn): ${call.fn}\n\n` +
    `<instructions>\n${call.system ?? "(none — baked into the context below)"}\n</instructions>\n\n` +
    `<context>\n${ctx.slice(0, CTX_CAP)}${ctx.length > CTX_CAP ? "\n…[truncated]" : ""}\n</context>\n\n` +
    `<output>\n${out.slice(0, OUT_CAP)}${out.length > OUT_CAP ? "\n…[truncated]" : ""}\n</output>\n\n` +
    `Judge the output against the instructions and context. JSON only.`
  );
}

// Parse + sanitize the judge's JSON with the same fence/slice guardrails used elsewhere.
export function parseJudgement(text: string): {
  scores: Record<string, number>;
  verdict: string;
  findings: unknown[];
  amendments: unknown[];
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonBlock(text));
  } catch (e) {
    throw new Error(`Could not parse judgement JSON: ${(e as Error).message}`);
  }
  const s = (parsed.scores ?? {}) as Record<string, unknown>;
  const clamp = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : null;
  };
  return {
    scores: {
      objective_fidelity: clamp(s.objective_fidelity) ?? 0,
      context_use: clamp(s.context_use) ?? 0,
      instruction_following: clamp(s.instruction_following) ?? 0,
      quality: clamp(s.quality) ?? 0,
    },
    verdict: String(parsed.verdict ?? "").trim(),
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    amendments: Array.isArray(parsed.amendments) ? parsed.amendments : [],
  };
}
