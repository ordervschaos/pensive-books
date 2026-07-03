// dna-journey — EDGE TWIN of apps/web/src/features/dna/lib/dnaJourney.ts (guided-journey derivation).
//
// PARTIAL twin: it carries the objective-derivation closure (currentObjective + buildJourney/stageSubsteps/
// nextDraftTarget/STEP_RECIPE) so book-agent/threadSystem can recompute the guided-flow anchor from the LIVE
// tree each chain link instead of the author's stale message-time snapshot (docs/agent-improvement-plan.md
// P1.2). The web file's `dnaHealth` (and its dnaSchema dependency) is intentionally OMITTED — the server
// never scores health. Everything present here MUST stay behaviourally identical to the web copy; parity is
// LOCKED by apps/web/src/features/dna/lib/novelDna.parity.test.ts (currentObjective run over both copies).
import { byId, childrenOf, scenesInOrder, type DnaNode, type NodeKind, type SceneContent } from "./novel-dna.ts";

export type StageKey = "premise" | "foundations" | "structure" | "scenes" | "draft";

export interface DnaStage { key: StageKey; label: string; caption: string }

// The ladder, lowest resolution → highest. Foundations carries the entity branch; Structure the spine.
export const DNA_STAGES: DnaStage[] = [
  { key: "premise", label: "Idea", caption: "The idea, genre, and shape — the lowest-resolution contract every layer below is drawn from. Holds the seed (logline) and the premise (dramatic question)." },
  { key: "foundations", label: "Foundations", caption: "The bedrock — controlling idea, ending, cast, world, tentpoles. What you pin here, the AI must keep." },
  { key: "structure", label: "Structure", caption: "The acts and their causal beats — the spine, page by page." },
  { key: "scenes", label: "Scenes", caption: "The dramatized units — each turns a value, no flat 'and-then'." },
  { key: "draft", label: "Prose", caption: "Write each approved scene into prose, then read it back." },
];

export type StageStatus = "done" | "now" | "locked" | "available";

const accepted = (n?: DnaNode) => n?.authoring.status === "accepted";
const hasText = (s?: string | null) => !!(s && s.trim());
// A scene's Draft-rung "done": prose written.
const sceneDrafted = (s: DnaNode) => hasText((s.content as SceneContent).prose?.text);

/** Is each stage's load-bearing content present + accepted? (The gate for advancing.) */
export function stageComplete(nodes: DnaNode[]): Record<StageKey, boolean> {
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const seed = of("seed")[0], premise = of("premise")[0], pillar = of("pillar")[0];
  const scenes = of("scene");
  return {
    premise: !!premise && accepted(premise) && hasText((seed?.content as { logline?: string })?.logline),
    foundations: !!pillar && accepted(pillar) && of("character").length >= 1,
    structure: of("act").length >= 1 && of("beat").length >= 1,
    scenes: scenes.length >= 1,
    draft: scenes.length >= 1 && scenes.every((s) => sceneDrafted(s)),
  };
}

export interface JourneyStage extends DnaStage { num: number; status: StageStatus }

/** The journey: each stage's status, plus the index of the current ("now") stage. Sequential — a stage is
 *  locked until everything before it is complete, so the author walks the resolution ladder in order. */
export function buildJourney(nodes: DnaNode[]): { stages: JourneyStage[]; nowIndex: number } {
  const done = stageComplete(nodes);
  let firstIncomplete = DNA_STAGES.findIndex((s) => !done[s.key]);
  if (firstIncomplete === -1) firstIncomplete = DNA_STAGES.length; // all complete
  const stages = DNA_STAGES.map((s, i): JourneyStage => ({
    ...s, num: i + 1,
    status: done[s.key] ? "done" : i === firstIncomplete ? "now" : i < firstIncomplete ? "done" : "locked",
  }));
  return { stages, nowIndex: Math.min(firstIncomplete, DNA_STAGES.length - 1) };
}

// ── Sub-steps ──────────────────────────────────────────────────────────────────
// A stage is itself a short SERIAL chain (with optional branches): Seed→Premise, Pillar→Cast→…,
// Acts→Beats→… Each sub-step is gated by a prerequisite — so "Seed blocks Premise" and "Cast blocks
// Relationships" are derivable, not hand-asserted. `optional` marks a parallel BRANCH off the spine
// (world/set-pieces/threads/games) — present for richness, not required to advance the journey.
export interface SubStep {
  key: string;
  label: string;
  status: StageStatus; // done | now | locked | available
  count?: number; // collections show a tally
  total?: number; // when a fraction reads better (prose: 12/41)
  optional?: boolean; // a branch, not on the critical serial path
  manual?: boolean; // hand-authored (the seed)
}

// Resolve a serial list: walk in order; first not-done, prereq-met, REQUIRED step becomes "now";
// later met-but-not-done are "available"; an unmet prereq is "locked"; done is "done".
type SubSpec = { key: string; label: string; done: boolean; ready: boolean; count?: number; total?: number; optional?: boolean; manual?: boolean };
function resolveSeq(specs: SubSpec[]): SubStep[] {
  let nowTaken = false;
  return specs.map((s): SubStep => {
    let status: StageStatus;
    if (s.done) status = "done";
    else if (!s.ready) status = "locked";
    else if (!s.optional && !nowTaken) { status = "now"; nowTaken = true; }
    else status = "available";
    return { key: s.key, label: s.label, status, count: s.count, total: s.total, optional: s.optional, manual: s.manual };
  });
}

/** The serial sub-steps inside one stage, each with its derived status + tally. */
export function stageSubsteps(key: StageKey, nodes: DnaNode[]): SubStep[] {
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const seed = of("seed")[0], premise = of("premise")[0], pillar = of("pillar")[0];
  const n = (k: NodeKind) => of(k).length;

  if (key === "premise") {
    const seedDone = !!seed && hasText((seed.content as { logline?: string }).logline) && accepted(seed);
    return resolveSeq([
      { key: "seed", label: "Seed", done: seedDone, ready: true, manual: true },
      { key: "premise", label: "Premise", done: accepted(premise), ready: seedDone },
    ]);
  }
  if (key === "foundations") {
    const pillarDone = accepted(pillar), pillarReady = accepted(premise), cast = n("character");
    return resolveSeq([
      { key: "pillar", label: "Pillar", done: pillarDone, ready: pillarReady },
      { key: "cast", label: "Cast", done: cast >= 1, ready: pillarDone, count: cast },
      { key: "world", label: "World", done: n("world_fact") >= 1, ready: pillarDone, count: n("world_fact"), optional: true },
      // Games are a species of world rule (a contest grounded in world_facts) — a Foundations entity, not a
      // spine node. Offered here so the author CAN declare them before beats; still optional (beats don't
      // require them and aren't pre-filled from them).
      { key: "games", label: "Games", done: n("game") >= 1, ready: pillarDone, count: n("game"), optional: true },
      { key: "tentpole", label: "Tent-poles", done: n("tentpole") >= 1, ready: pillarDone, count: n("tentpole"), optional: true },
      { key: "relationship", label: "Relationships", done: n("relationship") >= 1, ready: cast >= 1, count: n("relationship"), optional: true },
    ]);
  }
  if (key === "structure") {
    const foundationsDone = accepted(pillar) && n("character") >= 1, acts = n("act");
    return resolveSeq([
      { key: "acts", label: "Acts", done: acts >= 1, ready: foundationsDone, count: acts },
      { key: "beats", label: "Beats", done: n("beat") >= 1, ready: acts >= 1, count: n("beat") },
      // Threads stay here: a thread's identity IS its beat anchors (setup→payoff), so it crystallizes during
      // structure work. Games moved up to Foundations (they're definable without beats).
      { key: "threads", label: "Threads", done: n("thread") >= 1, ready: acts >= 1, count: n("thread"), optional: true },
    ]);
  }
  if (key === "scenes") {
    const scenes = n("scene");
    return resolveSeq([{ key: "scenes", label: "Scenes", done: scenes >= 1, ready: n("beat") >= 1, count: scenes }]);
  }
  // draft — prose written
  const scenes = of("scene");
  const drafted = scenes.filter((s) => sceneDrafted(s)).length;
  return resolveSeq([{ key: "prose", label: "Scenes", done: scenes.length > 0 && drafted === scenes.length, ready: scenes.length > 0, count: drafted, total: scenes.length }]);
}

// ── The agent's current objective (the guided-flow anchor) ───────────────────────
// Derived from the journey: the ONE step to drive the author through next, plus its done-gate recipe.
// Injected into the agent's system prompt as an ANCHOR (not a fence) — the agent still sees the whole
// tree, but is pointed at this single rung and told how to run it, so the NEXT turn (objective recomputed
// from the tree) advances on its own once the gate is met. Pure. When the book is fully drafted it returns
// the render/publish HAND-OFF — which the agent SURFACES but cannot perform (docs/agent-capabilities.md
// limits #6/#7: applying ops writes book_nodes only; render→pages and publish are deliberate author gestures
// across the render seam). One recipe per serial sub-step key (see stageSubsteps).
const STEP_RECIPE: Record<string, string> = {
  seed: "Generate 2–4 logline options from the brief with propose_options on the seed node — a logline names the protagonist, their goal, the obstacle, and the stakes in one sentence. Recommend one and ask the author which direction fits and what to change.",
  premise: "If there's no premise node yet, first CREATE it (propose_node_ops add, kind = premise, parentId = the seed node) — then, once it exists, generate 2–4 premise options with propose_options on it, each elaborating the ACCEPTED logline (keep its protagonist/goal/obstacle/stakes fixed). The premise's core is its CENTRAL QUESTION — the question the whole book lives inside. It can be a PLOT question (\"will she escape the colony?\") OR a thematic one (\"can a single day hold a whole life?\"); pick whichever the brief's genre calls for — don't force a \"will the hero win\" frame onto a character/literary book. The shape is an OPTIONAL sketch, not required: if used, NAME the shape (e.g. \"man in a hole\", \"kishōtenketsu\", \"frame story\" — whatever the story actually is, not a forced three-act default), give it however many MOVEMENTS that shape needs, and set the ending's VALENCE (ending_feel) — the concrete ending itself belongs on the pillar.",
  pillar: "If there's no pillar node yet, first CREATE it (propose_node_ops add, kind = pillar, parentId = the premise node). Then set its controlling idea (the book's one-sentence thematic argument) and the ending it implies with propose_node_ops (edit). Talk it through, then propose.",
  cast: "Add the core cast with propose_node_ops (add character nodes under the pillar) — at minimum the protagonist and antagonist, each with want / need / wound / lie. Ask the author about anyone central you're unsure of. Relationships, world, games, and tentpoles are optional enrichment — offer them, don't block on them.",
  acts: "Generate the acts with ONE propose_node_ops replace_children op (parentId = the pillar, childKind = act) — each act with a goal and turning point. Revise with the author before moving to beats.",
  beats: "Generate the beats with the ENGINE, not by hand: call propose_expansion(nodeId = the pillar, target = 'beatsheet') — it builds the GLOBAL beat sheet across all acts in one causal pass (each beat's connector 'therefore'/'but' earned by what came before, setup→payoff scheduled book-wide). Revise with the author after it lands.",
  scenes: "Break the beat into scenes with the ENGINE, not by hand: call propose_expansion(nodeId = THIS beat, target = 'scenes') — the engine makes each scene inherit the beat's causal/thread/tentpole plan and turn a value (goal → outcome), never a flat 'and-then'. Do the next beat that still needs scenes; one call per beat.",
  prose: "Render prose ONE scene at a time, in reading order — the TARGET NODE named in the objective above IS that scene; pass exactly its id, don't pick a different one from the tree. BEFORE each render: read the scene's beat and the previous prosed page, and search_nodes for the specific threads/objects/facts this page must honor — then call propose_prose_render with a curated `brief` (focus + mustHonor + avoid) so the render gets what it can't compute. You don't write prose yourself; the author applies it and it streams in their browser. AFTER a scene has prose: check_against_contract to judge it against the brief — and if that read shows the PREVIOUS page drifted (a dropped thread, a contradiction), propose_node_ops to fix that page first, then continue. Investigate → fix the tail if needed → render next with a brief.",
};

/** The next undrafted scene, in reading order, plus its act/beat/scene coordinate — the concrete pointer
 *  the draft-stage objective names (see `currentObjective`). Undefined once every scene is drafted. Exists
 *  because the stage's aggregate tally ("14/80 written") doesn't say WHICH scene is next; without a named
 *  target the agent has to infer "next" from the tree digest, which once picked a later beat's scene
 *  instead of the actual next one in reading order. */
export function nextDraftTarget(nodes: DnaNode[]): { scene: DnaNode; orderIndex: number; total: number; actIndex?: number; beatIndex?: number; sceneIndex?: number } | undefined {
  const ordered = scenesInOrder(nodes);
  const orderIndex = ordered.findIndex((s) => !sceneDrafted(s));
  if (orderIndex === -1) return undefined;
  const scene = ordered[orderIndex];
  const index = byId(nodes);
  const beat = index.get(scene.parent_id ?? "");
  const act = beat ? index.get(beat.parent_id ?? "") : undefined;
  const actIndex = act ? childrenOf(nodes, act.parent_id ?? null).filter((n) => n.kind === "act").findIndex((n) => n.id === act.id) + 1 : undefined;
  const beatIndex = act && beat ? childrenOf(nodes, act.id).filter((n) => n.kind === "beat").findIndex((n) => n.id === beat.id) + 1 : undefined;
  const sceneIndex = beat ? childrenOf(nodes, beat.id).filter((n) => n.kind === "scene").findIndex((n) => n.id === scene.id) + 1 : undefined;
  return { scene, orderIndex: orderIndex + 1, total: ordered.length, actIndex, beatIndex, sceneIndex };
}

/** The agent's CURRENT objective — the one rung to drive the author through next, derived live from the
 *  tree. See STEP_RECIPE above. `bookSlug` (when known) puts the reader URL into the final hand-off. */
export function currentObjective(nodes: DnaNode[], opts: { bookSlug?: string } = {}): string {
  const { stages, nowIndex } = buildJourney(nodes);
  if (stages.every((s) => s.status === "done")) {
    const reader = opts.bookSlug ? ` (then read it at /books/${opts.bookSlug})` : "";
    return [
      "The book's DNA is fully drafted: every scene has prose.",
      `You CANNOT render or publish yourself — those are deliberate author gestures across the render seam. HAND OFF: tell the author the draft is complete and point them to the two remaining actions — (1) **Render**, which projects the DNA tree into readable pages${reader}; (2) **Publish**, which makes the book public. Then offer another revision pass if they want one.`,
    ].join("\n");
  }
  const stage = stages[nowIndex];
  const now = stageSubsteps(stage.key, nodes).find((s) => s.status === "now");
  const recipe = STEP_RECIPE[now?.key ?? stage.key] ?? "";
  const next = stages[nowIndex + 1];
  // The draft stage names its specific next scene (see nextDraftTarget); every other stage keeps the plain
  // done/total tally since there's no single "next node" to point at (e.g. "generate the acts").
  const target = now?.key === "prose" ? nextDraftTarget(nodes) : undefined;
  const where = target?.actIndex != null ? ` (Act ${target.actIndex} · Beat ${target.beatIndex} · Scene ${target.sceneIndex})` : "";
  const tally = target
    ? ` — Scene ${target.orderIndex} of ${target.total}${where}`
    : now?.total != null ? ` (${now.count ?? 0}/${now.total})` : now?.count != null ? ` (${now.count} so far)` : "";
  const goal = target ? (target.scene.content as SceneContent).goal?.trim() : undefined;
  return [
    "Drive the author through ONE step at a time; don't work ahead unless they ask.",
    `▸ Step ${stage.num}/${stages.length} · ${stage.label}${now ? ` — ${now.label}` : ""}${tally}`,
    target ? `TARGET NODE: [${target.scene.id}]${goal ? ` — "${goal.slice(0, 90)}"` : ""}` : "",
    recipe ? `HOW TO RUN THIS STEP: ${recipe}` : "",
    `Once that's in the tree and accepted, the objective advances on its own${next ? ` (next: ${next.label})` : ""} — so move on rather than over-polishing.`,
  ].filter(Boolean).join("\n");
}

// ── Stage progress (coverage) ───────────────────────────────────────────────────
// Not "present vs absent" but HOW MUCH of each layer is filled — the "what's left" signal. The spine is a
// coverage chain: every act should grow beats, every beat scenes, every scene prose. A stage is `partial`
// when it's started but the layer below isn't fully grown ("beats partly generated", "scenes not all
// written"). `gapLabel` is the plain-English remainder for the what's-left line. Pure, derived live.
export interface StageProgress { done: number; total: number; ratio: number; label: string; partial: boolean; gapLabel?: string }

export function stageProgress(nodes: DnaNode[]): Record<StageKey, StageProgress> {
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const hasChild = (pid: string, kind: NodeKind) => nodes.some((n) => n.parent_id === pid && n.kind === kind);
  const seed = of("seed")[0], premise = of("premise")[0], pillar = of("pillar")[0];
  const cast = of("character").length;
  const acts = of("act"), beats = of("beat"), scenes = of("scene");
  const seedDone = !!seed && hasText((seed.content as { logline?: string }).logline) && accepted(seed);
  const actsWithBeats = acts.filter((a) => hasChild(a.id, "beat")).length;
  const beatsWithScenes = beats.filter((b) => hasChild(b.id, "scene")).length;
  const drafted = scenes.filter((s) => sceneDrafted(s)).length;
  const mk = (done: number, total: number, label: string, gapLabel?: string): StageProgress => ({
    done, total, ratio: total ? done / total : 0, label, partial: done > 0 && done < total,
    gapLabel: done < total ? gapLabel : undefined,
  });
  return {
    premise: mk((seedDone ? 1 : 0) + (accepted(premise) ? 1 : 0), 2, accepted(premise) ? "premise set" : seedDone ? "seed set" : "empty"),
    foundations: mk((accepted(pillar) ? 1 : 0) + (cast >= 1 ? 1 : 0), 2, cast ? `${cast} cast` : "no cast", accepted(pillar) ? "add cast" : "set pillar"),
    structure: mk(actsWithBeats, acts.length, acts.length ? `${actsWithBeats}/${acts.length} acts → beats` : "no acts",
      acts.length ? `${acts.length - actsWithBeats} acts need beats` : "generate acts"),
    scenes: mk(beatsWithScenes, beats.length, beats.length ? `${beatsWithScenes}/${beats.length} beats → scenes` : "no beats",
      beats.length ? `${beats.length - beatsWithScenes} beats need scenes` : "generate beats"),
    draft: mk(drafted, scenes.length, scenes.length ? `${drafted}/${scenes.length} written` : "no scenes",
      scenes.length ? `${scenes.length - drafted} scenes need prose` : "generate scenes"),
  };
}

/** Which node kinds belong to a stage's Stage view. */
export const STAGE_KINDS: Record<StageKey, NodeKind[]> = {
  premise: ["seed", "premise"],
  foundations: ["pillar", "character", "relationship", "tentpole", "world_fact", "game"],
  structure: ["act", "beat"],
  scenes: ["scene"],
  draft: ["scene"],
};

// NOTE: the web copy continues with `dnaHealth` (completeness/strength scoring) here; it depends on dnaSchema
// and is deliberately NOT ported (the server never scores health). See the header. If you add server-side
// health, port dnaSchema's contentCompleteness/requiredKeys first and mirror the web function verbatim.
