// discardLadder — wipe the lower rungs of the resolution ladder (objective → beat → prose) across a
// book's text pages, so the matching Build Studio step can re-generate from scratch. Two discards,
// each on its own step, cutting the ladder at a different depth (you can't keep prose whose beat is
// gone, so there is no "beats only" — discarding beats cascades down to the prose):
//   • discardBeatsAndProse — BEATS step. Resets all the way to objectives-only: drops beat + prose +
//                            everything they produced. The objective (the Outline's contract) survives.
//   • discardProse — DRAFT step. Resets only the PROSE rung: title-only body + prose-derived metadata
//                    gone; the beat survives so the re-draft renders from it again.
import { supabase } from "@/integrations/supabase/client";
import { buildDoc } from "@/lib/inlineMarkdown";
import type { PageMeta } from "@/lib/planProvenance";

// Read each page's title + metadata fresh, hand the row to `mutate` (which returns the content +
// metadata patch, or null to skip), and apply the patches concurrently. Rejects on the first failed
// write so the caller can surface one error.
async function patchPages(
  bookId: number,
  pageIds: number[],
  mutate: (row: { title: string | null; metadata: PageMeta | null }) => { content?: unknown; metadata: PageMeta } | null,
): Promise<void> {
  if (pageIds.length === 0) return;
  const { data, error } = await supabase
    .from("pages")
    .select("id, title, metadata")
    .eq("book_id", bookId)
    .in("id", pageIds);
  if (error) throw error;
  const rows = (data as Array<{ id: number; title: string | null; metadata: PageMeta | null }>) ?? [];

  await Promise.all(
    rows.map((p) => {
      const patch = mutate(p);
      if (!patch) return Promise.resolve();
      return supabase
        .from("pages")
        .update(patch)
        .eq("id", p.id)
        .then(({ error: upErr }) => {
          if (upErr) throw new Error(upErr.message);
        });
    }),
  );
}

// Revert the build-ledger sign-off for a step whose artifacts we just wiped, so the Navigator shows it
// as active again instead of a stale green "approved" dot. Best-effort — a miss is only cosmetic.
async function revertJourney(bookId: number, ...steps: string[]): Promise<void> {
  const { data } = await supabase.from("books").select("journey").eq("id", bookId).maybeSingle();
  const journey = { ...((data?.journey as Record<string, unknown> | null) ?? {}) };
  for (const s of steps) delete journey[s];
  await supabase.from("books").update({ journey }).eq("id", bookId);
}

/**
 * Discard BEATS + PROSE — reset every given page all the way back to objectives-only. Resets the body
 * to a title-only doc and strips every metadata field below the objective (beat, both deltas,
 * delta_sync, the running summary, the character ledger, all sync snapshots, the legacy prose hash,
 * lint flags) — keeping only the objective. Reverts both the "beats" and "draft" approvals so the
 * Beats step is active again. `pageIds` = the pages that carry a beat and/or prose.
 */
export async function discardBeatsAndProse(bookId: number, pageIds: number[]): Promise<void> {
  await patchPages(bookId, pageIds, ({ title, metadata }) => {
    const meta: PageMeta = { ...(metadata ?? {}) };
    delete meta.beat;
    delete meta.planned_delta;
    delete meta.extracted_delta;
    delete meta.delta_sync;
    delete meta.summary;
    delete meta.character_states;
    delete meta.prose_src_hash;
    delete meta.lint_flags;
    delete meta.sync; // drops objective_beat + beat_prose together
    return { content: buildDoc(title, ""), metadata: meta };
  });
  await revertJourney(bookId, "beats", "draft");
}

/**
 * Discard the PROSE rung. Resets the page body to a title-only doc and drops everything the draft
 * stage produced — the running summary, the character ledger, the extracted deltas, and the
 * beat_prose provenance — while keeping the beat + planned deltas so the re-draft renders from them.
 * Reverts the "draft" approval. `pageIds` = the pages that carry prose.
 */
export async function discardProse(bookId: number, pageIds: number[]): Promise<void> {
  await patchPages(bookId, pageIds, ({ title, metadata }) => {
    const meta: PageMeta = { ...(metadata ?? {}) };
    delete meta.summary;
    delete meta.character_states;
    delete meta.extracted_delta;
    delete meta.delta_sync;
    delete meta.prose_src_hash;
    delete meta.lint_flags;
    if (meta.sync) {
      const sync = { ...meta.sync };
      delete sync.beat_prose;
      meta.sync = sync;
    }
    return { content: buildDoc(title, ""), metadata: meta };
  });
  await revertJourney(bookId, "draft");
}
