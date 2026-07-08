// beatSheet — the RevisionPlan shape, still used as the outline-apply payload type
// (see applyOutlinePlan in @/lib/outline.ts). The reviser + applier that used to live here
// (reviseBeats/applyBeatPlan, and the pre-DNA build-revision/revise-beats edge fns they called)
// were pre-pivot Build Studio code, pruned 2026-07-09 (dead: 0 call sites once the edge fns
// backing them were deleted). See docs/beat-sheet-revision.md for that history.

export interface PlanPage {
  ref: number | null; // existing page id, or null for an added page
  op: "keep" | "retarget" | "add";
  pageType: "section" | "text";
  title: string;
  objective: string;
  beat?: string;
  why?: string;
}
export interface RevisionPlan {
  summary: string;
  pages: PlanPage[];
  deletes: { ref: number; why?: string }[];
  planOnly?: boolean;
}
