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

// The seed's logline anatomy — what a logline must NAME (protagonist/inciting incident/goal/obstacle/
// stakes) and what makes it land. Used by dna-expand's one-shot logline forge AND by read-logline (the
// brief-fidelity judge) — the same definition of "a good logline" grounds both writing it and judging it.
export const LOGLINE_CRAFT = `ANATOMY — name FIVE things, concretely and specifically (no generic placeholders):
- the PROTAGONIST — defined by the trait or role that matters, NOT a name ("a disgraced surgeon", not "Sarah"),
- the INCITING INCIDENT — the event that upends their world,
- their PRIMARY GOAL — what they must now actively do,
- the MAIN OBSTACLE / antagonist — what stands in the way,
- the STAKES — what is lost if they fail (life-or-death, or emotional/social — but felt and concrete).
The working shape is: "When [inciting incident], a [flawed/specific protagonist] must [pursue goal] or else [stakes] — but [obstacle]." (e.g. Jaws: "When a great white terrorizes a beach town, a water-phobic sheriff must hunt it down before it kills again — against a mayor who wants the beaches open.")

WHAT MAKES IT STRONG:
- IRONY baked in — the protagonist's trait should rub against the task (a water-phobic sheriff hunting a shark). If person and problem create no friction, it reads flat.
- SPECIFICITY over vagueness — a world, a wound, a mission; never "a woman deals with loss".
- An ACTIVE protagonist — "must", "fights to", "races to". The character DOES; things don't merely happen to them.
- ONE story, not three — pick the spine; cut the romance/mystery/family subplots that dilute it.
- Under ~35 WORDS — if it doesn't fit in one breath, it's carrying backstory or subplot.

AVOID: naming characters, describing THEME instead of plot ("a story about redemption"), withholding the hook to be mysterious, stuffing in backstory, and passive framing ("a man discovers his life is a lie").
TEST before you answer: could a stranger imagine the poster, the genre, and the general shape of the ending? If they'd ask "okay, but what happens?", you've written a situation, not a story — rewrite.`;

// Five of the premise generator's own silent self-eval criteria (dna-expand's "Silent evaluation lint
// before you answer" — it scores itself against these before answering, then discards the scores). Shared
// here so read-premise (the logline-fidelity judge) grounds its axes in the SAME wording rather than a
// second hand-authored copy that can drift from this one as either prompt gets tuned later. Each consumer
// wraps its own scale/mechanics around this text (dna-expand: 0-5/40pt internal; read-premise: 1-5/floor-3
// stored-and-linted) — only the diagnostic wording is shared.
export const PREMISE_JUDGE_CRITERIA: { key: string; label: string; desc: string }[] = [
  { key: "escalation", label: "ESCALATION",
    desc: "Does each movement complicate the previous one, or do any merely sequence events? Name any swappable pair." },
  { key: "internal_trajectory", label: "INTERNAL TRAJECTORY",
    desc: "Do movements track the protagonist's changing relationship to their want, or external plot? Quote the weakest movement." },
  { key: "forced_choice", label: "FORCED CHOICE",
    desc: "Does the final movement present a want-vs-need choice that costs something either way? An obviously correct option is a failure." },
  { key: "question_shape_lock", label: "QUESTION-SHAPE LOCK",
    desc: "Is the dramatic question answered precisely by the final movement — no more, no less?" },
  { key: "price_in_question", label: "PRICE IN THE QUESTION",
    desc: "Does the question contain a cost, and could a reader root for both answers?" },
];

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

// The novelist's craft for rendering ONE scene's prose from its plan — the voice fourth-wall rule, the
// anti-repetition law, and the anti-tic budgets mined from finished drafts (docs/structure-miner.md).
// dna-expand's prose target interpolates this AFTER the fixed "you are a novelist / output prose only"
// scaffolding, so the author can retune HOW their book's prose reads without touching the output contract.
export const PROSE_CRAFT = `CONTINUITY — obey the SEAM instruction in the context: it tells you where the story stands (the previous scene's exit) and how this scene joins it. Move the story FORWARD from that point. Do NOT recap, re-narrate, or re-stage anything the previous scene already showed, and never leave a charged, open moment it ended on silently dropped.

VOICE — write ONLY the fiction, from inside the story: NEVER address or mention "the reader"/"you", and NEVER refer to "the book", "the story", "the scene", "the page", the author, or the writing itself. The plan's notes describe INTENT in craft terms (e.g. "the reader is told it reads as fury", "the book plants the wrong label") — those are directions TO YOU, not lines to reproduce. Dramatize that intent through concrete action, sensation, and subtext; never narrate it or break the fourth wall.

ANTI-REPETITION (critical): Never repeat any physical gesture, character reaction, sentence structure, or phrase within this scene — not even once. If a character smirks in paragraph 2, they cannot smirk (or twitch, or smile faintly) again. Each beat of the scene must be rendered with entirely fresh language. If you feel the urge to reuse a phrase or gesture, stop and invent a different one. This scene ends when the plan's goal/outcome is dramatized — do not loop, pad, or re-dramatize beats already written.

CRAFT VARIETY (anti-tic) — mined from finished drafts (docs/structure-miner.md): these default moves, each fine once, read machine-written when they become every scene's move. Hard budgets for THIS scene:
- CLOSURE: do NOT end by circling back to the scene's opening image/gesture/weather (a bookend) — end on a new image, a hard cut, a spoken line, or a decision instead.
- WEATHER: do not open OR close on weather/room-atmosphere by default; earn it or skip it.
- INTERIORITY: do not default to the POV decoding someone's micro-expression or physical tell; rotate channels — memory, bodily sensation, direct thought, a choice made and acted on.
- EM-DASHES: at most one per ~300 words; prefer commas, periods, or restructured sentences.
- CLIMAX CADENCE: do not automatically drop into staccato fragments at the emotional peak; vary how the peak is paced.
- NEGATION-DEFINITION: the "it wasn't X, it was Y" pattern at most once per scene.`;

// ── Craft-note registry — the editable face of the tier-1 craft above ────────────────────────────────
// One entry per generation STAGE that carries distilled craft. This is what the Craft Notes tab lists:
// each entry's `body` is the DEFAULT (the consts above), and `books.craft_overrides[key]` — when the
// author sets one on the tree's Craft Notes tab — replaces it for THAT book only. Both write paths read
// the override through craftBody() (dna-expand interpolates it into the stage prompt; the book-agent
// surfaces it as an override block over its default-craft skills), so a per-book note actually changes
// generation. Keep this list in lockstep with the web mirror `craftNotes.json` (craftNotes.artifact.test).
export interface CraftNote {
  key: string;   // stable override key — books.craft_overrides[key]
  label: string; // the node type / generation stage this craft governs
  help: string;  // one line: what this note controls
  body: string;  // the tier-1 default text (the source of truth is the const above)
}
export const CRAFT_NOTES: CraftNote[] = [
  { key: "logline", label: "Logline", help: "How the seed's raw idea is forged into the book's logline.", body: LOGLINE_CRAFT },
  { key: "premise", label: "Premise", help: "The shape + dramatic-question anatomy the premise must hit.", body: PREMISE_CRAFT },
  { key: "causality", label: "Beats · causality", help: "How each beat earns its \"therefore\" (needs / establishes).", body: CAUSALITY_CRAFT },
  { key: "polarity", label: "Beats · polarity", help: "The anti-sag rule — oscillate polarity within an act's trend.", body: POLARITY_CRAFT },
  { key: "scene_direction", label: "Scene · direction", help: "The direction grammar for how a page is shown (cut/distance/mode…).", body: SCENE_DIRECTION_CRAFT },
  { key: "prose", label: "Prose", help: "How a scene's prose is written — voice, anti-repetition, anti-tic budgets.", body: PROSE_CRAFT },
];

const CRAFT_BY_KEY: Record<string, string> = Object.fromEntries(CRAFT_NOTES.map((c) => [c.key, c.body]));

// The book-level craft text for a stage: the author's override if they set (and didn't blank) one on the
// Craft Notes tab, else the tier-1 default. This is the ONE substitution point both write paths call.
export function craftBody(key: string, overrides?: Record<string, string> | null): string {
  const o = overrides?.[key];
  return (typeof o === "string" && o.trim()) ? o : (CRAFT_BY_KEY[key] ?? "");
}

// A prompt block listing only the stages the author has actually overridden — injected into the
// book-agent's per-book context so its (default-craft) skills defer to the author's wording for this book.
export function craftOverrideBlock(overrides?: Record<string, string> | null): string {
  const set = CRAFT_NOTES.filter((c) => typeof overrides?.[c.key] === "string" && overrides![c.key].trim());
  if (!set.length) return "";
  return set.map((c) => `### ${c.label} — the author's craft note for THIS book (supersedes your default craft):\n${overrides![c.key].trim()}`).join("\n\n");
}
