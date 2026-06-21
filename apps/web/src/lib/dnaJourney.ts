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
const hasText = (s?: string) => !!(s && s.trim());

/** Is each stage's load-bearing content present + accepted? (The gate for advancing.) */
export function stageComplete(nodes: DnaNode[]): Record<StageKey, boolean> {
  const of = (k: NodeKind) => nodes.filter((n) => n.kind === k);
  const seed = of("seed")[0], premise = of("premise")[0], pillar = of("pillar")[0];
  const scenes = of("scene");
  return {
    premise: !!premise && accepted(premise) && hasText((seed?.content as { logline?: string })?.logline),
    foundations: !!pillar && accepted(pillar) && of("character").length >= 1,
    structure: of("movement").length >= 1 && of("beat").length >= 1,
    scenes: scenes.length >= 1,
    draft: scenes.length >= 1 && scenes.every((s) => hasText((s.content as SceneContent).prose?.text)),
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

/** Which node kinds belong to a stage's Stage view. */
export const STAGE_KINDS: Record<StageKey, NodeKind[]> = {
  premise: ["seed", "premise"],
  foundations: ["pillar", "character", "relationship", "tentpole", "world_fact"],
  structure: ["movement", "beat"],
  scenes: ["scene"],
  draft: ["scene"],
};
