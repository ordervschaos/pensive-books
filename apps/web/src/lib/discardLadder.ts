// discardLadder — wipe one rung of the resolution ladder (objective → beat → prose) across a book's
// text pages, so the matching Build Studio step can re-generate from scratch. The two discards are
// independent and each lives on its own step:
//   • discardBeats — the BEAT rung (BeatsStep). Drops the beat + its planned deltas; objective survives.
//   • discardProse — the PROSE rung (DraftStep). Resets the page body to a title-only doc + drops the
//                    prose-derived metadata; the beat survives so the re-draft renders from it again.
// Each only touches its own rung — discarding beats leaves any written prose in place (it simply reads
// as stale against the missing beat, the same drift the studio already surfaces).
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
 * Discard the BEAT rung. Clears the beat and its planned deltas (plus the now-meaningless
 * objective_beat / beat_prose sync snapshots and delta_sync), keeping the objective. Reverts the
 * "beats" approval so the Beats step is active again. `pageIds` = the pages that carry a beat.
 */
export async function discardBeats(bookId: number, pageIds: number[]): Promise<void> {
  await patchPages(bookId, pageIds, ({ metadata }) => {
    const meta: PageMeta = { ...(metadata ?? {}) };
    delete meta.beat;
    delete meta.planned_delta;
    delete meta.delta_sync;
    if (meta.sync) {
      const sync = { ...meta.sync };
      delete sync.objective_beat;
      delete sync.beat_prose;
      meta.sync = sync;
    }
    return { metadata: meta };
  });
  await revertJourney(bookId, "beats");
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
