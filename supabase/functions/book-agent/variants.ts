// variants — the A/B seam for agent evals.
//
// A named variant appends (or replaces) a slice of the thread's system prompt, so two agent versions can
// run from ONE deploy and their trials can be interleaved. Comparing by sequential deploys is
// time-confounded: provider-side model updates, load and cache state drift between the halves, and that
// drift cannot be separated from the change under test.
//
// CONTRACT — an unset variant must be a NO-OP. `variantSuffix(null)` returns "", so production behaviour is
// byte-identical to having no seam at all. This is load-bearing: an eval hook that quietly alters what real
// authors get is worse than no eval hook. `variants.test.ts` locks it.
//
// Set it on the thread row directly (the harness does this after creating the thread):
//   update book_agent_runs set context_variant = 'no_converge' where id = <id>;

export interface Variant {
  /** One line on what this arm is testing — shows up in eval reports. */
  what: string;
  /** Appended verbatim to the end of the system prompt. Keep it surgical: one behaviour per variant. */
  suffix: string;
}

export const VARIANTS: Record<string, Variant> = {
  // The control arm for the convergence change (2026-08-02). Measured baseline before the fix: the agent
  // reached the premise gate only after the scripted author demanded the artifact three times (pushes: 3).
  // This arm restores the old behaviour so the fix can be measured against it in the same deploy.
  no_converge: {
    what: "interview WITHOUT the convergence trigger — the pre-2026-08-02 behaviour (control arm)",
    suffix:
      "\n\nOVERRIDE (eval arm `no_converge`): ignore any instruction to converge, self-assess whether the core is covered, or cap the number of interview exchanges. Keep interviewing until the AUTHOR explicitly signals they are ready or has nothing to add. Do not offer to compile the vision on your own initiative.",
  },
};

/** The block to append for a variant. Empty string for null/unknown — production is untouched. */
export function variantSuffix(name: string | null | undefined): string {
  if (!name) return "";
  const v = VARIANTS[name];
  // An unknown name is a typo in an eval script, not a reason to fail a real author's turn. Ignore it —
  // the eval report records which variant was requested, so a silent no-op still shows up as "both arms
  // behaved identically", which is the correct and visible symptom.
  return v ? v.suffix : "";
}
