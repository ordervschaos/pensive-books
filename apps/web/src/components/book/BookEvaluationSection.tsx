import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeAIError, captureException } from "@/lib/sentry";
import { WorkingIndicator, WORKING_PHRASES } from "./WorkingIndicator";
import { NotifyWhenDone } from "./NotifyWhenDone";
import { notify as fireNotification } from "@/lib/notify";

// Two backends, env-switched:
//  - Production (default): the `evaluate-book` edge function writes a book_evaluations
//    row; we invoke it, then watch the row over Realtime for pending → done.
//  - Local dev: if VITE_EVAL_BRIDGE_URL is set, talk to scripts/eval-bridge.mjs instead
//    (runs Claude Code on your own machine, zero API cost).
const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;
const USE_BRIDGE = !!BRIDGE;

type Stance = "strong" | "solid" | "needs work";
export type Severity = "high" | "medium" | "low";

export interface Issue {
  severity: Severity;
  note: string;
  evidence?: string;
  suggestion?: string;
  page_ref?: { id: number | null; title: string; index: number | null } | null;
}
export interface Section {
  id: string;
  title: string;
  stance: Stance;
  assessment: string;
  strengths?: string[];
  issues?: Issue[];
}
export interface EvalResult {
  verdict: { genre_contract: string; stance: string; letter: string; priorities: string[] };
  sections: Section[];
}
interface EvalRow {
  id: number;
  status: "pending" | "done" | "error";
  result: EvalResult | null;
  error: string | null;
  created_at: string;
}

// A background eval (EdgeRuntime.waitUntil) that dies before writing done/error leaves its row
// stuck `pending` forever, and Realtime never fires — so the UI would "read" indefinitely. Treat a
// pending row this old as failed. Evals take ~30–90s; 5 min is comfortably past any live run.
const STALE_MS = 10 * 60 * 1000;
const STALE_ERROR = "The editor's read didn't finish — try running it again.";
const isStale = (createdAt: string) => Date.now() - new Date(createdAt).getTime() >= STALE_MS;

type State =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "running" }
  // staleRetry: we're showing an older completed read because a newer attempt errored/stalled.
  | { status: "done"; result: EvalResult; staleRetry?: boolean }
  | { status: "error"; error: string };

const STANCE_TONE: Record<Stance, string> = {
  strong: "text-[hsl(var(--pv-accent))]",
  solid: "text-[hsl(var(--pv-text-muted))]",
  "needs work": "text-amber-600 dark:text-amber-500",
};
const SEV_MARK: Record<Severity, string> = { high: "⚠", medium: "●", low: "·" };
const SEV_TONE: Record<Severity, string> = {
  high: "text-red-600 dark:text-red-400",
  medium: "text-amber-600 dark:text-amber-500",
  low: "text-[hsl(var(--pv-text-faint))]",
};

export function BookEvaluationSection({ bookId, onRevise, onStatusChange }: { bookId: number; onRevise?: (result: EvalResult, instruction?: string) => void; onStatusChange?: (hasCompletedRead: boolean) => void }) {
  const [state, setState] = useState<State>({ status: "checking" });
  const mounted = useRef(true);

  // "Notify me when done": email (persisted as notify_email on the row, so the
  // DB trigger mails even if this tab closes) + a browser notification this tab
  // fires when it observes completion. notifyRef mirrors the state for the
  // channel callback's stale closure; evalIdRef is the row to flag.
  const [notify, setNotify] = useState(false);
  const notifyRef = useRef(false);
  const evalIdRef = useRef<number | null>(null);

  const onToggleNotify = (next: boolean) => {
    setNotify(next);
    notifyRef.current = next;
    if (evalIdRef.current != null) {
      void supabase.from("book_evaluations").update({ notify_email: next }).eq("id", evalIdRef.current);
    }
  };

  // Surface "a completed read exists" to a host (the journey stepper) so it can mark the step
  // done. Fires on every status change; idempotent.
  useEffect(() => {
    onStatusChange?.(state.status === "done");
  }, [state.status, onStatusChange]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tear down the Realtime watch and its staleness watchdog together — every caller that stops
  // watching (done, error, unmount, re-watch) wants both gone.
  const cleanupChannel = () => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  // Resolve a book_evaluations row into UI state (used by Realtime + the race re-check).
  const applyRow = (row: EvalRow) => {
    if (!mounted.current) return;
    if (row.status === "done" && row.result) {
      setState({ status: "done", result: row.result });
      cleanupChannel();
      if (notifyRef.current)
        fireNotification("The editor's read is ready", {
          body: "Your verdict, priorities, and section notes are waiting.",
          url: window.location.href,
          tag: `eval-${row.id}`,
        });
    } else if (row.status === "error") {
      setState({ status: "error", error: sanitizeAIError(row.error || "evaluation failed") });
      cleanupChannel();
      if (notifyRef.current)
        fireNotification("The editor's read didn't finish", {
          body: "It ran into a problem — you can try running it again.",
          url: window.location.href,
          tag: `eval-${row.id}`,
        });
    }
    // pending → keep waiting on the channel
  };

  // Watch an in-flight evaluation row until it finishes (edge backend only). `createdAt` arms a
  // watchdog: if the background job dies, Realtime never fires, so we flip to error once the row is
  // stale (counted from when it was created, not from now — so a resumed near-stale row times out
  // promptly rather than waiting a fresh full interval).
  const watchRow = (evalId: number, createdAt: string) => {
    cleanupChannel();
    evalIdRef.current = evalId;
    // If the user opted in before the row existed (toggled during the brief
    // pre-insert window), persist the flag now that we have the id.
    if (notifyRef.current)
      void supabase.from("book_evaluations").update({ notify_email: true }).eq("id", evalId);
    watchdogRef.current = setTimeout(() => {
      if (!mounted.current) return;
      setState((s) => (s.status === "running" ? { status: "error", error: sanitizeAIError(STALE_ERROR, STALE_ERROR) } : s));
      cleanupChannel();
    }, Math.max(0, STALE_MS - (Date.now() - new Date(createdAt).getTime())));
    channelRef.current = supabase
      .channel(`book_eval_${evalId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "book_evaluations", filter: `id=eq.${evalId}` },
        (payload) => applyRow((payload as unknown as { new: EvalRow }).new)
      )
      .subscribe();
    // Catch a completion that landed before the subscription was live.
    supabase
      .from("book_evaluations")
      .select("id, status, result, error, created_at")
      .eq("id", evalId)
      .maybeSingle()
      .then(({ data }) => data && applyRow(data as EvalRow));
  };

  useEffect(() => {
    mounted.current = true;
    setState({ status: "checking" });

    if (USE_BRIDGE) {
      fetch(`${BRIDGE}/eval/${bookId}`)
        .then((r) => r.json())
        .then((d) => {
          if (!mounted.current) return;
          if (d.status === "done") setState({ status: "done", result: d.result });
          else setState({ status: "idle" });
        })
        .catch(() => mounted.current && setState({ status: "idle" }));
    } else {
      // Load recent evaluations; resume watching if one is still running. We pull a few rows (not
      // just the newest) so a failed or stale re-run can't bury an earlier completed read — the
      // author should still see their last good editor's read.
      supabase
        .from("book_evaluations")
        .select("id, status, result, error, created_at")
        .eq("book_id", bookId)
        .order("created_at", { ascending: false })
        .limit(5)
        .then(({ data }) => {
          if (!mounted.current) return;
          const rows = (data ?? []) as EvalRow[];
          if (!rows.length) return setState({ status: "idle" });

          // A genuinely in-flight run (newest row still pending, not stale) wins — resume watching.
          const newest = rows[0];
          if (newest.status === "pending" && !isStale(newest.created_at)) {
            setState({ status: "running" });
            return watchRow(newest.id, newest.created_at);
          }

          // Otherwise show the most recent completed read, regardless of a later error/stale attempt.
          // If a newer (failed/stale) attempt sits above it, flag staleRetry so we can offer a retry.
          const done = rows.find((r) => r.status === "done" && r.result);
          if (done) {
            return setState({ status: "done", result: done.result as EvalResult, staleRetry: rows.indexOf(done) > 0 });
          }

          // No completed read to fall back on — surface the newest terminal state.
          if (newest.status === "error") {
            return setState({ status: "error", error: sanitizeAIError(newest.error || "previous evaluation failed") });
          }
          if (newest.status === "pending") return setState({ status: "error", error: STALE_ERROR });
          setState({ status: "idle" });
        });
    }

    return () => {
      mounted.current = false;
      cleanupChannel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const runBridge = async () => {
    try {
      const r = await fetch(`${BRIDGE}/eval/${bookId}`, { method: "POST" });
      const d = await r.json();
      if (d.status === "done") setState({ status: "done", result: d.result });
      else setState({ status: "error", error: d.error || "evaluation failed" });
    } catch {
      setState({
        status: "error",
        error: `Couldn't reach the eval bridge at ${BRIDGE}. Start it with: node scripts/eval-bridge.mjs`,
      });
    }
  };

  const runEdge = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("evaluate-book", { body: { bookId } });
      if (error) {
        // Surface the function's own { error } message (e.g. non-fiction not supported).
        let msg = "Evaluation failed.";
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          try {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          } catch {
            /* keep default */
          }
        } else if (error.message) msg = error.message;
        setState({ status: "error", error: sanitizeAIError(msg) });
        return;
      }
      const ev = (data as { evaluation?: { id: number; created_at: string } })?.evaluation;
      if (!ev?.id) return setState({ status: "error", error: "No evaluation was started." });
      watchRow(ev.id, ev.created_at);
    } catch (e) {
      captureException(e);
      setState({ status: "error", error: "Evaluation failed." });
    }
  };

  const run = () => {
    setState({ status: "running" });
    return USE_BRIDGE ? runBridge() : runEdge();
  };

  return (
    <div className="rounded-2xl border border-border bg-[hsl(var(--pv-surface-2))]/40 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">
          The editor's read ·{" "}
          <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
            AI feedback · author only
          </span>
        </div>
        {state.status !== "running" && state.status !== "checking" && (
          <button
            type="button"
            onClick={run}
            className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
          >
            {state.status === "done" ? "Re-run →" : "Get feedback →"}
          </button>
        )}
      </div>

      {state.status === "checking" && (
        <p className="pv-serif mt-3 text-[14px] italic text-[hsl(var(--pv-text-faint))]">Checking…</p>
      )}

      {state.status === "idle" && (
        <p className="pv-serif mt-3 max-w-[640px] text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-muted))]">
          A developmental editor's pass over the manuscript — verdict, priorities, and
          section-by-section notes with evidence. Takes ~30–90s.
        </p>
      )}

      {state.status === "running" && (
        <>
          <WorkingIndicator phrases={WORKING_PHRASES.editor} hint="~30–90s" />
          {!USE_BRIDGE && (
            <div className="mt-2 flex justify-end">
              <NotifyWhenDone enabled={notify} onChange={onToggleNotify} />
            </div>
          )}
        </>
      )}

      {state.status === "error" && (
        <p className="pv-serif mt-3 max-w-[640px] text-[14px] leading-relaxed text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      {state.status === "done" && (
        <>
          {state.staleRetry && (
            <p className="pv-serif mt-3 text-[14px] leading-relaxed text-amber-600 dark:text-amber-500">
              Your last re-run didn't finish — showing your previous read.{" "}
              <button
                type="button"
                onClick={run}
                className="italic underline-offset-2 hover:underline"
              >
                Retry →
              </button>
            </p>
          )}
          <Report bookId={bookId} result={state.result} onRevise={onRevise} />
        </>
      )}
    </div>
  );
}

function Report({ bookId, result, onRevise }: { bookId: number; result: EvalResult; onRevise?: (result: EvalResult, instruction?: string) => void }) {
  const { verdict, sections } = result;
  return (
    <div className="mt-5 space-y-6">
      {/* Verdict — a one-line stance headline over the editorial letter, in a tinted box.
          `stance` is a free-text headline (often a full sentence), not a short tag, so it gets
          its own full-width line rather than an inline pill that would squeeze the letter. */}
      <div className="space-y-2.5 rounded-xl bg-[hsl(var(--pv-accent))]/[0.08] p-4">
        {verdict.stance && (
          <p className="pv-mono text-[11px] font-medium uppercase leading-relaxed tracking-[0.12em] text-[hsl(var(--pv-accent))]">
            {verdict.stance}
          </p>
        )}
        <p className="pv-serif text-[15.5px] leading-relaxed text-foreground">{verdict.letter}</p>
      </div>

      {verdict.genre_contract && (
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-[120px_1fr]">
          <dt className="pv-eyebrow pt-[2px]">Genre</dt>
          <dd className="pv-serif text-[15px] text-foreground">{verdict.genre_contract}</dd>
        </dl>
      )}

      {/* Top priorities — each note becomes a one-click revision (prefills "Revise with AI"). */}
      {verdict.priorities?.length > 0 && (
        <div>
          <div className="pv-eyebrow">
            {onRevise ? "Top priorities · turn a note into a revision" : "Fix these first"}
          </div>
          <div className="mt-3 space-y-3.5">
            {verdict.priorities.map((p, i) => (
              <div key={i} className="flex gap-3">
                <span className="pv-mono shrink-0 pt-0.5 text-[12px] tabular-nums text-[hsl(var(--pv-text-faint))]">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="pv-serif text-[15px] leading-snug text-foreground">{p}</p>
                  {onRevise && (
                    <button
                      type="button"
                      onClick={() => onRevise(result, p)}
                      className="pv-mono group mt-1.5 inline-flex items-center gap-1 text-[10.5px] uppercase tracking-[0.1em] text-[hsl(var(--pv-accent))] transition-opacity hover:opacity-80"
                    >
                      Revise this{" "}
                      <span className="transition-transform group-hover:translate-x-0.5">→</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section cards */}
      <div className="space-y-1">
        {sections.map((s) => (
          <SectionCard key={s.id} bookId={bookId} section={s} />
        ))}
      </div>

      {/* The single "do it all" button, at the end of the report — hand the whole evaluation to
          the revise architect, which plans a revision across every note. Per-note "Revise this"
          stays inline above for addressing one thing at a time. */}
      {onRevise && (
        <button
          type="button"
          onClick={() => onRevise(result)}
          className="pv-mono group inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--pv-accent))] px-3.5 py-2 text-[10.5px] uppercase tracking-[0.12em] text-background transition-opacity hover:opacity-90"
        >
          Address all the editor's notes{" "}
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </button>
      )}
    </div>
  );
}

function SectionCard({ bookId, section }: { bookId: number; section: Section }) {
  const [open, setOpen] = useState(false);
  const issueCount = section.issues?.length ?? 0;
  return (
    <div className="rounded-xl border border-[hsl(var(--pv-border-soft))]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="pv-serif text-[15px] text-foreground">{section.title}</span>
        <span className="flex items-center gap-3">
          {issueCount > 0 && (
            <span className="pv-mono text-[10.5px] uppercase tracking-[0.16em] text-[hsl(var(--pv-text-faint))]">
              {issueCount} {issueCount === 1 ? "note" : "notes"}
            </span>
          )}
          <span className={`pv-serif text-[13px] italic ${STANCE_TONE[section.stance] ?? ""}`}>
            {section.stance}
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-[hsl(var(--pv-border-soft))] px-4 py-3">
          <p className="pv-serif text-[14.5px] leading-relaxed text-foreground">{section.assessment}</p>

          {section.strengths?.map((s, i) => (
            <p key={`st-${i}`} className="pv-serif text-[14px] leading-relaxed text-[hsl(var(--pv-text-muted))]">
              <span className="text-[hsl(var(--pv-accent))]">+ </span>
              {s}
            </p>
          ))}

          {section.issues?.map((issue, i) => (
            <div key={`is-${i}`} className="pv-serif text-[14px] leading-relaxed">
              <p className="text-foreground">
                <span className={`${SEV_TONE[issue.severity]} font-medium`}>
                  {SEV_MARK[issue.severity]} {issue.severity}
                </span>{" "}
                — {issue.note}
              </p>
              {issue.evidence && (
                <p className="mt-0.5 italic text-[hsl(var(--pv-text-muted))]">“{issue.evidence}”</p>
              )}
              {issue.suggestion && (
                <p className="mt-0.5 text-[hsl(var(--pv-text-muted))]">→ {issue.suggestion}</p>
              )}
              {issue.page_ref?.id != null && (
                <Link
                  to={`/books/${bookId}/pages/${issue.page_ref.id}`}
                  className="mt-0.5 inline-block text-[13px] italic text-[hsl(var(--pv-text-faint))] underline-offset-2 hover:text-[hsl(var(--pv-text-muted))] hover:underline"
                >
                  ↪ {issue.page_ref.title}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
