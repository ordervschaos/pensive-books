// brief.ts — the author's Brief (the genre/audience/tone/scope contract) and its prompt renderer,
// shared by every AI step that injects the brief into a prompt. Each call site kept its own copy with
// small, intentional differences (the fallback wording, whether scope shows the word target, whether
// success_criteria is included); those are now options so the rendered bytes stay identical per site.
// evaluate-core renders the brief differently (a titled block, returns null) and keeps its own.

export interface Brief {
  scope?: { band?: string; word_target?: number };
  genre?: string;
  audience?: string;
  premise?: string;
  tone?: string[];
  success_criteria?: string;
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
