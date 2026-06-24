// dnaJourney — the guided JOURNEY over the Novel DNA tree: ordered stages of increasing resolution the
// author advances through, finishing one before the next unlocks. This is the mental model the old build
// studio got right (Brief→Foundations→Spine→…); here it's the DNA rungs grouped into stages. Pure: derives
// each stage's status from the tree so the Navigator only renders. See docs/novel-dna-spec.md.
import type { DnaNode, NodeKind, SceneContent } from "@/lib/novelDna";

export type StageKey = "premise" | "foundations" | "structure" | "scenes" | "draft";

export interface DnaStage { key: StageKey; label: string; caption: string }

// The ladder, lowest resolution → highest. Foundations carries the entity branch; Structure the spine.
export const DNA_STAGES: DnaStage[] = [
  { key: "premise", label: "Premise", caption: "The idea, genre, and shape — the lowest-resolution contract every step below is drawn from." },
  { key: "foundations", label: "Foundations", caption: "The bedrock — controlling idea, ending, cast, world, tentpoles. What you pin here, the AI must keep." },
  { key: "structure", label: "Structure", caption: "The acts and their causal beats — the spine, page by page." },
  { key: "scenes", label: "Scenes", caption: "The dramatized units — each turns a value, no flat 'and-then'." },
  { key: "draft", label: "Draft", caption: "Render the prose from the approved scenes, then read it back." },
];

export type StageStatus = "done" | "now" | "locked" | "available";

const accepted = (n?: DnaNode) => n?.authoring.status === "accepted";
const hasText = (s?: string | null) => !!(s && s.trim());
// A scene's Draft-rung "done": prose written (prose mode) or an illustration pinned (picture mode).
const sceneDrafted = (s: DnaNode, mode: "prose" | "picture") =>
  mode === "picture" ? hasText((s.content as SceneContent).image_url) : hasText((s.content as SceneContent).prose?.text);

/** Is each stage's load-bearing content present + accepted? (The gate for advancing.) */
export function stageComplete(nodes: DnaNode[], mode: "prose" | "picture" = "prose"): Record<StageKey, boolean> {
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const seed = of("seed")[0], premise = of("premise")[0], pillar = of("pillar")[0];
  const scenes = of("scene");
  return {
    premise: !!premise && accepted(premise) && hasText((seed?.content as { logline?: string })?.logline),
    foundations: !!pillar && accepted(pillar) && of("character").length >= 1,
    structure: of("movement").length >= 1 && of("beat").length >= 1,
    scenes: scenes.length >= 1,
    draft: scenes.length >= 1 && scenes.every((s) => sceneDrafted(s, mode)),
  };
}

export interface JourneyStage extends DnaStage { num: number; status: StageStatus }

/** The journey: each stage's status, plus the index of the current ("now") stage. Sequential — a stage is
 *  locked until everything before it is complete, so the author walks the resolution ladder in order. */
export function buildJourney(nodes: DnaNode[], mode: "prose" | "picture" = "prose"): { stages: JourneyStage[]; nowIndex: number } {
  const done = stageComplete(nodes, mode);
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
export function stageSubsteps(key: StageKey, nodes: DnaNode[], mode: "prose" | "picture" = "prose"): SubStep[] {
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
      { key: "tentpole", label: "Set-pieces", done: n("tentpole") >= 1, ready: pillarDone, count: n("tentpole"), optional: true },
      { key: "relationship", label: "Relationships", done: n("relationship") >= 1, ready: cast >= 1, count: n("relationship"), optional: true },
    ]);
  }
  if (key === "structure") {
    const foundationsDone = accepted(pillar) && n("character") >= 1, acts = n("movement");
    return resolveSeq([
      { key: "acts", label: "Acts", done: acts >= 1, ready: foundationsDone, count: acts },
      { key: "beats", label: "Beats", done: n("beat") >= 1, ready: acts >= 1, count: n("beat") },
      { key: "threads", label: "Threads", done: n("thread") >= 1, ready: acts >= 1, count: n("thread"), optional: true },
      { key: "games", label: "Games", done: n("game") >= 1, ready: acts >= 1, count: n("game"), optional: true },
    ]);
  }
  if (key === "scenes") {
    const scenes = n("scene");
    return resolveSeq([{ key: "scenes", label: "Scenes", done: scenes >= 1, ready: n("beat") >= 1, count: scenes }]);
  }
  // draft — prose written (prose mode) or scenes illustrated (picture mode)
  const scenes = of("scene");
  const drafted = scenes.filter((s) => sceneDrafted(s, mode)).length;
  return resolveSeq([{ key: mode === "picture" ? "illustrate" : "prose", label: mode === "picture" ? "Illustrate" : "Prose", done: scenes.length > 0 && drafted === scenes.length, ready: scenes.length > 0, count: drafted, total: scenes.length }]);
}

/** Which node kinds belong to a stage's Stage view. */
export const STAGE_KINDS: Record<StageKey, NodeKind[]> = {
  premise: ["seed", "premise"],
  foundations: ["pillar", "character", "relationship", "tentpole", "world_fact"],
  structure: ["movement", "beat"],
  scenes: ["scene"],
  draft: ["scene"],
};
