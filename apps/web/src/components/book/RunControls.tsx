import { useState } from "react";
import { isStoppable, stopRun, type StoppableTable } from "@/lib/stopRun";

interface RunRow { id: number; status: string }

interface RunControlsProps {
  /** Which task table the row lives in. */
  table: StoppableTable;
  /** The watched row (from useLatestTaskRow). */
  row: RunRow | null;
  /** True once the run looks stalled (no progress within staleMs) — escalates the copy. */
  stale?: boolean;
  /** Re-kick a fresh run after stopping (the host's generate/run function). */
  onRestart?: () => void;
  /** Re-read the row after a status change. */
  refetch: () => void;
}

/**
 * The one Stop control behind every AI run. Every durable AI action is a task row that a dead worker
 * (or a restarted dev bridge) can leave in a working status forever, with the UI spinning and no
 * escape — and that the author may simply want to abandon. This renders an always-available Stop
 * (routed through stopRun, which knows the right terminal action per table) and, once a run looks
 * stalled, a Restart (stop + re-kick). Renders nothing unless a run is active.
 */
export function RunControls({ table, row, stale, onRestart, refetch }: RunControlsProps) {
  const [stopping, setStopping] = useState(false);
  if (!row || !isStoppable(table, row.status)) return null;

  const stop = async () => {
    setStopping(true);
    try {
      await stopRun(table, row.id);
      refetch();
    } finally {
      setStopping(false);
    }
  };
  const restart = async () => { await stop(); onRestart?.(); };

  const link = "pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-muted))] underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50";

  return (
    <div className="px-5 pt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {stale && (
        <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">Still working — taking longer than expected.</span>
      )}
      <button type="button" onClick={() => void stop()} disabled={stopping} className={link}>
        {stopping ? "stopping…" : "cancel"}
      </button>
      {onRestart && (
        <button type="button" onClick={() => void restart()} disabled={stopping} className={link}>
          restart
        </button>
      )}
    </div>
  );
}
