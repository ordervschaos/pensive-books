// DnaAutopilot — the "build the whole book from the brief" control, on the studio Overview. It drives the
// client-side auto-build loop (lib/autopilot) and mirrors its durable book_generations row, so progress,
// the milestone pause, and resume-after-refresh all read off server state (refresh = no-op). Two modes:
// Auto (runs straight to a drafted book) and Milestones (builds one journey stage, then parks for the
// author to approve before continuing). The loop itself runs in this tab; the row makes it durable.
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Loader2, Check, Play, X, TriangleAlert, Flag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { stopRun } from "@/lib/stopRun";
import { ActionLink, Eyebrow, Panel } from "@/components/book/shared/studioUi";
import { DNA_STAGES } from "@/lib/dnaJourney";
import {
  continueAutopilot, resumeAutopilot, runAutopilot, startAutopilot,
  type AutopilotMode, type AutopilotProgress,
} from "@/lib/autopilot";

const STAGE_NUM = Object.fromEntries(DNA_STAGES.map((s, i) => [s.key, i + 1]));

export function DnaAutopilot({ bookId, picture = false, onChanged }: { bookId: number; picture?: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  // Short stale window: the in-tab driver bumps the row every step, so a row that's gone quiet means the
  // driver was lost (tab closed/refreshed) — surface Resume fast rather than waiting out a 10-min default.
  const { row, stale, refetch } = useLatestTaskRow({
    table: "book_generations", bookId, match: { kind: "autopilot" },
    activeStatuses: ["running"], staleMs: 30_000,
  });
  const status = row?.status as string | undefined;
  const prog = (row?.progress ?? null) as AutopilotProgress | null;

  const cancelRef = useRef(false);
  const drivingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const isCancelled = useCallback(() => cancelRef.current, []);

  // Run a driver fn with single-flight guarding + a fresh cancel token; refresh the row + tree after.
  const drive = useCallback(
    async (fn: () => Promise<void>) => {
      if (drivingRef.current) return;
      drivingRef.current = true;
      cancelRef.current = false;
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        toast({ title: "Auto-build error", description: String((e as Error)?.message ?? e), variant: "destructive" });
      } finally {
        drivingRef.current = false;
        setBusy(false);
        refetch();
        onChanged();
      }
    },
    [toast, refetch, onChanged],
  );

  const start = (mode: AutopilotMode) =>
    drive(async () => {
      const id = await startAutopilot(bookId, mode);
      await runAutopilot(bookId, id, isCancelled);
    });
  const cont = () => row && drive(() => continueAutopilot(bookId, row.id, isCancelled));
  const resume = () => row && drive(() => resumeAutopilot(bookId, row.id, isCancelled));
  const stop = async () => {
    cancelRef.current = true; // halt this tab's loop immediately
    if (row) {
      try { await stopRun("book_generations", row.id, status); } catch { /* best-effort */ }
    }
  };

  // Auto-recover a clearly-dead 'running' row (driver lost to a closed/refreshed tab). Only when the row
  // has gone stale AND nothing here is driving — so two open tabs don't both seize it.
  useEffect(() => {
    if (status === "running" && stale && !drivingRef.current) resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, stale]);

  const running = status === "running";
  const paused = status === "ready";
  const phase = prog?.phase ?? "";
  const stageNum = prog?.stage ? STAGE_NUM[prog.stage] : undefined;
  const stageOf = stageNum ? ` · stage ${stageNum}/${DNA_STAGES.length}` : "";

  // ── Running: live progress + Stop (and a manual Resume if this tab isn't the driver). ──
  if (running) {
    return (
      <Panel variant="soft" className="space-y-2">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[hsl(var(--pv-accent))]" />
          <span className="pv-serif text-[13px] text-foreground">Auto-building{stageOf}</span>
          <button onClick={stop} className="pv-mono ml-auto inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))] hover:text-foreground">
            <X className="h-3 w-3" /> stop
          </button>
        </div>
        {phase && <div className="pv-mono pl-6 text-[11px] text-[hsl(var(--pv-text-muted))]">{phase}…</div>}
        {!drivingRef.current && (
          <div className="pl-6">
            <ActionLink tone="faint" busy={busy} onClick={resume}>resume in this tab</ActionLink>
          </div>
        )}
      </Panel>
    );
  }

  // ── Paused at a milestone: review the just-built stage, then continue. ──
  if (paused) {
    const completed = prog?.milestone;
    return (
      <Panel variant="chosen" className="space-y-2">
        <div className="flex items-center gap-2.5">
          <Flag className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-accent))]" />
          <span className="pv-serif text-[13px] text-foreground">
            Milestone — {completed ? DNA_STAGES.find((s) => s.key === completed)?.label : "stage"} ready for review
          </span>
        </div>
        <p className="pv-mono pl-6 text-[11px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
          Review, edit, or lock anything in this stage, then continue to the next.
        </p>
        <div className="flex items-center gap-4 pl-6">
          <ActionLink icon={<Play className="h-3.5 w-3.5" />} busy={busy} onClick={cont}>continue to the next stage</ActionLink>
          <button onClick={stop} className="pv-mono inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))] hover:text-foreground">
            <X className="h-3 w-3" /> stop
          </button>
        </div>
      </Panel>
    );
  }

  // ── Error: a terminal failure (e.g. credits) — let the author resume after fixing it. ──
  if (status === "error") {
    return (
      <Panel variant="soft" className="space-y-2">
        <div className="flex items-center gap-2.5">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="pv-serif text-[13px] text-foreground">Auto-build stopped</span>
        </div>
        <p className="pv-mono pl-6 text-[11px] text-[hsl(var(--pv-text-muted))]">{(row?.error as string) || phase}</p>
        <div className="flex items-center gap-4 pl-6">
          <ActionLink icon={<Play className="h-3.5 w-3.5" />} busy={busy} onClick={resume}>resume</ActionLink>
          <ActionLink tone="faint" onClick={() => start("auto")}>start over (auto)</ActionLink>
        </div>
      </Panel>
    );
  }

  // ── Idle (no run, done, or cancelled): the two start gestures. ──
  const lastDone = status === "done";
  return (
    <Panel variant="soft" className="space-y-2.5">
      <div className="flex items-center gap-2.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-accent))]" />
        <Eyebrow tone="accent">Auto-build</Eyebrow>
        {lastDone && <span className="pv-mono inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-emerald-600"><Check className="h-3 w-3" /> last run complete</span>}
      </div>
      <p className="pv-mono pl-6 text-[11px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
        Build the whole book from the brief — premise → foundations → structure → scenes → {picture ? "illustrations" : "prose"}.
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pl-6">
        <ActionLink icon={<Sparkles className="h-3.5 w-3.5" />} busy={busy} onClick={() => start("auto")}>
          {lastDone ? "build again" : "build it all"} (automatic)
        </ActionLink>
        <ActionLink icon={<Flag className="h-3.5 w-3.5" />} busy={busy} onClick={() => start("milestone")}>
          build with milestones
        </ActionLink>
      </div>
    </Panel>
  );
}
