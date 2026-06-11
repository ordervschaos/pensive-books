import { supabase } from "@/integrations/supabase/client";

interface RunRow { id: number; status: string }

interface RunControlsProps {
  /** Which task table the row lives in. */
  table: "book_generations" | "book_evaluations";
  /** The watched row (from useLatestTaskRow). */
  row: RunRow | null;
  /** True once the run looks stalled (no progress within staleMs) — escalates the copy. */
  stale?: boolean;
  /** Re-kick a fresh run after cancelling (the host's generate/run function). */
  onRestart?: () => void;
  /** Re-read the row after a status change. */
  refetch: () => void;
}

/**
 * Recover a stuck or unwanted AI run. Every durable AI action is a task row that a dead worker (or a
 * restarted dev bridge) can leave in 'running'/'pending' forever, with the UI spinning and no escape.
 * This gives an always-available Cancel (mark the row terminal so the watcher stops and the action
 * frees up) and, once a run looks stalled, a Restart (cancel + re-kick). Renders nothing unless a run
 * is active.
 */
export function RunControls({ table, row, stale, onRestart, refetch }: RunControlsProps) {
  if (!row || (row.status !== "pending" && row.status !== "running")) return null;

  const cancel = async () => {
    // 'error' is terminal: the self-chain watchdog only revives 'running', so this stops the chain.
    await supabase.from(table).update({ status: "error", error: "Stopped by the author." }).eq("id", row.id);
    refetch();
  };
  const restart = async () => { await cancel(); onRestart?.(); };

  return (
    <div className="px-5 pt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      {stale && (
        <span className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">This run looks stuck.</span>
      )}
      <button
        type="button"
        onClick={() => void cancel()}
        className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-muted))] underline-offset-2 hover:text-foreground hover:underline"
      >
        Cancel
      </button>
      {onRestart && (
        <button
          type="button"
          onClick={() => void restart()}
          className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-muted))] underline-offset-2 hover:text-foreground hover:underline"
        >
          Restart
        </button>
      )}
    </div>
  );
}
