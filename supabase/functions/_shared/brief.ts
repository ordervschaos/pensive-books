// brief.ts — the author's Brief (the genre/audience/tone/scope contract) and its prompt renderer,
// shared by every AI step that injects the brief into a prompt. Each call site kept its own copy with
// small, intentional differences (the fallback wording, whether scope shows the word target, whether
// success_criteria is included); those are now options so the rendered bytes stay identical per site.
// evaluate-core renders the brief differently (a titled block, returns null) and keeps its own.

export type HeatLevel = "closed" | "warm" | "explicit";

/** Level → full permission sentence injected into the MANDATE block. */
export const HEAT_LEVEL_SENTENCES: Record<HeatLevel, string> = {
  closed: "Closed-door — fade before explicit content; intimacy implied, not shown.",
  warm: "Warm — sensual and on the page (desire, touch, tension) but not graphic.",
  explicit: "EXPLICIT — graphic and on the page; depict intimacy fully.",
};

export interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
  // C3: typed as object; legacy bare-string values handled by renderers.
  heat?: { level?: HeatLevel; note?: string } | string;
}

export interface BriefContextOpts {
  /** Returned when there is no brief at all. */
  none?: string;
  /** Returned when the brief exists but has no renderable fields. */
  empty?: string;
  /** Scope line: "full" = band + (≈N words); "band" = band only; "none" = omit the scope line. */
  scope?: "full" | "band" | "none";
  /** Whether to render the success_criteria line. */
  success?: boolean;
}

export function briefContext(brief: Brief | null, opts: BriefContextOpts = {}): string {
  const none = opts.none ?? "(no brief set)";
  const empty = opts.empty ?? "(brief is empty)";
  const scopeMode = opts.scope ?? "full";
  const success = opts.success ?? true;
  if (!brief) return none;
  const lines: string[] = [];
  if (scopeMode !== "none" && brief.scope?.band) {
    const wt = scopeMode === "full" && brief.scope.word_target ? ` (≈${brief.scope.word_target} words)` : "";
    lines.push(`- Scope: ${brief.scope.band}${wt}`);
  }
  if (brief.genre) lines.push(`- Genre: ${brief.genre}`);
  if (brief.audience) lines.push(`- Audience: ${brief.audience}`);
  if (brief.premise) lines.push(`- Premise: ${brief.premise}`);
  if (brief.tone?.length) lines.push(`- Tone: ${brief.tone.join(", ")}`);
  if (success && brief.success_criteria) lines.push(`- Success looks like: ${brief.success_criteria}`);
  return lines.length ? lines.join("\n") : empty;
}

// Render the binding non-voice deliverables as an imperative MANDATE block.
// Returns "" when none of the mandate fields are present (callers omit the block when "").
export function mandateContext(brief: Brief | null): string {
  if (!brief) return "";
  const lines: string[] = [];
  if (brief.success_criteria?.trim()) {
    lines.push(`- Must deliver on: ${brief.success_criteria.trim()}`);
  }
  // C3: typed heat field — use the full permission sentence for known levels.
  const heat = brief.heat;
  if (heat) {
    const level = typeof heat === "string" ? undefined : heat.level;
    const note = typeof heat === "string" ? undefined : heat.note;
    const sentence = level
      ? HEAT_LEVEL_SENTENCES[level]
      : (typeof heat === "string" ? heat.trim() : "");
    const heatStr = [sentence, note].filter(Boolean).join(" — ");
    if (heatStr) lines.push(`- Heat / explicitness: ${heatStr}`);
  }
  if (brief.scope?.band) {
    const wt = brief.scope.word_target ? ` of ≈${brief.scope.word_target} words` : "";
    lines.push(`- Length: this is a ${brief.scope.band}${wt} — write to that length; do not stop short.`);
  }
  if (brief.genre?.trim()) {
    lines.push(`- Genre obligation: honor the "${brief.genre.trim()}" promise FULLY and ON THE PAGE — e.g. a comedy must stay funny throughout, an ecchi/romance must actually be sensual on the page, never fade to black at the decisive moment.`);
  }
  return lines.join("\n");
}
