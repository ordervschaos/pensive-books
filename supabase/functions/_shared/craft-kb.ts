// craft-kb — tier-1 distilled story craft, ONE canonical copy for both write paths.
//
// The same craft used to live twice: baked into dna-expand's generation prompts (the ENGINE path —
// whole-level passes like premise/beatsheet/sketch) and paraphrased in agent-skills' playbooks (the
// AGENT path — node-level edits and options). Two copies drift: the first observed drift was the
// premise enum — dna-schema allows ending_feel 'ambivalent', the engine prompt didn't offer it.
// These consts are the single canonical wording; dna-expand interpolates them into its prompts and
// agent-skills into its skill bodies. The engine's phrasing is canonical where both existed — it's
// the battle-tested version (the premise pass eval-lints its own output against these rules).
//
// Keep this file dependency-free (pure string consts) so any runtime — edge function, web test,
// script — can import it without dragging Deno- or browser-specific code along.

// The premise's two coupled halves. The final movement ANSWERS the dramatic question at its stated
// price — which is why the agent path's coupling rule forbids editing one without the other.
export const PREMISE_CRAFT = `SHAPE
- name: a 2-4 word label for the emotional trajectory (not the plot)
- movements: 3-5 beats tracing the protagonist's INTERNAL trajectory.
  Rules:
  * Each movement must change the protagonist's relationship to their want — never merely advance events.
  * Each movement must escalate or complicate the contradiction set up by the previous one. If two movements could be swapped without loss, merge or rewrite them.
  * Movement 1 establishes the want in concrete form.
  * The final movement forces a choice between the stated want and an emerged need — the choice must be genuinely costly either way.
  * The most original element of the brief must appear explicitly in at least one movement, not just be implied.
- ending_feel: up / down / bittersweet / ambivalent — choose deliberately, and it must be consistent with the genre and tone in the brief.

DRAMATIC_QUESTION
One sentence, phrased so that:
  * it is definitively answered by the final movement,
  * it contains a price ("Can she X without losing Y?"), never just a goal ("Will she X?"),
  * a reader could plausibly root for both answers,
  * it uses the brief's specific nouns, not generic abstractions.`;

// The spine's causal law — how a beat EARNS its "therefore". Generation obeys it forward; the agent
// enforces it when editing (a summary edit that drops an `establishes` breaks consumers downstream).
export const CAUSALITY_CRAFT = `CAUSE every turn: give each beat "needs" (state keys it DEPENDS ON, each one EARNED by an EARLIER beat — never an ambient world/premise given) and "establishes" (state keys it PRODUCES). Keys are short snake_case handles (e.g. "ledger_settled", "rival_humiliated", "peculium_revealed"). Every "therefore" beat MUST "need" at least one state an earlier beat "establishes" — that upstream dependency is what makes the turn CAUSED, not "and then". A "but" beat must either reverse the polarity or block/consume an established state.`;

// Polarity oscillation — the anti-sag rule (the sagging-run lint checks the same ~3 threshold).
export const POLARITY_CRAFT = `Set each beat's PLANNED polarity (up = ends better, down = ends worse). The act's value shift is the MACRO trend; you MUST still OSCILLATE within it — never more than ~3 beats of the same polarity in a row. Place deliberate relief/hope-spots inside down-acts and setbacks inside up-acts.`;

// The sketch's DIRECTION grammar — how a page is SHOWN. The engine picks these when sketching; the
// agent reads/edits them on a scene's sketch.direction.
export const SCENE_DIRECTION_CRAFT = `- cut.in / cut.out: where the page enters/leaves the event (arrive late, leave early — never start "the moment before" or linger past the turn).
- distance: far | mid | close | deep (psychic distance — how close the narration sits to the POV mind).
- mode: dialogue | action | interior | description | summary (the dominant texture).
- time: real | compressed | stretched (scene-time vs story-time).
- tension: suspense | mystery | irony (what the reader knows vs the character).`;
