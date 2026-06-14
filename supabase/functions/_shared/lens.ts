// lens.ts — knowledge-base beat templates, as a diagnostic frame for the beat-sheet reviser.
//
// The structure docs live in knowledgebase/creation/structures/*.md, which a DEPLOYED edge fn can't
// read (not bundled). So the load-bearing part — each structure's ordered BEAT SKELETON with its
// position markers — is distilled here as string constants, faithful to those docs. A lens is a lens:
// a frame to find what's MISSING or SAGGING, never a template to force the book into. The reviser's
// prompt enforces that subordination; this module only supplies the skeleton text.
//
// Reusable beyond the reviser: the bulk beat-generator and the evaluator can pull the same templates.

export type LensId =
  | "save-the-cat"
  | "story-circle"
  | "heros-journey"
  | "fichtean-curve"
  | "romancing-the-beat";

interface Lens {
  id: LensId;
  name: string;
  bestFor: string;
  skeleton: string; // the ordered beats, with position markers
  watch: string;    // the one or two failure modes this lens is best at catching
}

const LENSES: Record<LensId, Lens> = {
  "save-the-cat": {
    id: "save-the-cat",
    name: "Save the Cat! Beat Sheet",
    bestFor: "Commercial fiction; tight, measurable pacing.",
    skeleton: [
      "1. Opening Image (0–1%) — the 'before' state; the protagonist's flaw and the tone.",
      "2. Theme Stated (~5%) — a minor character hints at the truth the protagonist must learn.",
      "3. Setup (1–10%) — stakes, world, the protagonist's reluctance to change.",
      "4. Catalyst (~10%) — the inciting incident shatters the ordinary world.",
      "5. Debate (10–20%) — the protagonist resists; a realistic aversion to change.",
      "6. Break Into 2 (~20%) — a proactive choice to enter the Act II world.",
      "7. B Story (~22%) — a secondary subplot (often romance/mentorship) that carries the theme.",
      "8. Fun and Games (20–50%) — the 'promise of the premise'; the genre's core appeal.",
      "9. Midpoint (~50%) — a false victory or false defeat that raises the stakes.",
      "10. Bad Guys Close In (50–75%) — internal flaws and external foes pile on.",
      "11. All Is Lost (~75%) — the lowest point; a 'whiff of death'.",
      "12. Dark Night of the Soul (75–80%) — mourning, then seeing the Lie is destroying them.",
      "13. Break Into 3 (~80%) — armed with the truth, a final plan forms.",
      "14. Finale (80–99%) — the climax; the truth applied to win, proving change.",
      "15. Final Image (99–100%) — the inverse of the Opening Image; transformation made visible.",
    ].join("\n"),
    watch: "A mechanical/missing Midpoint and a Theme-Stated↔Final-Image pair that don't answer each other; Fun-and-Games that doesn't deliver the genre's core appeal.",
  },
  "story-circle": {
    id: "story-circle",
    name: "Dan Harmon's Story Circle",
    bestFor: "Character-driven, episodic, screen-style; a lighter monomyth.",
    skeleton: [
      "1. You — a character in a zone of comfort.",
      "2. Need — a void or desire pushes them toward the edge of comfort.",
      "3. Go — they cross the threshold into an unfamiliar situation.",
      "4. Search — they adapt to the chaos, acquiring what they need.",
      "5. Find — they get what they were after.",
      "6. Take — the load-bearing beat: they pay a heavy, often unexpected price. No easy victory.",
      "7. Return — they come back to the familiar world, carrying what they found.",
      "8. Change — they're fundamentally altered; the old comfort no longer fits.",
    ].join("\n"),
    watch: "Step 6 (Take) costing nothing — the circle doesn't turn; and a step 8 that returns the character unchanged.",
  },
  "heros-journey": {
    id: "heros-journey",
    name: "The Hero's Journey (Monomyth)",
    bestFor: "Fantasy, sci-fi, epics; a single transformative protagonist.",
    skeleton: [
      "1. Ordinary World — the flawed baseline; quietly seed the Lie.",
      "2. Call to Adventure — an inciting incident demands a response.",
      "3. Refusal of the Call — fear or the Lie makes them hesitate.",
      "4. Meeting with the Mentor — a guide supplies training, a tool, or wisdom.",
      "5. Crossing the First Threshold — the point of no return into the Special World.",
      "6. Tests, Allies, and Enemies — the new world's rules; allies and foes.",
      "7. Approach to the Inmost Cave — preparation; facing the deepest internal fear.",
      "8. The Ordeal (~midpoint) — a death-and-rebirth survived by a narrow margin.",
      "9. Reward (Seizing the Sword) — they claim what they sought.",
      "10. The Road Back — the antagonist retaliates; a desperate return.",
      "11. The Resurrection (climax) — a final, fatal test proving the Lie is shed.",
      "12. Return with the Elixir — back home, transformed, healing the community.",
    ].join("\n"),
    watch: "An underwritten Mentor (4) and Resurrection (11); a passive hero who doesn't CHOOSE to cross the threshold or EARN the resurrection.",
  },
  "fichtean-curve": {
    id: "fichtean-curve",
    name: "The Fichtean Curve",
    bestFor: "Thrillers, mysteries, suspense; relentless momentum.",
    skeleton: [
      "1. Open in medias res — a crisis on the first pages; no traditional first-act world-building.",
      "2. Weave backstory into conflict — exposition delivered inside tension, never isolated.",
      "3. Build through escalating crises — three or more rising crises, each larger than the last, with brief mini-resolutions between (the tension floor rises each time).",
      "4. Spike to the climax — accumulated tension peaks in the final, largest crisis.",
      "5. Compress the denouement — tie off quickly and get out.",
    ].join("\n"),
    watch: "An opening that establishes normalcy instead of crisis; flat escalation (crisis #3 no bigger than #1); a bloated, tidy ending that kills momentum.",
  },
  "romancing-the-beat": {
    id: "romancing-the-beat",
    name: "Romancing the Beat",
    bestFor: "Romance, or any relationship-centered story.",
    skeleton: [
      "1. Meet Cute (or Meet Ugly) — the inciting collision; first friction, attraction, or intrigue.",
      "2. The 'No Way' — each lead spells out why a relationship is impossible (rooted in their wound/Lie).",
      "3. Adhesion — a device (shared goal, forced proximity) that stops them walking away.",
      "4. The Dark Night / Black Moment — a crisis shatters the relationship; the fear's cost is exposed.",
      "5. The Grand Gesture & Wake-Up — one or both make a vulnerable, high-stakes move to reclaim it.",
      "6. HEA / HFN — the mandatory emotionally-positive payoff proving they've changed.",
    ].join("\n"),
    watch: "A breakup (4) with no real cost; plot that doesn't pressure the RELATIONSHIP; a weak Adhesion (3) that lets the middle stall into 'why don't they just talk?'.",
  },
};

export function getLens(id: string | null | undefined): Lens | null {
  if (!id) return null;
  return LENSES[id as LensId] ?? null;
}

/** The lens as a prompt block — skeleton + what it's best at catching. */
export function lensBlock(id: string | null | undefined): string {
  const lens = getLens(id);
  if (!lens) return "";
  return (
    `STRUCTURAL LENS — ${lens.name} (best for: ${lens.bestFor})\n` +
    `Use this as a DIAGNOSTIC FRAME to find what the beat sheet is MISSING, sagging on, or paying off ` +
    `weakly — NOT a template to force the book into. The book's brief, spine, and existing intent win ` +
    `over the template every time.\n\n` +
    `Beat skeleton:\n${lens.skeleton}\n\n` +
    `This lens is especially good at catching: ${lens.watch}`
  );
}
