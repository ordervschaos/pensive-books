// dnaJourney — the guided JOURNEY over the Novel DNA tree: ordered stages of increasing resolution the
// author advances through, finishing one before the next unlocks. This is the mental model the old build
// studio got right (Brief→Foundations→Spine→…); here it's the DNA rungs grouped into stages. Pure: derives
// each stage's status from the tree so the Navigator only renders. See docs/novel-dna-spec.md.
import { renderBlockers, validate, type BookSettings, type DnaIssue, type DnaNode, type NodeKind, type SceneContent } from "@/lib/novelDna";
import { contentCompleteness, requiredKeys } from "@/lib/dnaSchema";

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
      // Games are a species of world rule (a contest grounded in world_facts) — a Foundations entity, not a
      // spine node. Offered here so the author CAN declare them before beats; still optional (beats don't
      // require them and aren't pre-filled from them).
      { key: "games", label: "Games", done: n("game") >= 1, ready: pillarDone, count: n("game"), optional: true },
      { key: "tentpole", label: "Tent-poles", done: n("tentpole") >= 1, ready: pillarDone, count: n("tentpole"), optional: true },
      { key: "relationship", label: "Relationships", done: n("relationship") >= 1, ready: cast >= 1, count: n("relationship"), optional: true },
    ]);
  }
  if (key === "structure") {
    const foundationsDone = accepted(pillar) && n("character") >= 1, acts = n("movement");
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
  // draft — prose written (prose mode) or scenes illustrated (picture mode)
  const scenes = of("scene");
  const drafted = scenes.filter((s) => sceneDrafted(s, mode)).length;
  return resolveSeq([{ key: mode === "picture" ? "illustrate" : "prose", label: mode === "picture" ? "Illustrate" : "Scenes", done: scenes.length > 0 && drafted === scenes.length, ready: scenes.length > 0, count: drafted, total: scenes.length }]);
}

// ── Stage progress (coverage) ───────────────────────────────────────────────────
// Not "present vs absent" but HOW MUCH of each layer is filled — the "what's left" signal. The spine is a
// coverage chain: every act should grow beats, every beat scenes, every scene prose. A stage is `partial`
// when it's started but the layer below isn't fully grown ("beats partly generated", "scenes not all
// written"). `gapLabel` is the plain-English remainder for the what's-left line. Pure, derived live.
export interface StageProgress { done: number; total: number; ratio: number; label: string; partial: boolean; gapLabel?: string }

export function stageProgress(nodes: DnaNode[], mode: "prose" | "picture" = "prose"): Record<StageKey, StageProgress> {
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const hasChild = (pid: string, kind: NodeKind) => nodes.some((n) => n.parent_id === pid && n.kind === kind);
  const seed = of("seed")[0], premise = of("premise")[0], pillar = of("pillar")[0];
  const cast = of("character").length;
  const acts = of("movement"), beats = of("beat"), scenes = of("scene");
  const seedDone = !!seed && hasText((seed.content as { logline?: string }).logline) && accepted(seed);
  const actsWithBeats = acts.filter((a) => hasChild(a.id, "beat")).length;
  const beatsWithScenes = beats.filter((b) => hasChild(b.id, "scene")).length;
  const drafted = scenes.filter((s) => sceneDrafted(s, mode)).length;
  const word = mode === "picture" ? "illustrated" : "written";
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
    draft: mk(drafted, scenes.length, scenes.length ? `${drafted}/${scenes.length} ${word}` : "no scenes",
      scenes.length ? `${scenes.length - drafted} scenes need prose` : "generate scenes"),
  };
}

/** Which node kinds belong to a stage's Stage view. */
export const STAGE_KINDS: Record<StageKey, NodeKind[]> = {
  premise: ["seed", "premise"],
  foundations: ["pillar", "character", "relationship", "tentpole", "world_fact", "game"],
  structure: ["movement", "beat"],
  scenes: ["scene"],
  draft: ["scene"],
};

// ── DNA health: two numbers + the lint tally ────────────────────────────────────
// The answer to "how complete and how strong is the DNA". COMPLETENESS blends journey progress (how far down
// the resolution ladder) with content fill (are the present nodes' required fields actually filled) — so it
// moves smoothly as you author, not in 5 coarse jumps. STRENGTH is soundness: 1 minus a lint penalty
// (errors weigh more than warns), normalized per-node with a floor so a tiny tree isn't whipsawed by one
// lint. Both are pure, derived live from the tree — nothing stored.
export interface DnaHealth {
  completeness: number;   // 0..1 — how much of the target structure exists AND is filled
  strength: number;       // 0..1 — how sound (free of lints)
  stagesDone: number;     // of DNA_STAGES.length
  contentFill: number;    // 0..1 — required fields filled across present nodes
  errors: number; warns: number;
  issues: DnaIssue[];     // the lints behind `strength`, for a drill-down
  blockers: string[];     // what still blocks a gold render
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function dnaHealth(nodes: DnaNode[], settings: BookSettings = {}, mode: "prose" | "picture" = "prose"): DnaHealth {
  const stages = stageComplete(nodes, mode);
  const stagesDone = DNA_STAGES.filter((s) => stages[s.key]).length;
  // Content fill: average required-field completeness over every node that HAS required fields (placeholders
  // with empty required fields drag it down — exactly the "character with no name" signal).
  const scored = nodes.filter((n) => requiredKeys(n.kind).length > 0);
  const contentFill = scored.length ? scored.reduce((sum, n) => sum + contentCompleteness(n), 0) / scored.length : 0;
  const completeness = clamp01(0.5 * (stagesDone / DNA_STAGES.length) + 0.5 * contentFill);

  const issues = validate(nodes);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warns = issues.filter((i) => i.severity === "warn").length;
  const penalty = (errors + 0.4 * warns) / Math.max(8, nodes.length);
  const strength = clamp01(1 - penalty);

  return { completeness, strength, stagesDone, contentFill, errors, warns, issues, blockers: renderBlockers(nodes, settings) };
}
