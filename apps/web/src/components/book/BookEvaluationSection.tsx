import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// Two backends, env-switched:
//  - Production (default): the `evaluate-book` edge function writes a book_evaluations
//    row; we invoke it, then watch the row over Realtime for pending → done.
//  - Local dev: if VITE_EVAL_BRIDGE_URL is set, talk to scripts/eval-bridge.mjs instead
//    (runs Claude Code on your own machine, zero API cost).
const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;
const USE_BRIDGE = !!BRIDGE;

type Stance = "strong" | "solid" | "needs work";
type Severity = "high" | "medium" | "low";

interface Issue {
  severity: Severity;
  note: string;
  evidence?: string;
  suggestion?: string;
  page_ref?: { id: number | null; title: string; index: number | null } | null;
}
interface Section {
  id: string;
  title: string;
  stance: Stance;
  assessment: string;
  strengths?: string[];
  issues?: Issue[];
}
interface EvalResult {
  verdict: { genre_contract: string; stance: string; letter: string; priorities: string[] };
  sections: Section[];
}
interface EvalRow {
  id: number;
  status: "pending" | "done" | "error";
  result: EvalResult | null;
  error: string | null;
}

type State =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "running" }
  | { status: "done"; result: EvalResult }
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

export function BookEvaluationSection({ bookId }: { bookId: number }) {
  const [state, setState] = useState<State>({ status: "checking" });
  const mounted = useRef(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const cleanupChannel = () => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  };

  // Resolve a book_evaluations row into UI state (used by Realtime + the race re-check).
  const applyRow = (row: EvalRow) => {
    if (!mounted.current) return;
    if (row.status === "done" && row.result) {
      setState({ status: "done", result: row.result });
      cleanupChannel();
    } else if (row.status === "error") {
      setState({ status: "error", error: row.error || "evaluation failed" });
      cleanupChannel();
    }
    // pending → keep waiting on the channel
  };

  // Watch an in-flight evaluation row until it finishes (edge backend only).
  const watchRow = (evalId: number) => {
    cleanupChannel();
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
      .select("id, status, result, error")
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
      // Load the latest stored evaluation; resume watching if one is still running.
      supabase
        .from("book_evaluations")
        .select("id, status, result, error")
        .eq("book_id", bookId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (!mounted.current) return;
          const row = data as EvalRow | null;
          if (!row) return setState({ status: "idle" });
          if (row.status === "done" && row.result) setState({ status: "done", result: row.result });
          else if (row.status === "pending") {
            setState({ status: "running" });
            watchRow(row.id);
          } else if (row.status === "error") {
            setState({ status: "error", error: row.error || "previous evaluation failed" });
          } else setState({ status: "idle" });
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
        setState({ status: "error", error: msg });
        return;
      }
      const evalId = (data as { evaluation?: { id: number } })?.evaluation?.id;
      if (!evalId) return setState({ status: "error", error: "No evaluation was started." });
      watchRow(evalId);
    } catch (e) {
      setState({ status: "error", error: e instanceof Error ? e.message : "Evaluation failed." });
    }
  };

  const run = () => {
    setState({ status: "running" });
    return USE_BRIDGE ? runBridge() : runEdge();
  };

  return (
    <div className="mt-8 border-t border-border pt-6">
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
        <p className="pv-serif mt-3 text-[15px] italic text-[hsl(var(--pv-text-muted))]">
          The editor is reading… <span className="text-[hsl(var(--pv-text-faint))]">(~30–90s)</span>
        </p>
      )}

      {state.status === "error" && (
        <p className="pv-serif mt-3 max-w-[640px] text-[14px] leading-relaxed text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}

      {state.status === "done" && <Report bookId={bookId} result={state.result} />}
    </div>
  );
}

function Report({ bookId, result }: { bookId: number; result: EvalResult }) {
  const { verdict, sections } = result;
  return (
    <div className="mt-5 space-y-6">
      {/* Editorial letter */}
      <p className="pv-serif text-[15.5px] leading-relaxed text-foreground">{verdict.letter}</p>

      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-[120px_1fr]">
        <dt className="pv-eyebrow pt-[2px]">Genre</dt>
        <dd className="pv-serif text-[15px] text-foreground">{verdict.genre_contract}</dd>
        <dt className="pv-eyebrow pt-[2px]">Stance</dt>
        <dd className="pv-serif text-[15px] text-foreground">{verdict.stance}</dd>
      </dl>

      {verdict.priorities?.length > 0 && (
        <div>
          <div className="pv-eyebrow">Fix these first</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {verdict.priorities.map((p, i) => (
              <li key={i} className="pv-serif text-[15px] leading-relaxed text-foreground">
                {p}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Section cards */}
      <div className="space-y-1">
        {sections.map((s) => (
          <SectionCard key={s.id} bookId={bookId} section={s} />
        ))}
      </div>
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
