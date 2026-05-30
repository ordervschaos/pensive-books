import { useEffect, useRef, useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { EvalResult, Severity } from "./BookEvaluationSection";

// Page-level "revise just this page" surface. Reuses generate-unit's revise mode (the same
// backend the book-level ReviseWithAI cascade drives), scoped to one page: it feeds the
// editor's page-anchored notes (+ an optional author instruction) and shows the proposed
// prose as a diff the author can edit before applying. Same dual backend as the other AI
// features: local bridge in dev, edge in prod.
const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;

// Mirrors generate-unit's ReviseIssue (and ReviseWithAI's FixIssue): one editorial note.
interface ReviseIssue {
  section: string;
  severity: Severity;
  note: string;
  evidence?: string;
  suggestion?: string;
}

interface Props {
  bookId: number;
  pageId: number;
  /** Page objective (author-only); passed as revise context when present. */
  pageObjective: string | null;
  /** Current page prose as plain text — the "before" side of the diff. */
  currentText: string;
  /** Accept handler: host applies the (possibly edited) prose to the live editor. */
  onApply: (prose: string) => void;
}

type State =
  | { status: "idle" }
  | { status: "running" }
  | { status: "preview"; proposed: string }
  | { status: "error"; error: string };

const SEV_TONE: Record<Severity, string> = {
  high: "text-red-600 dark:text-red-400",
  medium: "text-amber-600 dark:text-amber-500",
  low: "text-[hsl(var(--pv-text-faint))]",
};

// Pull this page's notes out of a stored evaluation (issues are anchored by page_ref.id).
function notesForPage(result: EvalResult, pageId: number): ReviseIssue[] {
  const out: ReviseIssue[] = [];
  for (const section of result.sections ?? []) {
    for (const issue of section.issues ?? []) {
      if (issue.page_ref?.id !== pageId) continue;
      out.push({
        section: section.title,
        severity: issue.severity,
        note: issue.note,
        evidence: issue.evidence,
        suggestion: issue.suggestion,
      });
    }
  }
  return out;
}

const diffStyles = {
  variables: {
    light: {
      diffViewerBackground: "transparent",
      addedBackground: "#d1fae5",
      addedColor: "#065f46",
      removedBackground: "#fee2e2",
      removedColor: "#991b1b",
      wordAddedBackground: "#86efac",
      wordRemovedBackground: "#fca5a5",
      gutterBackground: "transparent",
    },
  },
};

export function RevisePageWithAI({ bookId, pageId, pageObjective, currentText, onApply }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<ReviseIssue[]>([]);
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const mounted = useRef(true);

  // Load this page's notes from the latest completed evaluation (if any). Reset on page
  // change. Same dual backend as BookEvaluationSection: the local bridge stores reports on
  // disk (not in book_evaluations), so in bridge mode we must read from it, not the table.
  useEffect(() => {
    mounted.current = true;
    setNotes([]);
    setInstruction("");
    setState({ status: "idle" });
    setOpen(false);

    const apply = (result: EvalResult | null) => {
      if (mounted.current && result) setNotes(notesForPage(result, pageId));
    };

    if (BRIDGE) {
      fetch(`${BRIDGE}/eval/${bookId}`)
        .then((r) => r.json())
        .then((d) => apply(d?.status === "done" ? (d.result as EvalResult) : null))
        .catch(() => {/* no notes available */});
    } else {
      supabase
        .from("book_evaluations")
        .select("result")
        .eq("book_id", bookId)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => apply((data?.result as EvalResult | null) ?? null));
    }

    return () => {
      mounted.current = false;
    };
  }, [bookId, pageId]);

  const hasProse = currentText.trim().length > 0;

  const propose = async () => {
    // Assemble the notes to address: the editor's page notes + an optional author
    // instruction; if neither exists, fall back to a general polish note (revise mode
    // requires at least one note) — mirrors ReviseWithAI's synthetic-note behaviour.
    const issues: ReviseIssue[] = [...notes];
    const instr = instruction.trim();
    if (instr) issues.push({ section: "Author instruction", severity: "high", note: instr });
    if (issues.length === 0) {
      issues.push({
        section: "Polish",
        severity: "low",
        note: "Tighten and polish this page: sharpen the prose, cut redundancy, and improve flow without changing what happens.",
      });
    }

    setState({ status: "running" });
    try {
      const body: Record<string, unknown> = {
        bookId,
        pageId,
        level: "page",
        mode: "revise",
        objective: pageObjective ?? "",
        issues,
      };
      let text: string;
      if (BRIDGE) {
        const r = await fetch(`${BRIDGE}/unit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
        text = String(d.text ?? "").trim();
      } else {
        const { data, error } = await supabase.functions.invoke("generate-unit", { body });
        if (error) throw error;
        text = String((data as { text?: string })?.text ?? "").trim();
      }
      if (!text) throw new Error("The editor returned no revision.");
      if (mounted.current) setState({ status: "preview", proposed: text });
    } catch (e) {
      if (mounted.current) setState({ status: "error", error: String((e as Error)?.message ?? e) });
    }
  };

  const apply = () => {
    if (state.status !== "preview") return;
    onApply(state.proposed);
    toast({ title: "Revision applied", description: "Review the page and save when you're happy with it." });
    setState({ status: "idle" });
    setInstruction("");
    setOpen(false);
  };

  return (
    <div className="mx-8 mt-2 mb-6 border-t border-[hsl(var(--pv-border-soft))] pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="pv-eyebrow">
          Revise this page ·{" "}
          <span className="pv-serif text-[13px] normal-case not-italic tracking-normal text-[hsl(var(--pv-text-muted))]">
            AI · author only
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          {open ? "Hide" : notes.length ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} →` : "Open →"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {/* The editor's notes for this page, if an evaluation has flagged it. */}
          {notes.length > 0 ? (
            <div className="space-y-2">
              <div className="pv-eyebrow">The editor's notes on this page</div>
              {notes.map((n, i) => (
                <div key={i} className="pv-serif text-[14px] leading-relaxed">
                  <p className="text-foreground">
                    <span className={`${SEV_TONE[n.severity]} font-medium`}>{n.severity}</span>{" "}
                    <span className="text-[hsl(var(--pv-text-faint))]">({n.section})</span> — {n.note}
                  </p>
                  {n.suggestion && <p className="mt-0.5 text-[hsl(var(--pv-text-muted))]">→ {n.suggestion}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="pv-serif text-[14px] italic leading-relaxed text-[hsl(var(--pv-text-muted))]">
              No editor's notes flag this page. You can still give an instruction below, or revise to
              polish.
            </p>
          )}

          {/* Optional free-text instruction layered on top of (or instead of) the notes. */}
          {state.status !== "preview" && (
            <div className="space-y-2">
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Optional: tell the editor what to focus on for this page…"
                className="min-h-[64px] text-[14px]"
                disabled={state.status === "running"}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={propose}
                  disabled={!hasProse || state.status === "running"}
                  className="pv-serif inline-flex items-center gap-2 text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {state.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {state.status === "running" ? "The editor is revising…" : "Propose a revision →"}
                </button>
                {!hasProse && (
                  <span className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))]">
                    Write some prose first.
                  </span>
                )}
              </div>
            </div>
          )}

          {state.status === "error" && (
            <p className="pv-serif text-[14px] leading-relaxed text-red-600 dark:text-red-400">{state.error}</p>
          )}

          {/* Diff + editable proposal: the author can tweak the prose before applying. */}
          {state.status === "preview" && (
            <div className="space-y-3">
              <div className="pv-eyebrow">Proposed changes</div>
              <div className="overflow-x-auto rounded-lg border border-[hsl(var(--pv-border-soft))] text-[13px]">
                <ReactDiffViewer
                  oldValue={currentText}
                  newValue={state.proposed}
                  splitView={false}
                  compareMethod={DiffMethod.WORDS}
                  useDarkTheme={false}
                  styles={diffStyles}
                  hideLineNumbers
                  showDiffOnly={false}
                />
              </div>

              <div className="space-y-1.5">
                <div className="pv-eyebrow">Edit before applying</div>
                <Textarea
                  value={state.proposed}
                  onChange={(e) => setState({ status: "preview", proposed: e.target.value })}
                  className="min-h-[200px] pv-serif text-[14.5px] leading-relaxed"
                />
              </div>

              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={apply}
                  disabled={!state.proposed.trim()}
                  className="pv-serif text-[14px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50"
                >
                  Apply to page →
                </button>
                <button
                  type="button"
                  onClick={propose}
                  className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
                >
                  Re-propose
                </button>
                <button
                  type="button"
                  onClick={() => setState({ status: "idle" })}
                  className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-faint))] transition-colors hover:text-foreground"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
