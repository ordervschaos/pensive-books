// BeatsStep — beats for every objective-bearing page. The prominent path is BULK: "Generate all beats
// at once" plans a beat for every gap page server-side (generate-book, best-of-3, auto-picked), then
// resumes into the prose stage. Below it, an optional page-by-page flow lets the author shape any single
// beat by hand.
//
// The page-by-page flow generates ONE beat (a durable run, kind 'beat_candidates' keyed by page) which
// the author edits in place and saves — no take-picker. The run survives navigation/refresh, is
// cancellable, and reattaches; the cursor/edit stay client-side. Saving a beat marks the run applied.
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAIRun } from "@/hooks/useAIRun";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { saveBeat } from "@/lib/ladder";
import { invokeGenerateBook } from "@/lib/generateBook";
import { discardBeatsAndProse } from "@/lib/discardLadder";
import { RunControls } from "../../RunControls";
import { BeatSheet } from "../BeatSheet";
import type { MapPage } from "@/lib/planGraph";
import type { StudioModel } from "../studioModel";
import type { UseSteer } from "@/lib/steer";
import { ActionLink, DoneStrip, Eyebrow, GenRow, Hero, Panel, RunError, RunningCard, RunningInline } from "../studioUi";

interface BuildProgress { done: number; total: number; phase?: string; stage?: string }
interface BuildRow extends TaskRow { progress: BuildProgress | null; error: string | null }

export function BeatsStep({ bookId, model, steer, beforeGen, onChanged, onSelectPage }: { bookId: number; model: StudioModel; steer: UseSteer; beforeGen: () => Promise<void>; onChanged: () => void; onSelectPage?: (pageId: number) => void }) {
  const { toast } = useToast();
  const beatPages = model.textPages.filter((p) => p.objectiveText.trim());
  const doneCount = beatPages.filter((p) => p.beat !== "gap").length;
  const gapCount = beatPages.filter((p) => p.beat === "gap").length;
  const total = beatPages.length;

  const firstGap = beatPages.findIndex((p) => p.beat === "gap");
  const [cursor, setCursor] = useState(firstGap === -1 ? 0 : firstGap);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const seatedRun = useRef<number | null>(null);

  const page: MapPage | undefined = beatPages[cursor];
  const committed = !!page && page.beat !== "gap";

  // Durable single-beat generation for the current (gap) page.
  const cand = useAIRun<{ options: string[] }>({ bookId, kind: "beat_candidates", targetPageId: page?.id, enabled: !!page && !committed });
  const beat = cand.run?.result?.options?.[0] ?? "";
  const generating = cand.run?.status === "running" || cand.run?.status === "pending" || cand.starting;
  const ready = cand.run?.status === "ready" && !!beat;

  const draftBeat = async (note: string) => { if (!page) return; await beforeGen(); void cand.start({ pageId: page.id, objective: page.objectiveText.trim(), ...(note.trim() ? { prompt: note.trim() } : {}) }); };

  // ── Bulk beat/prose run ──────────────────────────────────────────────────────
  const { row: buildRow, refetch: buildRefetch, stale: buildStale } = useLatestTaskRow<BuildRow>({
    table: "book_generations", bookId, match: { kind: "write_all" },
    activeStatuses: ["pending", "running"], staleMs: 180_000,
  });
  const buildProgress = buildRow?.progress ?? null;
  const buildActive = buildRow?.status === "pending" || buildRow?.status === "running";
  const beatsRunning = buildActive && buildProgress?.stage !== "prose";
  const proseRunning = buildActive && buildProgress?.stage === "prose";
  const buildRunning = beatsRunning; // kept for downstream guards (cancel/restart, discard block)
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
      await beforeGen(); // persist the beats steer so generate-book's beat phase reads it
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

  // Discard beats AND prose back to objectives-only, so the bulk/by-hand flow can re-plan from scratch.
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

  // Seat the editable draft: a committed page shows its saved beat; a gap page starts empty until a run lands.
  useEffect(() => {
    if (!page) return;
    setDraft(committed ? page.beatText : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, committed]);

  // When a fresh single-beat run lands, seat it as the editable draft (once per run).
  useEffect(() => {
    if (ready && cand.run && seatedRun.current !== cand.run.id) {
      seatedRun.current = cand.run.id;
      setDraft(beat);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cand.run?.id, cand.run?.status]);

  if (total === 0) {
    return <p className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))]">No pages with an objective yet — generate the outline first.</p>;
  }
  if (!page) return null;
  const hasBeats = doneCount > 0; // once any beat exists, the whole-sheet view + AI doctor take over

  const advance = () => {
    const rest = beatPages.slice(cursor + 1).findIndex((p) => p.beat === "gap");
    setCursor(rest === -1 ? cursor + 1 : cursor + 1 + rest);
  };
  const commit = async () => {
    const text = draft.trim();
    if (!text || saving) { if (!text) toast({ title: "Generate or write a beat first", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await saveBeat(bookId, page.id, text);
      if (cand.run?.status === "ready") await cand.accept(async () => {}); // mark the run applied
      toast({ title: "Beat set", description: `"${page.title || "page"}" — ${doneCount + 1} of ${total}.` });
      onChanged();
      advance();
    } catch (e) {
      toast({ title: "Couldn't save the beat", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setSaving(false); }
  };
  const movement = model.movements.find((m) => m.pages.some((p) => p.id === page.id));

  return (
    <div>
      {/* ── Bulk: the prominent path ── */}
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
        <>
          <Hero
            icon={<Sparkles className="h-5 w-5" />}
            title={`Generate ${hasBeats ? "the remaining " : "all "}${gapCount} beat${gapCount === 1 ? "" : "s"} at once`}
            sub="Plans the strongest beat for each page from its objective — then continues straight into the prose. You can refine any beat by hand below."
            onClick={() => void runBulkBeats()}
          />
          <div className="mt-3">
            <GenRow
              chips={["Tighter causality", "Raise the stakes", "More subtext", "Stronger turn", "Add tension", "Shift the dynamic"]}
              label="Steer the generation"
              onFire={async (note) => { if (note.trim()) { steer.setValue(note.trim()); await steer.save(); } void runBulkBeats(); }}
            />
          </div>
        </>
      ) : null}

      {/* ── Once any beat exists: the whole-sheet view + the AI beat-sheet doctor take over ── */}
      {/* proseRunning: beats are done even though the bulk run is still active — show the sheet ── */}
      {hasBeats && (!buildActive || proseRunning) && (
        <div className={gapCount > 0 || buildPaused || proseRunning ? "mt-8 border-t border-[hsl(var(--pv-border-soft))]/60 pt-6" : ""}>
          <BeatSheet bookId={bookId} model={model} onChanged={onChanged} onSelectPage={onSelectPage} beforeGen={beforeGen} />
          {discardIds.length > 0 && (
            <div className="mt-6 border-t border-[hsl(var(--pv-border-soft))]/40 pt-4">
              <ActionLink tone="faint" busy={discarding} onClick={() => void discardAllBeats()}>
                discard all beats &amp; prose, re-plan →
              </ActionLink>
            </div>
          )}
        </div>
      )}

      {/* ── Cold start (no beats yet): page-by-page hand-shaping ── */}
      {!hasBeats && !buildActive && (
        <div className="mt-8 border-t border-[hsl(var(--pv-border-soft))]/60 pt-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <Eyebrow>Shape a beat by hand</Eyebrow>
              <p className="pv-serif mt-0.5 text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">Walk the pages, generate one beat, edit it, and keep it.</p>
            </div>
            <span className="shrink-0 pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))]">beat {cursor + 1} of {total} · {doneCount} done</span>
          </div>
          <BeatRail pages={beatPages} cursor={cursor} onJump={setCursor} />

          <div className="mt-5 flex items-baseline gap-3">
            <span className="pv-mono text-[9.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-faint))]">{movement?.num ? `${movement.num} · ` : ""}{movement?.title ?? "Pages"}</span>
            <span className="ml-auto pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">page {cursor + 1}</span>
          </div>
          <h2 className="pv-serif mb-4 mt-1 text-[28px] leading-[1.15] tracking-[-0.01em] text-foreground">{page.title || "(untitled page)"}</h2>

          <Panel variant="soft" className="px-5 py-4">
            <Eyebrow>Objective · the contract</Eyebrow>
            <p className="pv-serif mt-2 text-[15.5px] leading-[1.6] text-[hsl(var(--pv-text-muted))]">{page.objectiveText}</p>
          </Panel>

          {generating ? (
            <RunningInline className="mt-5" label="Drafting the beat…" onCancel={() => void cand.cancel()} />
          ) : committed ? (
            <div className="mt-5 space-y-3.5">
              <Eyebrow className="block">Chosen beat</Eyebrow>
              <Panel variant="chosen" className="px-5 py-4">
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft.trim() && void saveBeat(bookId, page.id, draft.trim()).then(onChanged)} rows={6}
                  className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.6] focus-visible:ring-0" />
              </Panel>
              <div className="flex items-center justify-between gap-5">
                <GenRow chips={["Stronger turn", "More subtext", "Higher stakes", "Tighter causality", "Add tension", "Shift the dynamic"]} label="Propose more" descLabel="Proposes a fresh beat for this page." onFire={(note) => void draftBeat(note)} />
                <div className="flex shrink-0 gap-5">
                  {cursor > 0 && <button type="button" onClick={() => setCursor(cursor - 1)} className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">← prev</button>}
                  {cursor < total - 1 && <button type="button" onClick={() => setCursor(cursor + 1)} className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">next →</button>}
                </div>
              </div>
            </div>
          ) : ready ? (
            <div className="mt-5 space-y-3.5">
              <Eyebrow className="block">Beat — edit it, then keep it</Eyebrow>
              <Panel variant="chosen" className="px-5 py-4">
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6}
                  className="pv-serif border-none bg-transparent px-0 text-[15.5px] leading-[1.6] focus-visible:ring-0" />
              </Panel>
              <div className="flex flex-wrap items-center gap-4">
                <button type="button" onClick={() => void commit()} disabled={saving || !draft.trim()}
                  className="pv-serif inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[14.5px] text-primary-foreground disabled:opacity-40">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Use this beat &amp; continue
                </button>
                <GenRow chips={["Stronger turn", "More subtext", "Higher stakes", "Tighter causality", "Add tension", "Shift the dynamic"]} label="Propose more" descLabel="Proposes a fresh beat for this page." onFire={(note) => void draftBeat(note)} />
                {cursor > 0 && <button type="button" onClick={() => setCursor(cursor - 1)} className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground"><ArrowLeft className="mr-1 inline h-3.5 w-3.5" />back</button>}
              </div>
            </div>
          ) : cand.run?.status === "error" ? (
            <div className="mt-5 flex items-center gap-4">
              <RunError msg={cand.run.error ?? "Couldn't draft the beat."} />
              <ActionLink onClick={draftBeat}>try again →</ActionLink>
            </div>
          ) : (
            <div className="mt-5 space-y-2.5">
              <GenRow chips={["Stronger turn", "More subtext", "Higher stakes", "Tighter causality", "Add tension", "Shift the dynamic"]} label="Draft this beat" onFire={(note) => void draftBeat(note)} />
              <div className="flex gap-5">
                {cursor > 0 && <button type="button" onClick={() => setCursor(cursor - 1)} className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">← prev</button>}
                {cursor < total - 1 && <button type="button" onClick={() => setCursor(cursor + 1)} className="pv-serif text-[13.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">next →</button>}
              </div>
            </div>
          )}

          {discardIds.length > 0 && (
            <div className="mt-6 border-t border-[hsl(var(--pv-border-soft))]/40 pt-4">
              <ActionLink tone="faint" busy={discarding} onClick={() => void discardAllBeats()}>
                discard all beats & prose, re-plan →
              </ActionLink>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BeatRail({ pages, cursor, onJump }: { pages: MapPage[]; cursor: number; onJump: (i: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pages.map((p, i) => {
        const done = p.beat !== "gap";
        const cur = i === cursor;
        return (
          <button
            key={p.id}
            type="button"
            title={`Beat ${i + 1} — ${p.title ?? ""}`}
            onClick={() => onJump(i)}
            className={`h-2 w-5 rounded-full border transition-transform hover:-translate-y-px ${
              done ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-accent))]"
                : cur ? "border-[hsl(var(--pv-accent))] bg-[hsl(var(--pv-surface-2))] ring-2 ring-[hsl(var(--pv-accent))]/20"
                  : "border-[hsl(var(--pv-text-faint))]/50 bg-transparent"
            }`}
          />
        );
      })}
    </div>
  );
}
