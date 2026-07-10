// agent-skills — the book-agent's specialized playbooks (doc_1783663022711.md).
//
// Progressive disclosure for the agent's instructions: SYSTEM_THREAD keeps only invariants +
// one-line routing; the situational CRAFT (how to patch prose well, how to curate a render brief,
// how to deliver an editorial read) lives here and reaches the model through three channels:
//   1. an always-visible one-line index in the system prompt (name + description),
//   2. deterministic per-turn injection — a skill whose `triggers` match the author's ask is
//      inlined into the request-time tail beside <book_state> (book-agent's threadSystem),
//   3. a read_skill tool the model calls itself when the triggers missed a phrasing — it's a
//      read, so it fans out in parallel with read_node calls (no extra chain link).
//
// Rules for what belongs here vs the core prompt: INVARIANTS (never full-prose-via-edit, never
// LOCKED, the ask wins) stay in SYSTEM_THREAD — a missed trigger must never cost safety. Only
// TECHNIQUE moves here. Op semantics (what replace_text does, field metas) stay colocated in the
// tool descriptions; a skill teaches the workflow AROUND the tool, not its schema.
//
// Triggers are matched against the author's standing ask (latestAuthorAsk) — deterministic, so a
// retried chain link re-derives the identical prompt (the resume invariant).

export interface AgentSkill {
  name: string;
  description: string; // one line for the system prompt's <skills> index
  triggers: RegExp[]; // matched against the author's ask; any hit injects the body this turn
  body: string; // the full playbook
}

export const AGENT_SKILLS: AgentSkill[] = [
  {
    name: "prose-patch",
    description: "surgical fixes to EXISTING prose with replace_text — echoed phrases, overused dashes, single sentences",
    triggers: [/\b(fix|patch|repla|reword|rephras|tweak|echo|em[- ]?dash|dashes|repetiti|overused|wording|phrase|typo|lints?|rename|call\s+(him|her|it|them)\b)/i],
    body: `Small wording fixes to a scene's EXISTING prose are propose_node_ops with replace_text ops — {op:'replace_text', id, find, replace}, first occurrence swapped, scenes only.
- \`find\` must match the CURRENT prose verbatim — copy it from a search_nodes snippet or a read_node; include enough surrounding words to be unambiguous. A snippet shows only ±60 chars: if you haven't seen the whole sentence around the target, read_node the scene before patching.
- Patch at the smallest SELF-CONTAINED unit — usually the whole clause or sentence containing the flaw, not the bare phrase — so the replacement reads grammatically in place and keeps the paragraph's rhythm. Restructuring around a removed em-dash especially needs the full clause.
- replace_text ops are tiny: batch every fix you've ALREADY read into ONE proposal (~6-8 ops). For a lint with hits scattered across a dozen+ scenes, work in handfuls — read a few scenes, propose their fixes, continue with the next handful next turn. Never sweep-read everything first to build a complete inventory: it outgrows the context window (older reads get pruned) and never converges.
- A systemic RENAME (the author says "rename X to Y", "call her Y from now on") is ONE edit op on that entity's own node setting content.name — a database trigger fans the rename into every scene's prose in the same write. Never enumerate scenes and loop replace_text for a rename.`,
  },
  {
    name: "render-brief",
    description: "writing/rewriting a scene's FULL prose — sketch first, investigate, curate the render brief",
    triggers: [/\b(render|write|rewrit|draft|generat|prose|build)\b/i],
    body: `Full prose for a scene is propose_prose_render — you stage the request, the author applies it, and the prose streams in their browser. Your value is the setup:
- SKETCH FIRST: if the scene has no sketch yet (or its sketch is stale), call propose_expansion(nodeId = the scene, target = 'sketch') before rendering — a cheap plan-level pass (what happens + how it's shown) that steers the expensive render. Skip only when a fresh sketch is already there.
- INVESTIGATE, THEN CURATE: the pipeline already has the voice, the mandate, and a continuity digest of every prior page; your \`brief\` adds what it can't compute. Read the scene's beat and the previous page(s); search_nodes for the specific threads, objects, and facts THIS page must honor. Then pass brief.focus (what the page is really ABOUT — the beat's turn in your read), brief.mustHonor (the retrieved continuity, specific and verbatim-ish), brief.avoid (what not to repeat or contradict). Only what you actually retrieved — never invent; omit the brief entirely if you have nothing beyond the plan.
- Multiple scenes go in reading order; in autonomous mode render ONE scene per turn — the result appears on your NEXT turn, never assume it's already written this turn.
- "Write scene X and see if it meets the brief" = propose_prose_render now, then check_against_contract on a later turn once the scene has prose.`,
  },
  {
    name: "editorial-read",
    description: "judging existing prose — check_against_contract plus your OWN concrete editorial read",
    triggers: [/\b(check|judge|evaluat|assess|meets?\s+the\s+brief|contract|verdict|critiqu|feedback|review|how\s+(good|does|is)\b)/i],
    body: `To judge a scene's EXISTING prose, call check_against_contract with its [id] — \`check\` picks 'plan' (the scene's own DNA plan), 'mandate' (the brief: genre, heat, voice, success criteria), or 'both' (default). The scene must already have prose; if not, render first.
Then ALWAYS give the author two layers:
1. The per-axis verdicts, relayed plainly.
2. Your OWN concrete editorial read, in prose: what lands and what doesn't, in specifics — cadence, the voice/idiolect, planted tics, named lines you'd keep or cut. The verdict is a checklist; your read is the value you add. Never jump from the tool result straight to the next action without giving the author that read first.`,
  },
  {
    name: "rebuild-level",
    description: "replacing a whole level of the spine (all acts, an act's beats) with replace_children",
    triggers: [/\b(rebuild|restructur|replace\s+(all|the)\s+\w+|redo\s+the|regenerat\w*\s+(the\s+)?(acts?|beats?|scenes?)|new\s+acts?)\b/i],
    body: `To replace a whole level of the spine you author yourself ("rebuild the acts"): use ONE replace_children op — parentId = the level's parent (e.g. the pillar for acts), childKind = the level being rebuilt, children = the NEW nodes as a nested {content, children?} tree following the ladder (act→beat→scene). replace_children DELETES the existing non-locked children first, so the rebuild replaces rather than duplicates — never emit a pile of \`add\` ops for a rebuild. Reserve \`add\` for genuinely APPENDING a single node alongside what's there. Acts you write by hand; a whole beat sheet is the engine's job (propose_expansion, target 'beatsheet').`,
  },
  {
    name: "premise-craft",
    description: "authoring premise options — the five story elements, a priced dramatic question, an escalating internal shape",
    triggers: [/\b(premise|dramatic\s+question|story\s+shape)\b/i],
    body: `A premise is the book's one-or-two-sentence anchor: every later scene should be checkable against it ("is this still about that?"). It doubles as the elevator pitch. When you author premise OPTIONS yourself (propose_options, kind='premise'), work from craft, not vibes:

FIRST extract the FIVE STORY ELEMENTS (Swain) from the brief + accepted logline:
- CHARACTER — the lead plus ONE defining characteristic ("survivalist by necessity").
- SITUATION — the NEW situation after the inciting incident (never the status quo).
- OBJECTIVE — the external want once the story is moving (survival, justice, love, principle…).
- OPPONENT — the conflict engine; the more formidable, the more the reader worries. Name the Big Bad, even when it's a person the lead loves or a system.
- DISASTER — the hardest choice at the climax, usually forced by the opponent; the stakes live here.
Sanity test: "When [CHARACTER], [SITUATION], all she wants is [OBJECTIVE]. But [OPPONENT] [forces DISASTER]." If a slot can't be filled from the brief/logline, you have a kernel, not a premise — tell the author which element is missing instead of papering over it.

THEN map the elements into the premise content fields:
- dramatic_question: ONE sentence carrying a PRICE — "Can she X without losing Y?", never a bare goal ("Will she X?"). Y comes from the DISASTER; use the brief's specific nouns, not abstractions; a reader could plausibly root for both answers; the final movement answers it definitively.
- shape.movements (3–5): the protagonist's INTERNAL trajectory, not plot events. Each movement changes her relationship to the want and escalates the contradiction of the previous one (if two movements could swap order, merge them). Movement 1 states the want in concrete form; the last forces the want-vs-need choice, genuinely costly either way. The brief's most distinctive element must appear explicitly in at least one movement.
- shape.name: 2–4 words naming the emotional trajectory (not the plot). shape.ending_feel: up / down / bittersweet — chosen deliberately, consistent with the brief's genre and tone.

Options must differ on the PRICE and the internal arc — never on the logline's fixed protagonist/inciting/goal/obstacle/stakes (see options-craft). Conflict is the pulse: an option without a formidable opponent pressure in its question is a fat bore — cut or sharpen it.`,
  },
  {
    name: "options-craft",
    description: "offering 2–4 pickable alternatives for one node with propose_options",
    triggers: [/\b(options?|alternativ|versions?|variants?|choices|takes\s+on|candidates)\b/i],
    body: `propose_options stages 2–4 COMPLETE content objects on ONE node (exact field names from its schema — get_schema first if unsure); the author picks one in the tree. Use it only for choose-among-N; a single revision is propose_node_ops.
- The options must be meaningfully different FROM EACH OTHER — never near-duplicates.
- Every option HONORS the node's ancestors as FIXED: a child elaborates what's above it, it never rewrites it. Premise options keep the logline's protagonist / inciting incident / goal / obstacle / stakes fixed and vary only the priced dramatic question plus the internal shape movements — every question needs a cost, every shape an escalating want-vs-need choice. Never reshape an ancestor into a different book.
- PREMISE SHORTCUT: when the premise node doesn't exist yet, pass kind='premise' + parentId=<seed id> (no nodeId) — mints the node and stages the candidates in one step. For premise options, follow premise-craft (read_skill it if not injected).
- When the author asks which pending option is strongest, RECOMMEND in prose (option number + a one-line reason tied to the brief) — committing the pick is theirs, in the tree.`,
  },
];

// The one-line index for the system prompt (static — byte-stable across turns, cache-safe).
export const SKILLS_INDEX = AGENT_SKILLS.map((s) => `- ${s.name}: ${s.description}`).join("\n");

// Skills whose triggers match the author's ask this turn (deterministic; capped so a chatty
// message can't inject the whole registry).
export function matchSkills(ask: string, cap = 3): AgentSkill[] {
  const text = ask.slice(0, 2000);
  if (!text.trim()) return [];
  return AGENT_SKILLS.filter((s) => s.triggers.some((re) => re.test(text))).slice(0, cap);
}
