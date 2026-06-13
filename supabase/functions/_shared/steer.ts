// steer — the author's free-text "steer" for a Build-Studio step, read from books.steers and folded
// into a generation prompt. The steer is sticky per book+step (the client owns writes; this is the
// read side). Every generation core that loads the book row selects `steers` and appends
// steerBlock(readSteer(book.steers, "<step>")) to its user content, so ONE edit per shared core
// covers the serial, bulk, and workshop paths that route through it.
//
// The steer is a STRONG instruction but explicitly subordinate: it shapes THIS output without
// overriding the brief, the spine, or any pinned constraint (pin enforcement stays structural —
// these workers never write rows).

export type SteerStep = "foundations" | "spine" | "outline" | "beats" | "prose";

/** Pull a step's steer text out of the books.steers jsonb (trimmed; "" when absent/blank). */
export function readSteer(steers: unknown, step: SteerStep): string {
  const v = (steers as Record<string, unknown> | null)?.[step];
  return typeof v === "string" ? v.trim() : "";
}

/** The prompt block to append after the rest of the user content. Empty string when no steer. */
export function steerBlock(guidance: string): string {
  return guidance
    ? `\n\nAUTHOR'S STEER FOR THIS STEP (honor it as a strong instruction shaping THIS output; it never overrides the brief, the spine, or any PINNED constraint):\n${guidance}`
    : "";
}
