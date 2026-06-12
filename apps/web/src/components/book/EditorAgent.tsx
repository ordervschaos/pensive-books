import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { stopRun } from "@/lib/stopRun";
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import { WorkingIndicator } from "./WorkingIndicator";
import type { EvalResult } from "./BookEvaluationSection";

/**
 * EditorAgent — the durable agent run that addresses the editor's notes (revise-agent fn).
 *
 * The whole run lives in a book_agent_runs row: the agent reads pages, may pause to ask the
 * author a creative question (status 'awaiting_input'), and ends by proposing a revision plan —
 * a book_revisions row in awaiting_review that the existing "Revise with AI" dialog reviews and
 * builds. This panel renders the row over Realtime: the narrated step feed while running, the
 * question card when asked, and the closing report with a "review the plan" handoff.
 *
 * Started by the host handing in the evaluation (the report's "Address all the editor's notes"
 * button) — the same prefill pattern ReviseWithAI uses.
 */

interface AgentStep { t: "note" | "read" | "ask" | "answer" | "plan" | "done"; label: string }
interface AgentRow extends TaskRow {
  steps: AgentStep[] | null;
  pending: { question: string; options?: string[] } | null;
  report: string | null;
  revision_id: number | null;
  evaluation: EvalResult | null;
  cancel_requested: boolean;
  error: string | null;
}

const SELECT = "id, book_id, status, created_at, updated_at, steps, pending, report, revision_id, evaluation, cancel_requested, error";

const STEP_MARK: Record<AgentStep["t"], string> = {
  note: "·", read: "↳", ask: "?", answer: "↩", plan: "◆", done: "✓",
};

export function EditorAgent({
  bookId,
  start,
  onStartConsumed,
  onReviewPlan,
}: {
  bookId: number;
  /** An evaluation handed in by the host starts a run (consumed via onStartConsumed). */
  start?: EvalResult | null;
  onStartConsumed?: () => void;
  /** Navigate to where the proposed plan is reviewed (the Revise step). */
  onReviewPlan?: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [dismissedDoneId, setDismissedDoneId] = useState<number | null>(null);

  const { row, refetch, stale } = useLatestTaskRow<AgentRow>({
    table: "book_agent_runs",
    bookId,
    select: SELECT,
    // awaiting_input idles on the author indefinitely — only 'running' arms the stale watchdog.
    activeStatuses: ["running"],
    staleMs: 6 * 60 * 1000, // past the pg_cron watchdog's 5-min revive, so stale = genuinely dead
  });

  const running = row?.status === "running";
  const awaiting = row?.status === "awaiting_input";
  const active = running || awaiting;

  const begin = async (evaluation: EvalResult) => {
    if (busy || active) {
      if (active) toast({ title: "The agent is already working", description: "Let this run finish (or cancel it) before starting another." });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("revise-agent", { body: { bookId, evaluation } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      refetch();
    } catch (e) {
      toast({ title: "Couldn't start the agent", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // A handed-in evaluation starts a run — consume it either way so a re-render can't double-start.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!start || startedRef.current) return;
    startedRef.current = true;
    void begin(start).finally(() => {
      startedRef.current = false;
      onStartConsumed?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const sendAnswer = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !row || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("revise-agent", { body: { runId: row.id, answer: trimmed } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      setAnswer("");
      refetch();
    } catch (e) {
      toast({ title: "Couldn't send your answer", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!row) return;
    // stopRun routes by status: a running chain notices cancel_requested between links; a parked
    // (awaiting_input) run has no chain to notice it, so it's cancelled directly.
    await stopRun("book_agent_runs", row.id, row.status);
    refetch();
  };

  // Nothing to show: never run, and nothing handed in.
  if (!row) return null;

  const steps = (row.steps ?? []) as AgentStep[];
  const lastStep = steps.length ? steps[steps.length - 1].label : "Working";

  return (
    <section className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">
          The editor's agent ·{" "}
          <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
            addresses the notes with you · author only
          </span>
        </div>
        {active && (
          <button
            type="button"
            onClick={cancel}
            disabled={row.cancel_requested}
            className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground"
          >
            {row.cancel_requested ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>

      {/* The narrated step feed — the agent's honest activity log, in every state. */}
      {steps.length > 0 && (
        <div className="mt-3 space-y-1">
          {steps.map((s, i) => (
            <p
              key={i}
              className={`pv-serif text-[13.5px] leading-relaxed ${
                s.t === "ask" || s.t === "plan" ? "text-foreground" : "text-[hsl(var(--pv-text-muted))]"
              }`}
            >
              <span className="pv-mono mr-1.5 text-[11px] text-[hsl(var(--pv-text-faint))]">{STEP_MARK[s.t]}</span>
              {s.label}
            </p>
          ))}
        </div>
      )}

      {running && !stale && <WorkingIndicator phrases={[lastStep]} hint="reading & planning" />}
      {running && stale && (
        <p className="pv-serif mt-3 text-[14px] leading-relaxed text-amber-600 dark:text-amber-500">
          The run hasn't advanced in a while — it may have died. You can cancel it and start again from the report above.
        </p>
      )}

      {/* The question card — the agent paused on a creative fork. */}
      {awaiting && row.pending && (
        <div className="mt-4 space-y-3 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.07] p-4">
          <p className="pv-serif text-[15px] leading-relaxed text-foreground">{row.pending.question}</p>
          {(row.pending.options ?? []).length > 0 && (
            <div className="flex flex-col items-start gap-1.5">
              {row.pending.options!.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={busy}
                  onClick={() => sendAnswer(opt)}
                  className="pv-serif rounded-lg border border-[hsl(var(--pv-border-soft))] bg-background px-3 py-1.5 text-left text-[14px] leading-snug text-foreground transition-colors hover:border-[hsl(var(--pv-accent))]/50"
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="…or answer in your own words"
              className="pv-serif min-h-[44px] flex-1 text-[14px] leading-relaxed"
            />
            <Button size="sm" disabled={busy || !answer.trim()} onClick={() => sendAnswer(answer)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
            </Button>
          </div>
        </div>
      )}

      {/* Done — the report, and the handoff to the plan review when one was proposed. */}
      {row.status === "done" && dismissedDoneId !== row.id && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/10 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <p className="pv-serif text-[14.5px] leading-relaxed text-foreground">
              {row.report || "The agent finished."}
            </p>
            {row.revision_id != null && onReviewPlan && (
              <button
                type="button"
                onClick={onReviewPlan}
                className="pv-mono inline-flex items-center text-[11px] uppercase tracking-[0.14em] text-[hsl(var(--pv-accent))] underline-offset-4 hover:underline"
              >
                Review the proposed plan →
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDismissedDoneId(row.id)}
            aria-label="Dismiss"
            className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {row.status === "error" && (
        <p className="pv-serif mt-3 text-[14px] leading-relaxed text-red-600 dark:text-red-400">
          The agent stopped: {row.error ?? "unknown error"}. Run it again from the report above.
        </p>
      )}
      {row.status === "cancelled" && (
        <p className="pv-serif mt-3 text-[13px] italic text-[hsl(var(--pv-text-faint))]">
          Run cancelled — nothing was changed.
        </p>
      )}
    </section>
  );
}
