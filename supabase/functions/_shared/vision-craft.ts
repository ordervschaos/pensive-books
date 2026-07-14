// vision-craft — tier-1 distilled craft: the ONE definition of "the structure fulfills the
// vision". Embedded verbatim by BOTH the audit_vision judge (book-agent/exec-tools) and the
// vision-fulfillment skill (agent-skills). Edit here, never fork a copy.
// (docs/vision-to-structure.md D8 — same tier-1 pattern as story-shapes.ts.)
export const VISION_RUBRIC = `Sufficiency = every vision commitment has a STRUCTURAL CARRIER, and that carrier is SCHEDULED, not just declared. Judge section by section:
- CHARACTERS: every vision-named character has a node with the full arc quartet (want / need / wound / lie). The protagonist's arc must trace the premise shape's movements. Named-but-flat (a node with just a name/role) = partial.
- RELATIONSHIPS: every vision-named bond has a relationship node — and if the vision implies the bond MOVES (rivals→lovers, trust→betrayal), it needs a carrier for the movement (an arc thread or an owned meter), not just the node.
- PLOT POINTS: every promised moment has a tentpole (source:"vision") AND at least one beat that realizes it (realizes_tentpole). Declared-but-unplaced counts as missing in effect — the tentpole_unplaced lint is the enforcement.
- AIMS / THEMES: the pillar's controlling_idea argues the vision's aim in the author's own direction; the ending delivers that argument on the page; the dramatic_question prices it as a cost ("can she X without losing Y"), not a topic.
- MYSTERIES / PROMISES: every setup or mystery the vision opens has a thread with BOTH anchors scheduled — a setup beat and a payoff beat. Open-ended-on-purpose must be marked waived, not left dangling.
- PACING INTENTS: every stated intent ("slow burn", "keep it light until the midpoint", "one brutal scene") has a meter whose target curve encodes it, and beats carry readings that track that curve — a clean target_drift is the pass bar.
- SETTING: the vision's world rules and places exist as world_fact / location nodes AND scenes ground in them (grounds_in). A location no scene ever visits is partial.
- CONSTRAINTS: every non-negotiable appears in the mandate / voice constraints, and no beat or scene plan violates it.
Verdict per section: covered / partial / missing. Every gap MUST name its fix — the tool and the node ("propose_node_ops: add an arc thread for Mara→Josef, setup at beat 4"). And coverage without causality is NOT sufficiency: a promised moment parachuted into a beat that nothing upstream earns (no connector/needs chain) is partial, not covered.`;
