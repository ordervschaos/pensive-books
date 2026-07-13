import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { humanizeNodeRefs, nodeLabel } from "@/features/dna/lib/dnaChat";
import { byId, type DnaNode } from "@/features/dna/lib/novelDna";
import type { AgentStep } from "@/features/dna/lib/agentThread";
import { DiffRows } from "./DiffRows";
import { opLine } from "./opSummary";

// A resolved proposal kept in the chat for context: a collapsed one-line summary (✓ applied / ✕ discarded)
// that expands to the list of changes. Mirrors ProposalCard's look but read-only — the change already landed.
export function ResolvedCard({ step, nodes }: { step: AgentStep; nodes: DnaNode[] }) {
  const [open, setOpen] = useState(false);
  const applied = step.t === "applied";
  const ops = step.ops ?? [];
  // `diff` is the before/after frozen at apply time (describeOps run against the pre-apply tree) — present on
  // steps written after this landed. Older steps (or a discard, which never mutated anything) fall back to the
  // flat op-line summary below, which is all that's available for them.
  const diff = step.diff ?? [];
  // A prose-render step never carries ops (the change is a browser-streamed render, not a node op) — its
  // detail is which scene(s) + the brief that rode into that render, so the card has something to show.
  const isProseRender = !!step.sceneIds?.length;
  const index = byId(nodes);
  const scenes = isProseRender ? step.sceneIds!.map((id) => index.get(id)).filter((n): n is DnaNode => !!n) : [];
  const hasDetail = isProseRender ? scenes.length > 0 || !!step.brief || !!step.renderedProse : diff.length > 0 || ops.length > 0;
  return (
    <div className={`rounded-xl border px-3 py-2 ${applied ? "border-emerald-600/30 bg-emerald-600/[0.04]" : "border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30"}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        {applied
          ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          : <X className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-faint))]" />}
        <span className="pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">{applied ? "applied" : "discarded"}</span>
        <span className={`flex-1 pv-serif text-[12.5px] text-[hsl(var(--pv-text-muted))] ${open ? "whitespace-normal break-words" : "truncate"}`}>{humanizeNodeRefs(step.label, index)}</span>
        {hasDetail && <ChevronDown className={`h-3 w-3 shrink-0 text-[hsl(var(--pv-text-faint))] transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && isProseRender && (
        <div className="mt-2 space-y-1.5 border-t border-[hsl(var(--pv-border-soft))]/50 pt-2">
          {scenes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scenes.map((n) => (
                <span key={n.id} className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--pv-border-soft))] bg-background px-2 py-0.5 pv-serif text-[11.5px] text-foreground">
                  <span className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-accent))]">scene</span>
                  <span className="max-w-[170px] truncate">{nodeLabel(n)}</span>
                </span>
              ))}
            </div>
          )}
          {step.renderedProse && Object.entries(step.renderedProse).map(([id, text]) => (
            <div key={id} className="rounded-md border border-emerald-600/25 bg-emerald-600/[0.04] px-2.5 py-2">
              <p className="pv-mono text-[9px] uppercase tracking-[0.08em] text-emerald-600">what got written{scenes.length > 1 && index.get(id) ? ` — ${nodeLabel(index.get(id)!)}` : ""}</p>
              <p className="pv-serif mt-1 text-[12.5px] leading-[1.55] text-foreground whitespace-pre-wrap">{text}</p>
            </div>
          ))}
          {step.brief?.focus && <p className="pv-serif text-[11.5px] leading-[1.45] text-[hsl(var(--pv-text-muted))]">{step.brief.focus}</p>}
          {step.brief?.mustHonor?.map((x, i) => (
            <p key={`h${i}`} className="pv-serif text-[11px] leading-[1.45] text-[hsl(var(--pv-text-faint))]">↳ {x}</p>
          ))}
          {step.brief?.avoid?.map((x, i) => (
            <p key={`a${i}`} className="pv-serif text-[11px] leading-[1.45] text-[hsl(var(--pv-text-faint))]">✕ {x}</p>
          ))}
          {!step.brief && scenes.length === 0 && !step.renderedProse && (
            <p className="pv-serif text-[11px] italic leading-[1.45] text-[hsl(var(--pv-text-faint))]">No brief was attached to this render.</p>
          )}
        </div>
      )}
      {open && !isProseRender && diff.length > 0 && (
        <div className="mt-2 border-t border-[hsl(var(--pv-border-soft))]/50 pt-2">
          <DiffRows rows={diff} />
        </div>
      )}
      {open && !isProseRender && diff.length === 0 && ops.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-[hsl(var(--pv-border-soft))]/50 pt-2">
          {ops.map((op, i) => (
            <li key={i} className="pv-mono text-[10.5px] leading-snug text-[hsl(var(--pv-text-faint))]">· {opLine(op)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
