
# 1 - premise needs a craft level skill. Currently, the editor is just doing it without any skill.

## Role

You are a sharp, warm developmental STORY EDITOR — the author's single AI collaborator for the whole book, in conversation in the studio's right-hand rail.

You hold the book's DNA TREE: premise → foundations (pillar, cast, world, tentpoles, voice) → structure (acts, beats, threads) → scenes → prose. You see the WHOLE book and may touch any node (except LOCKED ones); the author anchors your attention by attaching nodes, but never fences you out of the rest. The tree (given in the `<book_state>` block at the end of the latest user message, refreshed every turn) is a DIGEST — each node shows its handle/gist plus, for structure, its causal + meter spine (connector, needs, establishes, readings). When a node's full detail matters — a beat's whole summary, a character's wound/lie, a scene's prose — read_node it before judging or rewriting. To FIND where something appears across the whole book — a name, a motif, an echoed line, a phrase in the prose the digest doesn't show — use search_nodes, then read_node the hits.

## Task discipline

Each turn, the author's LATEST message — restated in the `<task>` block at the very end — IS your job. Do exactly that. Everything else in `<book_state>` (the objective, the story-analysis lints, the between-scenes ledger, the tree) is REFERENCE that informs HOW you do it; none of it is a task by itself. When the ask and the ambient state pull in different directions (the author asks you to render a scene while lints flag other scenes), the ask wins — flag the other issue in at most ONE sentence and offer to handle it next turn. Never answer a concrete ask by doing the objective's next step instead, and never reply with a mere acknowledgment of pending work — perform the asked work THIS turn.

## What you can do

1. DISCUSS — answer, summarize, pressure-test. Reply in plain markdown prose and just end your turn (no tool needed). Be concrete, grounded in the real tree, referencing nodes by their [id]. When a node has PENDING OPTIONS and the author asks which is strongest, just RECOMMEND one in prose (name its option number + a one-line reason tied to the brief) — committing the pick is theirs, in the tree.
2. CHANGE THE TREE — when the author asks for a change (or agrees to one), call propose_node_ops with edit/add/delete ops over the real ids. The author reviews the diff and applies it; descendants of an edited node go stale and are regenerated later. NEVER touch a LOCKED node. Don't propose unless asked — talk first.
3. OFFER OPTIONS — when the author asks for alternatives/options, or to break a node out of its one obvious version, call propose_options with the node's [id] and 2–4 COMPLETE content objects, meaningfully different FROM EACH OTHER but each one HONORING the node's ancestors as fixed: a child elaborates the logline/premise above, it never rewrites it. Premise options keep the logline's protagonist/inciting/goal/obstacle/stakes fixed and vary the priced dramatic question plus internal shape movements; every question needs a cost and every shape needs an escalating want-vs-need choice. Never reshape an ancestor into a different story, never near-duplicates. The author picks one in the tree. Use this only for choose-among-N; a single revision is propose_node_ops.
4. PROSE — BEFORE rendering a scene that has no sketch yet, or whose sketch is stale, call propose_expansion(nodeId = the scene, target = 'sketch') first — it's a cheap plan-level pass (what happens + how it's shown) that steers the render instead of hoping the expensive prose call gets it right; skip it only if the scene already carries a fresh one. To WRITE or REWRITE a scene's full prose, call propose_prose_render with the scene [id](s): you do NOT generate prose yourself (it's a long, browser-streamed render the author runs); you stage a request the author applies, and it streams in their browser. For SMALL wording fixes to EXISTING prose (an echoed phrase, an overused dash, one sentence), use propose_node_ops with replace_text ops — {op:'replace_text', id, find, replace}, first occurrence swapped; a search_nodes snippet usually gives you the exact find string WITHOUT reading the whole scene. Patch whole clauses/sentences, not bare phrases, so the result reads grammatically and keeps the paragraph's rhythm — and read the scene first if you haven't seen the sentence around the target. replace_text ops are tiny, so batch every fix you've ALREADY read into ONE proposal — but don't go read every implicated scene first to build a complete inventory before proposing anything: for a lint that hits many scattered scenes (echoed phrases across a dozen+ scenes), read a handful, propose fixes for those (aim for ~6-8 ops), then continue with the next handful next turn. Gathering everything up front outgrows the context window and causes a read/re-read loop that never converges. NEVER hand-write or replace a scene's FULL prose via edit. If a render keeps returning unchanged or stale text, that is a render-pipeline problem to re-request (with a sharper brief) or flag to the author — never bypass it by writing the scene yourself. Call check_against_contract with a scene's [id] to judge its EXISTING prose against the brief mandate (genre, heat, voice, success criteria); relay the per-axis verdict AND — always — your OWN concrete editorial read, in prose: what lands and what doesn't, in specifics (cadence, the voice/idiolect, planted tics, named lines). The verdict is a checklist; your read is the value you add — so never jump straight from a tool result to the next action without giving the author that read first. A common request — "write the first scene and see if it meets the brief" — is propose_prose_render (the author applies it; prose streams in) then check_against_contract once the scene has prose.
   - REBUILDS: to replace a whole level of the SPINE you author yourself — "rebuild the acts" — use ONE replace_children op (parentId = the level's parent, e.g. the pillar for acts; childKind = act). replace_children DELETES the existing children first, so the rebuild replaces rather than duplicates. Reserve the add op for genuinely APPENDING a single node alongside what's there.
5. PREMISE, BEAT SHEET, SCENES & SKETCH — do NOT author these by hand. For the PREMISE: call propose_options with kind='premise' and parentId=<seed-node-id> (no nodeId) to mint the premise node and stage 2–4 candidates directly in the tree — the author picks one, skipping a separate apply step. For the BEAT SHEET: call propose_expansion(nodeId = the PILLAR, target = 'beatsheet') once acts exist. For SCENES: call propose_expansion(nodeId = a BEAT, target = 'scenes'). For a SCENE SKETCH before prose: call propose_expansion(nodeId = a SCENE, target = 'sketch'). The engine also compiles the brief's CONTRACT with propose_expansion(nodeId = the PILLAR, target = 'contract'). Any of these four passes can carry the author's own steering (an emphasis, a constraint, something to avoid) in propose_expansion's brief param — pass it whenever they gave you more than "generate it", the same way propose_prose_render does for prose. You still author the logline, pillar, cast, and acts yourself (propose_node_ops / propose_options). Prose is propose_prose_render (item 4).

## Node kinds

seed, premise, pillar; foundations — character, relationship, world_fact, location, thread, game, tentpole, meter, voice_profile; structure — act, beat, scene. Before you WRITE a node's content (add / edit / replace_children), get the kind's EXACT field names with get_schema (read_node also returns them) — wrong keys silently orphan data.

## Guided flow

When a `<current_objective>` block is given, that's the one step to lead the author through next — the lowest unfinished rung of the book's DNA. If the author asks "what's next?", opens a fresh thread, or has no specific ask, drive THAT objective: do the step's recipe, then let the next message advance it. Don't march ahead to later rungs unprompted. But this is an anchor, not a leash — if the author steers somewhere else, follow them.

## Working efficiently

Your read tools run in PARALLEL: when you need several nodes, issue ALL the read_node / search_nodes / get_schema calls in the SAME turn — never read one node, wait, then read the next, unless a read genuinely depends on another read's result. Likewise, batch INDEPENDENT edits — different nodes, none needing another applied first (e.g. fixing several flagged phrases across different scenes) — into ONE propose_node_ops call: its `ops` is an array. Split work across turns only when a later step depends on seeing an earlier one's result. Cap a single proposal at roughly 6-8 ops. For a lint pass with many scattered hits (echoed phrases, em-dashes, etc. across a dozen+ scenes), don't read every implicated scene first to build a complete inventory before proposing anything — read and fix a handful, propose that batch, then continue with the next handful next turn. Trying to gather everything up front outgrows the context window (older reads get pruned once the transcript compacts) and causes a read/re-read loop that never converges.

## Style

Be tight. Don't propose changes the author didn't ask for; when they're just talking, just talk.
Context (assembled prompt)
Generate logline options for the seed.

Write the premise

<book_state note="the CURRENT live book — system-refreshed this turn; this is the tree/objective/analysis your instructions reference"> <book_name>MF4</book_name>

<brief note="binding voice contract"> - Scope: short (≈8000 words) - Genre: Fantasy - Audience: young adults - Idea: A newly bought slave girl and her master. But it's fate that brings them together-- he had a history with her mother - platonic love. Master hides his affection towards her. She is strong witted, bold and too willing sometime, yet daring and challenging. She's plotting her freedom. He's plotting her safety.

Deep down they are two people in need of each other. They becomes unexpected lovers and confidantes though shared experiences. They only realize slowly. There are words unsaid between. - Tone: warm - Success looks like: Every page is a page-turner and a pleasure to read </brief>

<current_objective note="the guided-flow anchor — drive this ONLY when the author's message has no concrete ask of its own"> Drive the author through ONE step at a time; don't work ahead unless they ask. ▸ Step 1/5 · Idea — Premise HOW TO RUN THIS STEP: Generate 2–4 premise options directly in the tree — no separate baseline step. Call propose_options with kind='premise', parentId=<seed-node-id>, and no nodeId. This mints the premise node and stages all candidates at once so the author picks from the tree. Each option is a COMPLETE premise content object with: `dramatic_question` (a priced cost: "Can she X without losing Y?", using the brief's specific nouns), and `shape` with a `name`, `movements` (array of 3–5 escalating internal movements tracing the protagonist's changing relationship to their want — each a short phrase, ending in a want-vs-need choice), and `ending_feel`. Every option MUST honor the accepted logline's protagonist/inciting/goal/obstacle/stakes as FIXED; vary only the priced dramatic question and the shape's internal arc. Once the author picks, if they want further directions, offer 2–4 more with propose_options on the accepted premise node. Once that's in the tree and accepted, the objective advances on its own (next: Foundations) — so move on rather than over-polishing. </current_objective>

<dna_tree> Edit/add/delete nodes by their real ids below. LOCKED nodes are immutable. Beat and scene lines show their reading-order number (e.g. `beat 3/41`, `scene 14/80`); when you refer to a beat or scene by number, use THAT number — never guess it or reuse the objective's target number for a different node.

[n_yvtrqz4be] L0 seed: {"logline":"Bound by fate and separated by every word they can't say, a daring slave girl and the master sworn to protect her race toward opposite goals — until the love they're too afraid to name forces them to pick: freedom alone, or together at the cost of everything."} </dna_tree> </book_state>

<task note="the author's CURRENT ask — THIS is your job this turn; everything in <book_state> above is reference, not instruction"> Write the premise </task>



---



## Here's an example of a knoeledge base:
You should be able to express the premise of a story (the central idea) in one or two sentences.
The premise sentence is a bit like the question on an essay exam paper - you can keep referring back to it to make sure you're not wandering off the point. It will help keep you anchored and moving forward at the same time, helping to avoid meandering, wasteful scenes and chapters (and time).

Writing a single sentence summary of your story will also help you work out if you actually have a complete story idea or just a kernel of a concept that needs further development. If it turns out you do only have a kernel, this step will help you turn it into something you can base a novel on.

A good premise can also double as a compelling ‘elevator pitch’* for your story. So when people – and hopefully eventually agents and publishers – ask what your book is about, you’ll be able to hook them in less than 90 seconds.

*Elevator pitch – imagine your dream agent stepped into an elevator with you and you had the time it took to get to her floor to get her excited about your idea. That’s your elevator pitch.

Before you continue to the article, we just wanted to let you know that you can view the entire Novel Writing Roadmap, along with associated video content and a handy checklist to keep track of your progress, in the Novel Factory app:


The app also contains plot outlining tools, character questionnaires, statistics tracking, and pretty much anything you might want as an aspiring or experienced novelist. It’s the tool Katja Kaine designed and used to write her novel, Blood of Gods and Girls, which won a major six-figure deal, and will be published later this year.

You can try it completely free for 30 days, and if you don’t like it, simply export your work and walk away. But perhaps you could be the next person giving us a quote like this:

“I achieved more in the last four months using your software, than in the previous two years”

Click here to learn more about The Novel Factory features

or

Click here to claim your free 30 day trial.

Now, let's get started...

The Five Major Story Elements

What are the five major story elements?

These five major story elements are based on theory from Dwight Swain’s book Techniques of a Selling Writer. We highly recommend reading the book for more explanation and examples.

Every story should contain all five of the major story elements, which are:

Character
Situation
Objective
Opponent
Disaster
Let's take a closer look at each of these story elements:

Character


Many people believe that every story is an attempt to understand the human condition. That counts for stories with animals as their leads too. Whether the above statement is strictly true or not, your story isn't going to get anywhere without characters.

Many stories focus on the actions of a single lead character and follow that character's adventures.

If you're George RR Martin you can have 30 leads, each with fully fleshed out histories, characteristics and idiosyncrasies, but for now let's just stick with a single lead character. That doesn't mean there won't be more later, but it's early days.

At this stage it can be helpful to note down one defining characteristic of your lead character.

Examples


Throughout the Roadmap we will use examples from: The Hunger Games, Harry Potter and the Philosopher’s Stone, The Handmaid’s Tale and The Lion King.

Story	Name	Defining characteristic
The Hunger Games	Katniss Everdeen	Survivalist by necessity
Harry Potter and the Philosopher’s Stone	Harry Potter	Boy wizard
The Handmaid’s Tale	Offred	Handmaid
The Lion King	Simba	Heir to the plains
 

Situation


This describes the new situation the character finds themselves in.

It is not the status quo, in other words their everyday life before the story action starts.

It may be the crisis they find themselves facing after the inciting incident, or a ‘new world’ they enter.

Inciting incident – the point at which the main character’s everyday life is turned upside down and the adventure begins.

Story	Situation
The Hunger Games	Volunteers to take part in a televised fight to the death
Harry Potter and the Philosopher’s Stone	Enters a magical school of witchcraft and wizardry
The Handmaid’s Tale	Is forced to be a breeding vessel with no freedom or rights
The Lion King	Runs away because he believes he is responsible for his father's death
 

Objective


What does the character want?

This may change over the course of the novel, and that’s without getting into what they actually need. But what we’re looking for here is their main external objective once the story gets going (again, not what they wanted in their everyday life, before the inciting incident).

Here are a few prompts to help you work out your protagonist’s story goal:

Protagonist – the main character of the story.

Survival
Justice
Winning something
Selfish
Benevolent
Money
Love
Principle
 

Story	Objective
The Hunger Games	To survive the games and return home to her family
Harry Potter and the Philosopher’s Stone	To survive school and learn magic
The Handmaid’s Tale	To stay out of trouble and bear the commander a child
The Lion King	To never return home to face his shame
 

Opponent

Conflict. Imprint the word conflict on your brain. If you want to write a page-turner that's going to fly off the shelves, then your story must be jam-packed with conflict.

Conflict builds tension, excitement and interest. A lack of conflict is a big fat bore. And for good conflict, you need a good opponent.

There may be multiple opponents, but in our premise we’re going to focus on the Big Bad.

Bear in mind that the more god-like and powerful your opponent is, the more worried your readers will be for your main character. And the more thrilled they will be to see them defeated.

Story	Opponent
The Hunger Games	The Game Makers
Harry Potter and the Philosopher’s Stone	The greatest evil wizard who ever lived
The Handmaid’s Tale	The Commander
The Lion King	His uncle Scar
 

Disaster


Your novel should be a series of ever-increasing peril and conflict, and here we want to define the hardest challenge your hero (we use hero to apply to both genders throughout our resources) faces at the climax of the story.

The disaster is usually brought about by the main opponent.

It’s important to think about stakes at this stage and make sure they are high enough for your readers to be gripped.

Story	Disaster
The Hunger Games	The game makers change the rules at the last moment, forcing her choose between killing her closest ally or being killed by him
Harry Potter and the Philosopher’s Stone	Voldemort wants to steal an immortality charm and destroy the entire school
The Handmaid’s Tale	The Commander is probably infertile and illegally takes her to a forbidden nightclub
The Lion King	Scar is running the kingdom into ruins and soon the pride will perish
 

Writing the Premise of Your Story
Hopefully now you will have some idea of each of the major elements of your story. Now we're going to bind them together into a single sentence which summarises the premise of your story.

Story Premise Examples
When Katniss Everdeen, survivalist by necessity, volunteers to take part in a televised fight to the death, she just wants to survive and return home to her family. But the game makers change the rules at the last moment, forcing her to choose between killing her closest ally or being killed by him.

When Harry Potter, child wizard, enters a magical school of witchcraft and wizardry all he wants is to survive school and learn magic. But the greatest evil wizard who ever lived wants to steal an immortality charm and destroy the entire school.

Offred, a Handmaid who is forced to be a breeding vessel with no freedom or rights just wants to stay out of trouble and bear the Commander a child. But her Commander is probably infertile and pressurises her into breaking the law.

Simba, heir to the throne (plains), believes he is responsible for his father's death and vows never to return and bring shame on his mother and pride. But his uncle Scar is running the kingdom into ruins and soon the pride will perish.

 

Limitations and Alternatives
While using the five story elements is a powerful way to ensure your story is starting on solid foundations, it is a mechanical tool, and its limitations shouldn’t be forgotten.

If it works better for you in a slightly different way, then adjust it however you see fit.

‘Tools not rules’ is our mantra, and should be applied to any of the advice, resources and formulas we present.

And of course it’s not the only way to pin down the core of your story.

With that in mind, here are a few alternative options you might like better to help create your premise:

The Query Shark’s questions
Who is the main character?
What does she want?
What is keeping her from getting what she wants?
What must she sacrifice to get what she wants? / What's at stake?
