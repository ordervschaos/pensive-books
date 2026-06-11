// ladder-ui — the shared UI grammar for the resolution ladder (brief → spine → objective → beat →
// prose). The page workshop and the resolution-map node sheet use the SAME controls so the two
// operations read identically wherever a node is edited:
//
//   RE-CREATE (the Connector, ↓/↑) — regenerate a node from a neighbour. REPLACES the content.
//   REVISE    (the NodeReviser, ✎) — nudge a node with an instruction. PRESERVES, shows a diff.
//
// Kept here (not in PageWorkshop) so the map's NodeEditor doesn't re-implement them.
import { useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Loader2, Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

// The before→after diff palette, shared by every node-scale reviser + the prose diff.
export const diffStyles = {
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

// A layer label — readable (muted, not faint) and short. A panel header carries "author only" once,
// so the per-layer labels don't repeat it.
export function NodeLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="pv-mono text-[10.5px] uppercase tracking-[0.14em] text-[hsl(var(--pv-text-muted))]">
      {children}
    </span>
  );
}

// The ✎ Revise affordance, consistent across nodes: a small button with a clear target.
export function ReviseButton({ onClick, label = "Revise", title, disabled }: { onClick: () => void; label?: string; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title ?? "Revise — keeps what's here, applies your change"}
      className="pv-serif inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[13px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:bg-[hsl(var(--pv-surface-2))] hover:text-foreground disabled:opacity-50"
    >
      ✎ {label}
    </button>
  );
}

// A re-create control between two layers. Both directions REPLACE their target; the arrow shows the
// direction (↓ expand from above, ↑ distill from below). One verb — "re-create" — so the operation
// reads the same both ways, distinct from the per-node ✎ Revise (which preserves).
export interface RecreateAction { label: string; onClick: () => void; disabled?: boolean; busy?: boolean }

// One re-create button. Exported so the map's single-node sheet uses the same affordance as the
// page workshop's between-layers Connector. ↓ = pull from the parent above; ↑ = pull from the child
// below. Both REPLACE the target.
export function RecreateButton({ dir, action }: { dir: "down" | "up"; action: RecreateAction }) {
  return (
    <button
      type="button" onClick={action.onClick} disabled={action.disabled}
      title={dir === "down" ? "Re-create from the layer above — replaces this" : "Re-create from the layer below — replaces this"}
      className="pv-serif inline-flex items-center gap-1 text-[13px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50"
    >
      {action.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      {dir === "down" ? "↓" : "↑"} {action.label}
    </button>
  );
}

export function Connector({ down, up }: { down: RecreateAction; up?: RecreateAction }) {
  return (
    <div className="my-3 flex items-center gap-3">
      <div className="h-px flex-1 bg-[hsl(var(--pv-border-soft))]" />
      <RecreateButton dir="down" action={down} />
      {up && (
        <>
          <span className="text-[hsl(var(--pv-border-soft))]">·</span>
          <RecreateButton dir="up" action={up} />
        </>
      )}
      <div className="h-px flex-1 bg-[hsl(var(--pv-border-soft))]" />
    </div>
  );
}

// A reusable diff-based reviser for a SHORT node (spine / objective / beat): the author types an
// instruction, the AI proposes a revision (preserving the rest), and the change lands as a
// before→after diff to accept or reject. Mirrors the prose revise flow's gate, at node scale.
export function NodeReviser({
  current, busy, onRevise, onAccept, inline, buttonLabel,
}: {
  current: string;
  busy: boolean;
  onRevise: (instruction: string) => Promise<string>; // returns the proposed text
  onAccept: (proposed: string) => Promise<void>;
  /** Show the prompt immediately (no closed-state button). */
  inline?: boolean;
  buttonLabel?: string;
}) {
  const [open, setOpen] = useState(inline ?? false);
  const [instruction, setInstruction] = useState("");
  const [proposed, setProposed] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const run = async () => {
    if (!instruction.trim() || working) return;
    setWorking(true);
    try { setProposed(await onRevise(instruction.trim())); }
    finally { setWorking(false); }
  };
  const accept = async () => {
    if (proposed == null) return;
    setWorking(true);
    try { await onAccept(proposed); setOpen(false); setProposed(null); setInstruction(""); }
    finally { setWorking(false); }
  };
  const reset = () => { setOpen(false); setProposed(null); setInstruction(""); };

  if (!open && !inline) {
    return <ReviseButton onClick={() => setOpen(true)} disabled={busy} label={buttonLabel} />;
  }
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 p-3">
      {proposed == null ? (
        <>
          <Textarea
            value={instruction} onChange={(e) => setInstruction(e.target.value)} autoFocus
            placeholder="What should change? e.g. “make it colder, less wistful” — the rest is preserved."
            className="min-h-[56px] text-[13.5px]" disabled={working}
          />
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void run()} disabled={working || !instruction.trim()}
              className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50">
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {working ? "Revising…" : "Revise →"}
            </button>
            <button type="button" onClick={reset} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-[hsl(var(--pv-border-soft))] text-[13px]">
            <ReactDiffViewer oldValue={current} newValue={proposed} splitView={false}
              compareMethod={DiffMethod.WORDS} useDarkTheme={false} styles={diffStyles} hideLineNumbers showDiffOnly={false} />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void accept()} disabled={working}
              className="pv-serif inline-flex items-center gap-1.5 text-[13.5px] italic text-[hsl(var(--pv-accent))] transition-colors hover:text-foreground disabled:opacity-50">
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Accept →
            </button>
            <button type="button" onClick={() => setProposed(null)} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-muted))] hover:text-foreground">Re-do</button>
            <button type="button" onClick={reset} className="pv-serif text-[13px] italic text-[hsl(var(--pv-text-faint))] hover:text-foreground">Discard</button>
          </div>
        </>
      )}
    </div>
  );
}
