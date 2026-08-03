// book-agent tool belt: the JSON tool schemas the model is given each turn (control-flow tools +
// the DNA tree tools), plus threadToolsFor which assembles them.
import { AGENT_SKILLS } from "../_shared/agent-skills.ts";

// ── Tools shared across every thread (ask_author/finish are control-flow, not DNA-specific) ──────
const SHARED_TOOLS = [
  {
    name: "ask_author",
    description: "Ask the author ONE creative decision question. Offer 2–4 concrete options when you can (put your recommendation first, marked '(recommended)'). The run pauses until they answer — so batch your thinking and ask only what genuinely changes the plan. At most 3 questions per run; never ask for permission to proceed.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The decision you need from the author, in one or two sentences." },
        options: { type: "array", items: { type: "string" }, description: "2–4 concrete suggestions the author can pick from. They can always answer in their own words instead." },
      },
      required: ["question"],
    },
  },
  {
    name: "finish",
    description: "End your turn without proposing a change — when the author's ask is answered by discussion alone, or (in autonomous mode) once every requested change has been made.",
    input_schema: {
      type: "object",
      properties: { report: { type: "string", description: "A short honest summary of what you found/did." } },
      required: ["report"],
    },
  },
  {
    name: "update_vision",
    description: "Capture what the author just told you into the brief's durable vision document (their characters-in-mind, setting, known plot points, aims, influences, constraints, open questions). Direct write, no review — this records THEIR words, so stay faithful: capture, don't invent or embellish. Pass ONLY the sections that changed; each replaces that section wholesale (carry forward anything worth keeping — the current vision is in your <brief> block). Set compiled: true only at the end of the interview, after the author confirms your summary — it marks the interview done and advances the journey. PUT YOUR CONVERSATIONAL REPLY IN THE `reply` FIELD of this call (your reflection + next questions): that ONE call completes the whole exchange — the reply shows to the author, the vision write lands, and you will NOT be called again to reply separately, so never plan a follow-up message. You may still batch it with other reads when a read is genuinely needed first.",
    input_schema: {
      type: "object",
      properties: {
        characters: { type: "string", description: "Who they have in mind — names, roles, sketches." },
        world_setting: { type: "string", description: "Place, time, rules, atmosphere." },
        plot_points: { type: "string", description: "Anything they already know happens." },
        themes_aims: { type: "string", description: "What the book is FOR — aims, arguments, feelings to land." },
        influences: { type: "string", description: "Comps, authors, tones to echo or avoid." },
        constraints: { type: "string", description: "Non-negotiables (POV, content lines, length, structure)." },
        open_questions: { type: "string", description: "What the author is still unsure about." },
        notes: { type: "string", description: "Anything that fits nowhere else." },
        reply: { type: "string", description: "Your conversational reply to the author for THIS exchange — reflection on what they just said + your next 2–3 questions. Shown to the author as your message; this completes the exchange (no separate reply turn happens). Markdown ok. Omit only when another tool in this same turn will produce the reply." },
        compiled: { type: "boolean", description: "true = interview complete (author confirmed)." },
      },
    },
  },
  {
    name: "audit_vision",
    description: "Judge whether the book's current foundations and structure FULFILL the author's vision (the brief's vision document). Returns a section-by-section verdict — covered / partial / missing — with the concrete gaps (a vision character with no node, a promised plot point no beat delivers, a stated pacing intent no meter targets, an aim the controlling idea ignores). Run it at checkpoints (after the cast lands, after the beat sheet) or when the author asks whether the book matches what they wanted. It's a read: batch it with other reads; then PROPOSE fixes for real gaps — don't just report them.",
    input_schema: {
      type: "object",
      properties: {
        focus: { type: "string", description: "Optional: one vision section or question to audit deeply instead of the full sweep." },
      },
    },
  },
  {
    name: "research_web",
    description: "Search the WEB and get back a short, distilled craft/genre brief for a story problem — use it when the author asks about (or the book needs) real-world reference you don't have: genre conventions readers expect ('how do vampire stories usually open?'), comps and tropes to honor or subvert, period/setting/technical facts, what strong examples of a thing actually do. It runs a live web search and returns 3-6 concrete, usable constraints with cited sources (NOT generic 'writing tips' — reference material a generator can honor), and SAVES them to the book's craft notes so later turns and prose generation see them too. It's a read: batch it with your other reads; it does NOT end your turn. Ask a specific question, not a keyword. Optionally pass a `topic` to name/overwrite the saved note; give `context` if the search needs to know the book's genre/setting to be useful. Don't use it for anything already in the tree (use search_nodes) or for pure craft you already know.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "A specific research question, e.g. 'What conventions do readers expect from the opening hook of a literary vampire novel?' — not a bare keyword." },
        topic: { type: "string", description: "OPTIONAL: a short slug to name/overwrite the saved craft note (e.g. 'vampire-hook'). Defaults to a slug of the question." },
        context: { type: "string", description: "OPTIONAL: one or two lines on the book (genre, setting, tone) so the search returns material that actually fits." },
      },
      required: ["question"],
    },
  },
  {
    name: "record_findings",
    description: "Bank what you LEARNED from reads you've already done, in one line each. Do this as soon as you've read something you'll need later — the raw read results are pruned out of this conversation once it grows (you'll see '[PRUNED …]' where they were), but findings recorded here survive the whole run and are shown back to you every turn in the <findings> block. This is how you build up a picture of the book WITHOUT re-reading: distill now, while the content is still in front of you. Write findings a future you could act on — the concrete observation, not 'I read scene 14' (e.g. 'scene 14 — no controlling metaphor; opens mid-dialogue; Mara still has the keyring'). Include what's FINE as well as what's broken, so you don't re-check it. It's a read: batch it in the SAME turn as your other reads and your next action — it does NOT end your turn and costs you nothing extra.",
    input_schema: {
      type: "object",
      properties: {
        findings: {
          type: "array",
          description: "One entry per thing you learned. Keep each to a line or two.",
          items: {
            type: "object",
            properties: {
              ref: { type: "string", description: "What it's about — the node id, or a human handle like 'scene 14' / 'the brief'." },
              finding: { type: "string", description: "The concrete thing you learned, in your own words — specific enough to act on later without re-reading." },
            },
            required: ["ref", "finding"],
          },
        },
      },
      required: ["findings"],
    },
  },
  {
    name: "read_skill",
    description: `Load one of the specialized playbooks listed in the system prompt's Skills index (${AGENT_SKILLS.map((s) => s.name).join(", ")}) — the full technique for that job. Call it when your turn involves that job and its body is NOT already injected in the latest message's <skill_briefs>. It's a read: batch it in the SAME turn as your read_node/search_nodes calls.`,
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "The skill's name from the Skills index." } },
      required: ["name"],
    },
  },
];

const THREAD_DNA_TOOLS = [
  {
    name: "propose_prose_render",
    description: "Request that the book's prose pipeline (re)generate the FULL prose for one or more scenes — use this whenever the author asks you to write or rewrite a scene's prose from scratch. You do NOT generate the prose yourself: full prose generation is a long, browser-streamed render the author runs (it can't run inside this turn), so this stages a reviewable 'render prose' request the author applies — it then streams in their browser, in the book's voice, with full continuity. The pipeline already has the voice, the mandate, and a continuity digest of every prior page; your job is to ADD what it can't compute — so before you call this, investigate: read the scene's beat and the previous page(s), grep (search_nodes) for the specific threads/objects/facts THIS page must honor, and pass them in `brief`. Pass the scene node id(s) (reading order), a one-line summary, and the curated `brief`. For SMALL wording fixes to EXISTING prose, use propose_node_ops to edit content.prose.text directly instead — only use this for full (re)generation. This records the request and ENDS your turn.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line: which scene(s) and why you're (re)generating their prose." },
        sceneIds: { type: "array", items: { type: "string" }, description: "The scene node id(s) to (re)generate prose for, in reading order." },
        brief: {
          type: "object",
          description: "OPTIONAL but strongly preferred: your curated, verbatim guidance for this page — injected on top of the pipeline's own context. Only include what you actually retrieved by reading/grepping; do not invent. Omit entirely if you have nothing beyond the plan to add.",
          properties: {
            focus: { type: "string", description: "One line: what this page is really ABOUT — the beat's turn in your read." },
            mustHonor: { type: "array", items: { type: "string" }, description: "Specific continuity that has to land, in your words: named objects, prior promises, a character's state or idiolect you pulled via read_node/search_nodes. e.g. 'Mara still carries the brass keyring she pocketed in ch.1'." },
            avoid: { type: "array", items: { type: "string" }, description: "Things NOT to repeat or contradict, beyond generic anti-repetition: e.g. 'the rain stopped last page — do not re-describe it'." },
          },
        },
      },
      required: ["summary", "sceneIds"],
    },
  },
  {
    name: "check_against_contract",
    description: "Judge a scene's PROSE against its contract — TWO complementary checks: (1) PLAN conformance — does the prose deliver the scene's OWN plan (its planned value_shift, the state keys its causal edges say it must `establishes`/`needs`, its thread work)? This is the scene doing its structural job so later scenes can rely on it. (2) MANDATE conformance — does it honor the book's brief (genre, heat, success criteria)? Pass the scene node's id; the scene must already have prose (content.prose.text) — if empty, propose_prose_render first. `check` selects which: 'plan' (default 'both'), 'mandate', or 'both'. Returns per-axis verdicts (pass / partial / fail) with evidence. Read the scene first if you haven't.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The scene node's id." }, check: { type: "string", enum: ["plan", "mandate", "both"], description: "Which contract to check: 'plan' (the scene's own DNA plan), 'mandate' (the brief), or 'both' (default)." } }, required: ["id"] },
  },
  {
    name: "read_shape",
    description: "Judge whether the book's ACTS deliver the movements the premise promised — a paid structural read over the plan (premise.shape.movements vs each act's goal/turning-point/beats), no prose. Returns a per-movement fit score (0=absent…5=fully delivered) with which act(s) carry it and the weakest link. Whole-book, no input needed. Run it after the beat sheet lands, or when the author asks whether the shape/structure is working. It's a read: batch it with other reads.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_facts",
    description: "Check ONE scene's prose against the continuity canon established by every scene before it — extracts the durable facts this scene's prose asserts (key→value) and flags anything it CONTRADICTS (was → now). Pass the scene's node id; it must already have prose. Use this before/after editing a scene you suspect breaks continuity, or when the author asks 'does this still track?'. It's a read: batch it with other reads.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The scene node's id." } }, required: ["id"] },
  },
  {
    name: "read_confusion",
    description: "Cold-read the book's prose so far as a first-time reader would — flags moments a reader who knows only what's been shown couldn't follow (who/where/when/why/an unexplained reference). Whole-book (chapters with prose so far, budget-limited — a very long book returns a partial read; run again to continue). Run it after a run of scenes has prose, or when the author asks if the opening/a stretch reads clearly. It's a read: batch it with other reads.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_node",
    description: "Read one DNA node's FULL content by id — its complete fields (a beat's whole summary, a character's wound/lie/idiolect, a scene's prose content.prose.text), the schema for its kind, and a one-line summary of its children. The tree you're given is a DIGEST (handle/gist + causal spine); use this to pull a node's full detail before judging or rewriting it.",
    input_schema: { type: "object", properties: { id: { type: "string", description: "The node's id from the tree." } }, required: ["id"] },
  },
  {
    name: "get_schema",
    description: "Get the EXACT content field schema for one or more node kinds (e.g. beat, scene, character) — the required keys, allowed values, and id-ref types. Call this before you WRITE a node's content with propose_node_ops or propose_options (add / edit / replace_children) when you don't already have the schema in hand, so you use the right field names — wrong keys silently orphan the data.",
    input_schema: { type: "object", properties: { kinds: { type: "array", items: { type: "string" }, description: "The node kind(s) you're about to write, e.g. [\"beat\"] or [\"act\",\"beat\",\"scene\"] for a rebuild." } }, required: ["kinds"] },
  },
  {
    name: "search_nodes",
    description: "Full-text search across ALL the book's DNA nodes — every field of every node's content, INCLUDING scene prose (which the tree digest does NOT show). Returns matching node ids with a snippet around each hit, so you can FIND where something appears — a character name, a motif word, an echoed line, a phrase in the prose — and then read_node the ones you want in full. This is your grep: use it to gain context the digest doesn't carry (e.g. 'where is the keyring mentioned?', 'is this line echoed in the prose?', 'which scenes name Lena?').",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Case-insensitive text to search for — a name, motif word, or short phrase." } }, required: ["query"] },
  },
  {
    name: "propose_node_ops",
    description: "Propose a concrete change to the DNA tree the author reviews before it's applied: edit / add / delete / replace_children / replace_text ops on nodes by their real ids. This records the proposal and ENDS your turn — narrate what you're changing and why just before calling it. Never touch a LOCKED node. To REBUILD a whole level (replace all acts, or all beats under an act), use replace_children — NOT a pile of `add` ops, which would duplicate what's already there. To RENAME a character/location/world_fact/thread EVERYWHERE it's mentioned (the author says 'rename X to Y', 'call her Y from now on'), issue ONE `edit` op on that entity's own node setting `content.name` to the new name — {op:'edit', id: <entity node>, content:{name:'Y'}}. A database trigger (propagate_character_rename) automatically fans that rename into every other node's prose across the whole book in the same write. Do NOT enumerate scenes and loop replace_text for this — that turns a 1-op rename into dozens of calls chasing verbatim text. For SMALL wording fixes to a scene's EXISTING prose (an echoed phrase, an em-dash, one sentence) that are NOT a systemic rename, use replace_text — {op:'replace_text', id, find, replace} swaps the FIRST occurrence of `find` in that scene's prose. NEVER resend a whole prose text via `edit` for a small fix: replace_text ops are tiny, so DOZENS of prose fixes across many scenes fit in ONE proposal — batch them all. `find` must match the current prose exactly (copy it from a search_nodes snippet or read_node); include enough surrounding words to be unambiguous. PATCH AT THE SMALLEST SELF-CONTAINED UNIT — usually the whole clause or sentence containing the flaw, not the bare phrase — so the replacement reads grammatically in place and keeps the paragraph's rhythm; restructuring around a removed em-dash especially needs the full clause. If you haven't seen the sentence around the target (a snippet shows only ±60 chars), read_node the scene before patching.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line: what this change does." },
        ops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["edit", "add", "delete", "replace_children", "replace_text"] },
              id: { type: "string", description: "edit/delete/replace_text: the existing node id (replace_text: a scene)." },
              kind: { type: "string", description: "add: the new node's kind (character|relationship|tentpole|world_fact|thread|game|act|beat|scene|voice_profile)." },
              parentId: { type: "string", description: "add / replace_children: the existing parent node's id (e.g. the pillar, whose act children are the acts)." },
              childKind: { type: "string", description: "replace_children: which child kind to rebuild (e.g. 'act' to replace all acts, 'beat' to replace an act's beats)." },
              content: { type: "object", description: "edit: the fields to merge. add: the new node's content. Use the exact field names from the schema given.", additionalProperties: true },
              children: { type: "array", description: "replace_children: the NEW children as a nested tree — each { content, children? }; nesting follows the ladder (act→beat→scene). Every existing non-locked child of childKind is deleted first, so the rebuild never duplicates.", items: { type: "object", additionalProperties: true } },
              find: { type: "string", description: "replace_text: the exact text to find in the scene's prose (first occurrence is replaced). Must match the current text verbatim; include surrounding words for uniqueness." },
              replace: { type: "string", description: "replace_text: the replacement text." },
            },
            required: ["op"],
          },
        },
      },
      required: ["summary", "ops"],
    },
  },
  {
    name: "propose_expansion",
    description: "Delegate a structural pass to the book's specialized generation engine instead of authoring it yourself: the PREMISE from the accepted logline (target 'premise'), the GLOBAL beat sheet (target 'beatsheet'), a beat's SCENES (target 'scenes'), the compiled brief CONTRACT (target 'contract'), or ONE scene's SKETCH (target 'sketch'). Use this — NOT propose_node_ops — for these passes. 'premise' derives a priced dramatic question plus 3-5 internal shape movements from the BRIEF + accepted LOGLINE — pass the SEED node's id. 'beatsheet' generates ALL beats across every act in one causal pass — pass the PILLAR node's id. 'scenes' breaks ONE beat into scenes — pass that BEAT node's id. 'contract' compiles the brief's genre/audience/tone into derived promises — pass the PILLAR node's id. 'sketch' generates ONE scene's TREATMENT — pass that SCENE node's id before rendering prose when it lacks a fresh sketch. If the author gave you specific steering for this pass (an angle, a constraint, something to emphasize or avoid), pass it in `brief` — don't just let it evaporate into the summary line. This stages a reviewable 'expand' request the author applies; the engine then runs and its result lands in the tree. ENDS your turn.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line: what you're expanding and why (e.g. 'generate the global beat sheet', 'break beat 3 into scenes', 'sketch the treatment for scene 2')." },
        nodeId: { type: "string", description: "For 'premise': the SEED node's id. For 'beatsheet' and 'contract': the PILLAR node's id. For 'scenes': the BEAT node's id. For 'sketch': the SCENE node's id." },
        target: { type: "string", enum: ["premise", "beatsheet", "scenes", "contract", "sketch"], description: "'premise' = derive premise from brief + logline (nodeId = seed); 'beatsheet' = all beats across acts (nodeId = pillar); 'scenes' = one beat's scenes (nodeId = beat); 'contract' = compile genre promises (nodeId = pillar); 'sketch' = one scene's treatment (nodeId = scene)." },
        brief: {
          type: "object",
          description: "OPTIONAL: the author's own steering for THIS pass — an angle, emphasis, or constraint they stated, verbatim in your words. Omit if they gave you nothing beyond 'do it'.",
          properties: {
            focus: { type: "string", description: "One line: what this pass should particularly emphasize or aim at, per the author." },
            mustHonor: { type: "array", items: { type: "string" }, description: "Specific things the author said this MUST include or respect." },
            avoid: { type: "array", items: { type: "string" }, description: "Specific things the author said to avoid." },
          },
        },
      },
      required: ["nodeId", "target"],
    },
  },
  {
    name: "propose_options",
    description: "Offer the author 2–4 ALTERNATIVE versions of ONE node's content to choose among (the options picker). Use this when the author asks for options/alternatives, or to break a node out of its one obvious 'modal' version. Each option is a COMPLETE content object for that node's kind (the exact field names from the schema, like an edit's content). The options must be meaningfully different FROM EACH OTHER — but every option MUST HONOR the node's ancestors as FIXED: a child elaborates what's above it (the logline, then the premise), it never rewrites it. Premise options keep the logline's protagonist / inciting incident / goal / obstacle / stakes fixed and vary only the priced dramatic question plus internal shape movements. NEVER reshape an ancestor's story into a different book, and never offer near-duplicates. This stages the options ON the node (the author picks one in the tree) and ENDS your turn. For a SINGLE revision, use propose_node_ops (edit) instead. Only target a non-locked node.\n\nCREATING A NEW NODE WITH OPTIONS (premise shortcut): When the premise node doesn't exist yet, skip the two-step propose_expansion→apply cycle: pass kind=\"premise\" and parentId=<seed-node-id> WITHOUT nodeId. This mints the premise node and stages your 2–4 candidates on it in one step — the author picks one in the tree.",
    input_schema: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "The existing node id to generate alternatives for. Omit (with kind + parentId) to create a new premise node and stage options on it in one step." },
        kind: { type: "string", description: "When creating a new node: the kind to create (e.g. 'premise'). Must be a valid node kind. Use with parentId, without nodeId." },
        parentId: { type: "string", description: "When creating a new node: the parent node's id (e.g. the seed node's id for a new premise). Use with kind, without nodeId." },
        note: { type: "string", description: "One line: the axis the options vary along (e.g. 'three takes on the dramatic question's price')." },
        options: {
          type: "array",
          description: "2–4 alternative content objects for this node's kind — each a complete value, meaningfully different from the others.",
          items: { type: "object", additionalProperties: true },
        },
      },
      required: ["options"],
    },
  },
];

// The thread tool belt: ask_author + finish always, plus the DNA tools.
function threadToolsFor(): unknown[] {
  return [...SHARED_TOOLS, ...THREAD_DNA_TOOLS];
}

export { SHARED_TOOLS, THREAD_DNA_TOOLS, threadToolsFor };
