// beat-criteria.ts — the beat-relevant slice of the fiction evaluation rubric, as a prompt block.
//
// Distilled from knowledgebase/evaluation/fiction-evaluation-criteria.md (which a deployed edge fn
// can't read). A BEAT SHEET is plan, not prose, so this keeps only the criteria a beat sheet can
// actually be judged on — Character, Plot, Pacing, Genre contract, Theme — and drops the prose-level
// sections (Dialogue, Prose & Style, Mechanics). The beat editor (beats-agent) evaluates against
// this when the author asks; it is a lens for diagnosis, subordinate to the brief and the author.

export const BEAT_CRITERIA = `FICTION CRITERIA — the beat-relevant slice (judge the PLAN, not prose). Identify the genre contract first; it decides which criteria weigh most.

1. CHARACTER
- Protagonist proactivity: does the protagonist pursue a clear external want + internal need and DRIVE the beats? Red flag: a passive protagonist whose arc is dictated by coincidence or others.
- Character arc: a measurable before/after; internal change tied to the plot's events. Red flag: static characters in a story that demands change; growth that's stated, not dramatized.
- Cast differentiation & function: each major serves a unique role. Red flag: an oversized cast; characters who exist only to convenience the plot.
- Character–plot integration: consequences flow from character decisions; the antagonist is shaped by the protagonist's specific weakness. Red flag: the plot would proceed identically with different characters.

2. PLOT
- Opening hook: a specific entry point that raises a question and signals tone/genre fast. Red flag: info-dump opening; no implicit question.
- Plot logic & coherence: reveals feel inevitable in hindsight; setups pay off; the story EARNS its turns. Red flag: plot holes, contradictions, deus ex machina.
- Obligatory scenes: the book delivers the specific scenes its premise + genre promise (final confrontation; genre-mandated beats). Red flag: missing/rushed climactic scenes; the book ends before it pays what it promised.
- Stakes: internal, interpersonal, and external stakes are concrete and ESCALATE. Red flag: vague threats; stakes stated but never dramatized; flat across all acts.
- Chapter/beat necessity: every beat advances plot, character, or theme — ideally more than one. Red flag: detachable beats; redundancy; beats that exist for atmosphere alone.

3. PACING
- Ebb and flow: speed matches the moment; tension rises and releases in a controlled rhythm. Red flag: uniform pacing; a stalled middle; a rushed ending.
- Each beat earns its space: enter late, leave early. Red flag: lingering setup; beats that don't turn anything.

4. GENRE CONTRACT
- The book delivers the core promise of its declared genre (the reason a reader picked it up), and the beat sheet visibly honors that contract beat for beat. Red flag: a beat sheet that could belong to any genre; the promised payoff is absent or under-weighted.

5. THEME
- Thematic coherence: the argument the story makes is dramatized through the beats (choice, cost, consequence), not asserted. Red flag: a theme bolted on; beats that don't test the book's claim.`;
