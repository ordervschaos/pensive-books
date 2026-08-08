// stageLadder — the VIEW MODEL behind the tree tab's linear stage stack.
//
// The DNA data structure is a tree (book_nodes: seed → premise → pillar → {entities, acts → beats →
// scenes}). But the top of that tree is a chain of SINGLETONS — exactly one seed, one premise, one pillar —
// so rendering it as nesting spent three indent levels to express "these happen in order" and buried the
// order inside the indentation. This module re-cuts the SAME tree into five ordered stages the author walks
// top-to-bottom. Nothing moves in the database; only the projection changes.
//
// Pure + derived live, in the house style: every status here is computed from the existing journey
// primitives (stageComplete / stageSubsteps / stageProgress in lib/dnaJourney) rather than asserted, so the
// ladder can never disagree with the journey, the agent's objective, or the lints.
import { briefIdea, type Brief } from "@/lib/brief";
import { stageComplete, stageProgress, stageSubsteps, type StageKey } from "@/features/dna/lib/dnaJourney";
import type { DnaNode, NodeKind, PillarContent, PremiseContent, SeedContent } from "@/features/dna/lib/novelDna";

export type LadderKey = "brief" | "seed" | "premise" | "pillar" | "story";
export type LadderStatus = "done" | "now" | "ahead";

export interface LadderStage {
  key: LadderKey;
  num: number;          // 1..5 — the visible step number
  label: string;
  caption: string;      // what this rung IS, in one line
  status: LadderStatus; // done | now (the single active rung) | ahead (not reached yet)
  summary: string;      // the collapsed one-liner — what's in this rung right now
  jump: StageKey;       // the journey stage this rung belongs to (for goStage / KIND_STAGE reuse)
}

const LADDER: { key: LadderKey; label: string; caption: string; jump: StageKey }[] = [
  { key: "brief", label: "brief & vision", caption: "the constant origin — what you're writing and why", jump: "premise" },
  { key: "seed", label: "seed", caption: "the logline — protagonist · inciting · goal · obstacle · stakes", jump: "premise" },
  { key: "premise", label: "premise & shape", caption: "the dramatic question and the arc that answers it", jump: "premise" },
  { key: "pillar", label: "pillar", caption: "controlling idea · ending · the cast and world it needs", jump: "foundations" },
  { key: "story", label: "story", caption: "acts → beats → scenes → prose", jump: "structure" },
];

const count = (nodes: DnaNode[], kind: NodeKind) => nodes.filter((n) => n.kind === kind).length;

/** The five ordered rungs, each with its status and a one-line summary of what's in it. */
export function buildLadder(nodes: DnaNode[], brief: Brief | null): LadderStage[] {
  const idea = stageSubsteps("premise", nodes, brief);   // interview | seed | premise
  const complete = stageComplete(nodes);
  const prog = stageProgress(nodes);
  const sub = (key: string) => idea.find((s) => s.key === key);

  const seed = nodes.find((n) => n.kind === "seed");
  const premise = nodes.find((n) => n.kind === "premise");
  const pillar = nodes.find((n) => n.kind === "pillar");

  // Done-flags, in ladder order. The brief's own gate is the interview's (compiled or skipped) AND an idea
  // actually written — a grandfathered book whose interview never ran shouldn't read "done" while empty.
  const done: Record<LadderKey, boolean> = {
    brief: sub("interview")?.status === "done" && !!briefIdea(brief)?.trim(),
    seed: sub("seed")?.status === "done",
    premise: sub("premise")?.status === "done",
    pillar: complete.foundations,
    story: complete.draft,
  };

  // One "now" — the first rung that isn't done. Everything after it is "ahead" (visible and editable, just
  // not the current work). Deliberately NOT "locked": the tree is start-anywhere (dnaSkeleton mints every
  // slot up front), so a rung you haven't reached is dimmed, never disabled.
  const nowIndex = LADDER.findIndex((s) => !done[s.key]);

  const shape = (premise?.content as PremiseContent | undefined)?.shape;
  const movements = Array.isArray(shape?.movements) ? shape.movements.length : 0;
  const cast = count(nodes, "character");
  const entities = nodes.filter((n) => ["relationship", "thread", "game", "world_fact", "location", "tentpole", "voice_profile"].includes(n.kind)).length;
  const acts = count(nodes, "act"), beats = count(nodes, "beat"), scenes = count(nodes, "scene");

  const summaries: Record<LadderKey, string> = {
    brief: briefSummaryLine(brief),
    seed: (seed?.content as SeedContent | undefined)?.logline?.trim() ? "logline set" : "no logline yet",
    premise: [
      (premise?.content as PremiseContent | undefined)?.dramatic_question?.trim() ? "question set" : "no question yet",
      shape?.name ? `shape: ${shape.name}` : "",
      movements ? `${movements} movements` : "",
    ].filter(Boolean).join(" · "),
    pillar: [
      (pillar?.content as PillarContent | undefined)?.controlling_idea?.trim() ? "idea set" : "no controlling idea",
      `${cast} cast`,
      entities ? `${entities} in registry` : "",
    ].filter(Boolean).join(" · "),
    story: acts ? `${acts} acts · ${beats} beats · ${scenes} scenes · ${prog.draft.label}` : "no acts yet",
  };

  return LADDER.map((s, i): LadderStage => ({
    ...s, num: i + 1,
    status: done[s.key] ? "done" : i === nowIndex ? "now" : "ahead",
    summary: summaries[s.key],
  }));
}

/** The brief's collapsed one-liner. Mirrors what the old inline BriefOrigin header showed. */
function briefSummaryLine(brief: Brief | null): string {
  const idea = briefIdea(brief)?.trim();
  const short = idea ? (idea.length > 60 ? `${idea.slice(0, 60)}…` : idea) : "";
  const tone = Array.isArray(brief?.tone) ? brief.tone.join(", ") : "";
  const words = brief?.scope?.word_target ? `${brief.scope.word_target.toLocaleString()} words` : "";
  const vision = brief?.vision?.compiled_at ? "vision ✓" : brief?.vision?.skipped ? "vision skipped" : "";
  return [brief?.genre, tone, words, short ? `"${short}"` : "", vision].filter(Boolean).join(" · ") || "empty";
}
