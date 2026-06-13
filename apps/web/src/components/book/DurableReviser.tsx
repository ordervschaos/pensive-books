// DurableReviser — the inline "revise a short node with an instruction" panel, backed by a durable
// ai-run row (kind 'node_revise'). Like DurableOptions, the run lives server-side: navigate away and
// back, or refresh, and an in-flight revision or an un-accepted proposal is still here.
//
// States (no modal — inline under the field):
//   idle    → "revise →"
//   prompt  → an instruction textarea + Revise / Cancel
//   running → "Revising…" + Cancel (abandon)
//   ready   → the before→after diff + Accept / Re-do / Discard
//   error   → the message + Try again
import { useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useAIRun } from "@/hooks/useAIRun";
import { diffStyles } from "./ladder-ui";
import type { NodeLayer } from "@/lib/ladder";

interface DurableReviserProps {
  bookId: number;
  layer: NodeLayer;
  /** Stable key so the run reattaches (e.g. "revise:spine", "revise:beat:123"). */
  targetKey: string;
  targetPageId?: number;
  /** The live node text (the "before" side, and what's sent for revision). */
  current: string;
  /** Persist the accepted revision; the panel then marks the run applied and closes. */
  onApply: (text: string) => Promise<void>;
  busy?: boolean;
  label?: string;
  inline?: boolean;
}

export function DurableReviser({ bookId, layer, targetKey, targetPageId, current, onApply, busy, label = "revise →", inline }: DurableReviserProps) {
  // Keyed by targetKey alone (unique per page+layer); targetPageId only rides along as a worker param.
  const { run, starting, start, accept, reject, cancel } = useAIRun<{ text: string }>({ bookId, kind: "node_revise", targetKey });
  const [open, setOpen] = useState(inline ?? false);
  const [instruction, setInstruction] = useState("");

  const running = run?.status === "running" || run?.status === "pending" || starting;
  const ready = run?.status === "ready";
  const errored = run?.status === "error";
  const proposed = run?.result?.text ?? null;
  // Diff against the text as it was when the run started (survives later edits), else the live text.
  const before = (run?.input as { current?: string } | null)?.current ?? current;

  const close = () => { setOpen(false); setInstruction(""); };
  const run_ = () => { if (instruction.trim()) void start({ layer, current, instruction: instruction.trim(), pageId: targetPageId }); };

  // Idle: no live run and not open → the trigger.
  if (!open && !run) {
    return (
      <button type="button" onClick={() => setOpen(true)} disabled={busy}
        className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-[hsl(var(--pv-accent))] disabled:opacity-50">
        {label}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 p-3">
      {errored && <p className="pv-serif text-[12.5px] italic text-red-600 dark:text-red-400">{run?.error ?? "Something went wrong."}</p>}

      {running ? (
        <div className="flex items-center gap-3">
          <p className="pv-serif inline-flex items-center gap-2 text-[13.5px] italic text-[hsl(var(--pv-text-muted))]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Revising…
          </p>
          <button type="button" onClick={() => void cancel()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">cancel</button>
        </div>
      ) : ready && proposed != null ? (
        <>
          <div className="overflow-x-auto rounded border border-[hsl(var(--pv-border-soft))] text-[13px]">
            <ReactDiffViewer oldValue={before} newValue={proposed} splitView={false}
              compareMethod={DiffMethod.WORDS} useDarkTheme={false} styles={diffStyles} hideLineNumbers showDiffOnly={false} />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void accept(async (r) => { await onApply(r.text); close(); })}
              className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground">
              Accept →
            </button>
            <button type="button" onClick={() => void reject()} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">Re-do</button>
            <button type="button" onClick={() => { void reject(); close(); }} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">Discard</button>
          </div>
        </>
      ) : errored ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={run_} className="pv-serif text-[13px] italic text-[hsl(var(--pv-accent))] hover:opacity-75">Try again →</button>
          <button type="button" onClick={() => { void reject(); close(); }} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">Cancel</button>
        </div>
      ) : (
        // prompt state (no live run): collect the instruction.
        <>
          <Textarea
            value={instruction} onChange={(e) => setInstruction(e.target.value)} autoFocus
            placeholder='What should change? e.g. "make it colder, less wistful"'
            className="min-h-[72px] text-[13.5px]"
          />
          <div className="flex items-center gap-3">
            <button type="button" onClick={run_} disabled={!instruction.trim()}
              className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50">
              Apply →
            </button>
            <button type="button" onClick={close} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
