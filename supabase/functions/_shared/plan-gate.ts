// plan-gate.ts — PLAN-conformance judge (docs/agent-improvement-plan.md P2.2, docs/true-agent.md §duals).
//
// mandate-gate.ts checks a scene's prose against the book's BRIEF (heat/genre/success). This checks it against
// the scene's OWN PLAN — its DNA edges: did the prose deliver the planned value_shift, establish the state keys
// the causal DAG says downstream beats will spend, do the promised thread work? Those edges ARE the
// verification context — the payoff of causality-as-data. It REPORTS per plan-element; it does not block.
import { callLLM, textFromLLM, type CallMeta } from "./llm.ts";
import { extractJsonBlock } from "./json.ts";
import { type Verdict } from "./mandate-gate.ts";

export interface PlanAxisVerdict {
  field: string;        // "value_shift" | "goal" | "outcome" | "establishes:<key>" | "needs:<key>" | "thread:<name>"
  verdict: Verdict;
  detail: string;       // one-line human-readable finding
  evidence?: string;    // a short quote from the prose
}

export interface ScenePlan {
  goal?: string;
  outcome?: string;
  valueShift?: { value?: string; from?: string; to?: string; polarity?: string };
  establishes?: string[];
  needs?: string[];
  threads?: { name: string; promise?: string; role: string }[];
}

/** True when the plan carries at least one judge-able element (else there's nothing to conform to). */
export function planHasContent(p: ScenePlan): boolean {
  return !!(p.goal || p.outcome || (p.valueShift && (p.valueShift.from || p.valueShift.to)) ||
    p.establishes?.length || p.needs?.length || p.threads?.length);
}

const PLAN_JUDGE_SYSTEM =
  `You are a PLAN-CONFORMANCE AUDITOR for a novel-generation pipeline. You are given ONE scene's PLAN (the ` +
  `structural job it was designed to do) and the PROSE written for it. For each plan element, judge strictly ` +
  `and from evidence whether the PROSE delivers it ON THE PAGE — a delivery check, not an editorial review of ` +
  `quality. The scene must do its STRUCTURAL job so later scenes can rely on it.\n\n` +
  `Judge ONLY the elements present in the plan:\n` +
  `- "value_shift": the scene must turn its value from one state to another (its dramatic charge). Does the ` +
  `prose actually move that value from the "from" state to the "to" state (in the given polarity)? FAIL = the ` +
  `value stays flat / unchanged or moves the wrong way; PARTIAL = it shifts but weakly or unclearly; PASS = the ` +
  `turn lands.\n` +
  `- "goal" / "outcome": does the prose pursue the goal and arrive at the planned outcome?\n` +
  `- "establishes:<key>": each key is a FACT this scene must make true AND knowable on the page, because a ` +
  `later scene SPENDS it. For each, is that fact actually established in the prose (not merely implied ` +
  `off-page)? FAIL = absent; PARTIAL = gestured at; PASS = clearly established.\n` +
  `- "needs:<key>": each key is a fact an EARLIER scene established that this scene depends on — does the prose ` +
  `honor it (not contradict or ignore it)?\n` +
  `- "thread:<name>": a promise this scene must work on — setup = plant it, payoff = pay it off, advance = ` +
  `develop it. Does the prose do that work?\n\n` +
  `Emit ONE axis object per plan element you judged, using the field names above (e.g. "establishes:ledger_settled", ` +
  `"thread:the brass compass"). Return ONLY this JSON, no prose, no fences:\n` +
  `{"axes":[{"field":"value_shift","verdict":"pass|partial|fail","detail":"<one line>","evidence":"<short quote>"}, ...]}`;

// Judge a scene's prose against its OWN plan slice. Mirrors mandate-gate.judgeProse (prose in a cached system
// block; strict JSON out). Returns [] if the plan has nothing to conform to.
export async function judgeAgainstPlan(apiKey: string, model: string, plan: ScenePlan, proseText: string, meta: CallMeta): Promise<PlanAxisVerdict[]> {
  if (!planHasContent(plan)) return [];
  const lines: string[] = [];
  if (plan.goal) lines.push(`GOAL: ${plan.goal}`);
  if (plan.outcome) lines.push(`OUTCOME (planned): ${plan.outcome}`);
  if (plan.valueShift && (plan.valueShift.from || plan.valueShift.to)) {
    const v = plan.valueShift;
    lines.push(`VALUE_SHIFT: turn "${v.value ?? "the value"}" from "${v.from ?? "?"}" to "${v.to ?? "?"}"${v.polarity ? ` (${v.polarity})` : ""}`);
  }
  if (plan.establishes?.length) lines.push(`ESTABLISHES (facts this scene must make true — later scenes spend them): ${plan.establishes.join(", ")}`);
  if (plan.needs?.length) lines.push(`NEEDS (facts already true that this scene depends on): ${plan.needs.join(", ")}`);
  if (plan.threads?.length) lines.push(`THREADS: ${plan.threads.map((t) => `${t.role} "${t.name}"${t.promise ? ` — ${t.promise}` : ""}`).join("; ")}`);

  const user = `SCENE PLAN:\n${lines.join("\n")}\n\nJudge the prose below against THIS plan (only these elements). JSON only.`;
  const data = await callLLM(
    apiKey,
    {
      model,
      max_tokens: 1200,
      system: [
        { type: "text", text: PLAN_JUDGE_SYSTEM },
        { type: "text", text: `SCENE PROSE:\n${proseText}`, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: user }],
    },
    meta,
  );
  const text = textFromLLM(data);
  try {
    const parsed = JSON.parse(extractJsonBlock(text)) as { axes?: PlanAxisVerdict[] };
    return (parsed.axes ?? []).filter((a) => a && a.field && a.verdict);
  } catch {
    return [{ field: "value_shift", verdict: "partial", detail: "Judge response could not be parsed — inspect by hand.", evidence: text.slice(0, 160) }];
  }
}
