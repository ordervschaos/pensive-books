// BeatsStep — beats for every objective-bearing page.
//
// Chat-first redesign: the center is a near-manual editor (BeatSheet accordion).
// Generation lives in the right-rail ReviseChat (layer="beats") — "Plan all the beats" chip there.
// The center keeps the BULK build pipeline as a distinct whole-draft gesture (not per-beat propose):
//   "Generate all beats at once" → bulk server-side plan → continue to prose.
// When no beats exist and no bulk run is active, the center shows the Hero + a calm chat pointer
// + the BeatSheet (objectives editable, beat fields empty and typeable).
import { useEffect, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { invokeGenerateBook } from "@/lib/generateBook";
import { discardBeatsAndProse } from "@/lib/discardLadder";
import { RunControls } from "../../RunControls";
import { BeatSheet } from "../BeatSheet";
import type { StudioModel } from "../studioModel";
import { DoneStrip, Hero, RunningCard, RunningInline } from "../studioUi";

interface BuildProgress { done: number; total: number; phase?: string; stage?: string }
interface BuildRow extends TaskRow { progress: BuildProgress | null; error: string | null }

export function BeatsStep({ bookId, model, onChanged, onSelectPage }: { bookId: number; model: StudioModel; onChanged: () => void; onSelectPage?: (pageId: number) => void }) {
  const { toast } = useToast();
  const beatPages = model.textPages.filter((p) => p.objectiveText.trim());
  const doneCount = beatPages.filter((p) => p.beat !== "gap").length;
  const gapCount = beatPages.filter((p) => p.beat === "gap").length;
  const total = beatPages.length;

  const [discarding, setDiscarding] = useState(false);

  // ── Bulk beat/prose run ──────────────────────────────────────────────────────
  const { row: buildRow, refetch: buildRefetch, stale: buildStale } = useLatestTaskRow<BuildRow>({
    table: "book_generations", bookId, match: { kind: "write_all" },
    activeStatuses: ["pending", "running"], staleMs: 180_000,
  });
  const buildProgress = buildRow?.progress ?? null;
  const buildActive = buildRow?.status === "pending" || buildRow?.status === "running";
  const beatsRunning = buildActive && buildProgress?.stage !== "prose";
  const proseRunning = buildActive && buildProgress?.stage === "prose";
  const buildPaused = buildRow?.status === "ready" && buildRow.progress?.phase === "beats_done";

  const watchedBuildRef = useRef<number | null>(null);
  useEffect(() => {
    if (buildActive && buildRow) watchedBuildRef.current = buildRow.id;
    if (!buildRow || watchedBuildRef.current !== buildRow.id) return;
    if (buildRow.status === "ready" || buildRow.status === "done") onChanged();
  }, [buildRow?.id, buildRow?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const runBulkBeats = async () => {
    if (buildActive) return;
    try {
      const { data, error } = await invokeGenerateBook({ bookId, pauseAfterBeats: true });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      buildRefetch();
    } catch (e) {
      toast({ title: "Couldn't start beat generation", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  const runBulkProse = async () => {
    if (!buildPaused || !buildRow) return;
    try {
      const { data, error } = await invokeGenerateBook({ generationId: buildRow.id, resume: true });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      buildRefetch();
    } catch (e) {
      toast({ title: "Couldn't start prose writing", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };
  // ────────────────────────────────────────────────────────────────────────────

  // Discard beats AND prose back to objectives-only so the flow can re-plan from scratch.
  // Cascades to prose: a beat can't be discarded while prose written from it survives.
  const discardIds = beatPages.filter((p) => p.beat !== "gap" || p.prose !== "gap").map((p) => p.id);
  const discardAllBeats = async () => {
    if (buildActive || discarding || discardIds.length === 0) return;
    if (!window.confirm(
      `Discard the beats and prose on ${discardIds.length} page${discardIds.length === 1 ? "" : "s"}? ` +
      `The objectives stay — you'll re-plan beats and re-draft from them. This can't be undone.`,
    )) return;
    setDiscarding(true);
    try {
      await discardBeatsAndProse(bookId, discardIds);
      toast({ title: "Beats and prose discarded", description: "Every page is back to its objective. Generate all beats to re-plan." });
      onChanged();
    } catch (e) {
      toast({ title: "Couldn't discard", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setDiscarding(false);
    }
  };

  if (total === 0) {
    return <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">No pages with an objective yet — generate the outline first.</p>;
  }

  const hasBeats = doneCount > 0;

  return (
    <div>
      {/* ── Bulk build pipeline (whole-draft gesture, always reachable while gaps exist) ── */}
      {beatsRunning ? (
        <RunningCard
          label={buildProgress?.phase ?? "Planning beats"} done={buildProgress?.done} total={buildProgress?.total} unit="page"
          controls={<RunControls table="book_generations" row={buildRow} stale={buildStale} onRestart={runBulkBeats} refetch={buildRefetch} />}
        />
      ) : buildPaused ? (
        <DoneStrip icon={<Check className="h-5 w-5" />} title="All beats planned">
          Ready to write — generate all the prose from the beats in one shot.{" "}
          <button type="button" onClick={() => void runBulkProse()} className="italic text-[hsl(var(--pv-accent))] hover:opacity-75">write all prose →</button>
        </DoneStrip>
      ) : proseRunning ? (
        <RunningInline className="mb-6" label={buildProgress?.phase ?? "Writing prose…"} />
      ) : gapCount > 0 ? (
        <Hero
          icon={<Sparkles className="h-5 w-5" />}
          title={`Generate ${hasBeats ? "the remaining " : "all "}${gapCount} beat${gapCount === 1 ? "" : "s"} at once`}
          sub="Plans the strongest beat for each page from its objective — then continues straight into the prose. You can refine any beat by hand below."
          onClick={() => void runBulkBeats()}
        />
      ) : null}

      {/* ── Chat pointer (cold start: no beats, no bulk running) ── */}
      {!hasBeats && !buildActive && gapCount > 0 && (
        <p className="pv-serif mt-3 text-[14px] text-[hsl(var(--pv-text-muted))]">
          …or plan them in the editor on the right →
        </p>
      )}

      {/* ── Beat sheet: always the manual editor surface ── */}
      {/* Hidden only while the bulk beats run is active (beatsRunning); shown during proseRunning since beats are done. */}
      {(!buildActive || proseRunning) && (
        <div className={gapCount > 0 || buildPaused || proseRunning ? "mt-8 border-t border-[hsl(var(--pv-border-soft))]/60 pt-6" : ""}>
          <BeatSheet
            bookId={bookId} model={model} onChanged={onChanged} onSelectPage={onSelectPage}
            onDiscardAll={discardIds.length > 0 ? () => void discardAllBeats() : undefined}
            discarding={discarding}
          />
        </div>
      )}
    </div>
  );
}
