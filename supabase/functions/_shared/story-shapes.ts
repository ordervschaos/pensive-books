// story-shapes.ts — Vonnegut's "shapes of stories" as a diagnostic frame for the SPINE reviser.
//
// The canonical doc lives in knowledgebase/creation/approaches/shapes-of-stories.md (which a
// DEPLOYED edge fn can't read — not bundled). So the load-bearing part — each shape's emotional
// trajectory and the failure mode it catches — is distilled here as string constants, faithful to
// that doc. Like lens.ts, a shape is a LENS: a frame to ask "which line is this book drawing, and
// where does the spine break the line it's promising?" — never a template to force the book into.
// The spine lens's system prompt enforces that subordination; this module only supplies the text.

interface Shape {
  name: string;
  /** The fortune trajectory, beginning → end. */
  curve: string;
  /** The one failure mode this shape is best at catching in a spine. */
  watch: string;
}

const SHAPES: Shape[] = [
  {
    name: "Man in Hole",
    curve: "Starts at/above average fortune → drops into real trouble → climbs out to end HIGHER than it began. Most stories. The fall must be real and the climb earned.",
    watch: "A hole that isn't deep (no real trouble), a climb-out by luck/rescue instead of the protagonist's own change, or a spine that ends exactly where it started (flat — no hole).",
  },
  {
    name: "Boy Gets Girl",
    curve: "Ordinary baseline → stumbles onto something wonderful → LOSES it → regains it for good, ending above baseline. The midpoint loss is the engine.",
    watch: "A missing loss (gets the wonderful thing and just keeps it — no middle), or a regaining that costs nothing. The dip must hurt or the payoff is unearned.",
  },
  {
    name: "Cinderella / From Bad to Better",
    curve: "Starts low → INCREMENTAL gifts lift step by step → a sudden crushing DROP (midnight) → soars to off-the-chart happiness. The most reliably satisfying Western shape.",
    watch: "Gifts that arrive all at once (no staircase), or no drop before the rise (joy with no jeopardy reads flat). The higher the final soar, the deeper the drop must precede it.",
  },
  {
    name: "From Bad to Worse",
    curve: "Starts below average → descends relentlessly, no recovery (Kafka's Metamorphosis). The arc IS the absence of rescue.",
    watch: "Use to test a tragic spine: is the descent truly unbroken, or did the book flinch and sneak in a consolation that softens the fall? A real downward shape commits.",
  },
  {
    name: "Which Way Is Up?",
    curve: "The line stays near the axis because we genuinely can't tell if each event is good or bad news — and neither can the protagonist (Hamlet). Ambiguity as the shape.",
    watch: "A spine where every beat is legibly 'good' or 'bad' may be too tidy. But if a clear arc is intended and the reader can't read up from down, the shape has gone slack — ambiguity by accident.",
  },
  {
    name: "Creation / Ascending Steps",
    curve: "A monotonic rise — gift after gift, no descent. Pure ascent. Rarely a whole story on its own (no jeopardy); useful for naming a stretch that a drop should later cut into.",
    watch: "If the WHOLE spine is this shape, it has no hole and no midnight — diagnose where the drop belongs.",
  },
];

/** The shapes as a prompt block — a diagnostic frame for testing a spine's emotional trajectory. */
export const STORY_SHAPES = `STORY SHAPES (Kurt Vonnegut) — a story's emotional trajectory drawn as one line: good fortune (top) ↔ ill fortune (bottom), beginning → end. Use these as a DIAGNOSTIC FRAME for the spine — ask which line this book is drawing and where the spine breaks the line it promises. NOT a template to force the book into; the brief, argument, and settled ending win every time.

${SHAPES.map((s) => `- ${s.name}: ${s.curve}\n  Catches: ${s.watch}`).join("\n")}

To use: name the shape the book is reaching for, trace the spine's line against it (where's the fall? the midpoint turn? the final position vs. the start?), and name the break — a hole with no bottom, a loss that doesn't cost, a soar with no preceding drop, a flat middle. That break is the highest-leverage fix.`;
