// DurableOptions — the inline "generate wide alternatives, pick one" panel, backed by a durable
// ai-run row (useAIRun). Unlike the old ephemeral NodeOptions, the run lives server-side: navigate
// away and back, or refresh, and an in-flight generation or an un-picked proposal is still here.
//
// States (no modal — all inline under the field):
//   idle    → "options →"
//   running → "Generating options…" + Cancel (abandon)
//   ready   → the alternatives, each with "use this →"; Reject discards, Regenerate re-runs
//   error   → the message + Try again
//
// Used for any options-kind run (objective_options now; spine_options later) by varying kind/params.
import { Loader2 } from "lucide-react";
import { useAIRun } from "@/hooks/useAIRun";

interface DurableOptionsProps {
  bookId: number;
  kind: string;
  targetKey?: string;
  targetPageId?: number;
  /** Built fresh at click time (so it captures the latest draft/objective). */
  getParams: () => Record<string, unknown>;
  /** Apply a chosen option (persist it); the panel then marks the run applied and closes. */
  onApply: (text: string) => Promise<void>;
  /** External disable (e.g. a sibling op running). */
  busy?: boolean;
  label?: string;
}

export function DurableOptions({ bookId, kind, targetKey, targetPageId, getParams, onApply, busy, label = "options →" }: DurableOptionsProps) {
  const { run, starting, start, accept, reject, cancel } = useAIRun<{ options: string[] }>({ bookId, kind, targetKey, targetPageId });

  const running = run?.status === "running" || run?.status === "pending" || starting;
  const ready = run?.status === "ready";
  const errored = run?.status === "error";
  const options = (run?.result?.options ?? []).filter(Boolean);

  // Idle: nothing live → the trigger.
  if (!run && !starting) {
    return (
      <button type="button" onClick={() => void start(getParams())} disabled={busy}
        className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-50">
        {label}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {errored && (
        <p className="pv-serif text-[12.5px] italic text-red-600 dark:text-red-400">{run?.error ?? "Something went wrong."}</p>
      )}

      {running ? (
        <div className="flex items-center gap-3">
          <p className="pv-serif inline-flex items-center gap-2 text-[13px] italic text-[hsl(var(--pv-text-muted))]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating options…
          </p>
          <button type="button" onClick={() => void cancel()}
            className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
            cancel
          </button>
        </div>
      ) : ready ? (
        <>
          <div className="space-y-2">
            {options.map((opt, i) => (
              <div key={i} className="rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-3 py-2.5">
                <p className="pv-serif text-[13.5px] leading-snug text-foreground">{opt}</p>
                <button type="button" onClick={() => void accept(() => onApply(opt))}
                  className="pv-serif mt-2 inline-flex items-center gap-1 text-[12.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
                  use this →
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-0.5">
            <button type="button" onClick={() => void start(getParams())}
              className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">
              regenerate
            </button>
            <button type="button" onClick={() => void reject()}
              className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">
              reject
            </button>
          </div>
        </>
      ) : (
        // errored (or any other non-running, non-ready surfaced state): offer a retry.
        <button type="button" onClick={() => void start(getParams())}
          className="pv-serif text-[12.5px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">
          Try again →
        </button>
      )}
    </div>
  );
}
