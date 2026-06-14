// beatSheet — the client for the beat-sheet reviser + its apply.
//
//   reviseBeats(instruction/lens) → a reviewable RevisionPlan (bridge in dev, edge in prod)
//   applyBeatPlan(plan)           → opens a book_revisions row (source:'beats', plan_only) and kicks
//                                   build-revision, which writes the new beats/objectives/structure
//                                   and writes NO prose (downstream prose just goes stale).
//
// See docs/beat-sheet-revision.md. The plan shape mirrors revise-outline's, plus a `beat` per page.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";

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

export type LensId =
  | "save-the-cat" | "story-circle" | "heros-journey" | "fichtean-curve" | "romancing-the-beat";

// The lenses offered in the UI — id + label + the one-liner from the knowledge base.
export const LENSES: { id: LensId; name: string; bestFor: string }[] = [
  { id: "save-the-cat", name: "Save the Cat!", bestFor: "Commercial fiction; tight, measurable pacing." },
  { id: "story-circle", name: "Story Circle", bestFor: "Character-driven, episodic; a lighter monomyth." },
  { id: "heros-journey", name: "Hero's Journey", bestFor: "Fantasy, sci-fi, epics; one transformative protagonist." },
  { id: "fichtean-curve", name: "Fichtean Curve", bestFor: "Thrillers, mystery, suspense; relentless momentum." },
  { id: "romancing-the-beat", name: "Romancing the Beat", bestFor: "Romance, or any relationship-centered story." },
];

/** Ask the beat-sheet doctor for a revision plan. Throws on error. Mutates nothing. */
export async function reviseBeats(opts: { bookId: number; instruction?: string; lens?: LensId | null }): Promise<RevisionPlan> {
  const body = { bookId: opts.bookId, instruction: opts.instruction?.trim() || undefined, lens: opts.lens || undefined };
  if (BRIDGE) {
    const r = await bridgeFetch("/revise-beats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d as RevisionPlan;
  }
  const { data, error } = await supabase.functions.invoke("revise-beats", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as RevisionPlan;
}

/**
 * Apply an approved beat plan: open a book_revisions row (already 'building', plan attached, plan_only)
 * and kick build-revision. Pure DB work server-side (no prose) — free even via the edge fn in dev.
 * Returns the revision id so the caller can watch its status row over Realtime.
 */
export async function applyBeatPlan(bookId: number, plan: RevisionPlan): Promise<number> {
  const { data, error } = await supabase
    .from("book_revisions")
    .insert({ book_id: bookId, status: "building", source: "beats", plan: { ...plan, planOnly: true }, plan_only: true })
    .select("id")
    .single();
  if (error) throw error;
  const revisionId = (data as { id: number }).id;
  const { error: kickErr } = await supabase.functions.invoke("build-revision", { body: { revisionId } });
  if (kickErr) throw kickErr;
  return revisionId;
}
