import { useMemo } from "react";
import { BookOpen, NotebookPen, Sparkles, ArrowRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { humanizeNodeRefs } from "@/features/dna/lib/dnaChat";
import { byId, type DnaNode } from "@/features/dna/lib/novelDna";
import type { AgentStep } from "@/features/dna/lib/agentThread";
import { ResolvedCard } from "./ResolvedCard";

// One step rendered as a chat element: author messages/answers → right bubble; the agent's reply and
// questions → prose; a page-read → a muted activity line.
export function StepBubble({ step, nodes, onJump }: { step: AgentStep; nodes: DnaNode[]; onJump?: (id: string) => void }) {
  const index = useMemo(() => byId(nodes), [nodes]);
  // A 'plan' step that staged options ON a node. The picker itself now renders in the feed (OptionsCard), so
  // this is the historical marker: a clickable card that jumps to (and reveals) the node in the tree, for
  // when the author wants to see the choice in its structural place rather than in the conversation.
  if (step.t === "plan" && step.nodeId && onJump && index.get(step.nodeId)) {
    const targetId = step.nodeId;
    return (
      <button
        type="button"
        onClick={() => onJump(targetId)}
        className="group flex w-full items-center gap-2.5 rounded-xl border border-[hsl(var(--pv-accent))]/30 bg-[hsl(var(--pv-accent))]/[0.05] px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--pv-accent))]/[0.09]"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-accent))]" />
        <span className="pv-serif flex-1 text-[13px] leading-[1.45] text-[hsl(var(--pv-text-muted))]">{step.label}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-accent))] transition-transform group-hover:translate-x-0.5" />
      </button>
    );
  }
  if (step.t === "user" || step.t === "answer") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[hsl(var(--pv-surface-2))] px-3.5 py-2 pv-serif text-[14px] leading-[1.55] text-foreground whitespace-pre-wrap">
          {step.label}
        </div>
      </div>
    );
  }
  if (step.t === "read") {
    return (
      <p className="inline-flex items-center gap-1.5 pv-serif text-[12.5px] italic text-[hsl(var(--pv-text-faint))]">
        <BookOpen className="h-3 w-3" /> {step.label}
      </p>
    );
  }
  // finding — fold-on-read: what the agent banked from its reads. Shown because it's the honest record of
  // what the run actually LEARNED (the 'read' lines above only say it looked), and because a wrong finding
  // explains a later wrong edit. Muted like a read line: activity, not conversation.
  if (step.t === "finding") {
    const items = step.findings ?? [];
    if (!items.length) return null;
    return (
      <div className="flex flex-col gap-1">
        <p className="inline-flex items-center gap-1.5 pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-text-faint))]">
          <NotebookPen className="h-3 w-3" /> noted
        </p>
        <div className="flex flex-col gap-1 border-l border-[hsl(var(--pv-border))] pl-2.5">
          {items.map((f, i) => (
            <p key={i} className="pv-serif text-[12.5px] leading-[1.45] text-[hsl(var(--pv-text-faint))]">
              {f.ref && <span className="text-[hsl(var(--pv-text-muted))]">{humanizeNodeRefs(f.ref, index)} — </span>}
              {humanizeNodeRefs(f.finding, index)}
            </p>
          ))}
        </div>
      </div>
    );
  }
  if (step.t === "applied" || step.t === "discarded") return <ResolvedCard step={step} nodes={nodes} />;
  // decision — an auto-mode creative fork the agent journaled via ask_author (question + the options it
  // weighed; its pick is stated in the question text). Kept in the feed so the author can revisit every
  // fork after an autonomous run, in order.
  if (step.t === "decision") {
    return (
      <div className="rounded-xl border border-[hsl(var(--pv-accent))]/25 bg-[hsl(var(--pv-accent))]/[0.04] px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="pv-mono shrink-0 text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">⑂ fork</span>
          <span className="pv-serif text-[12.5px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">{humanizeNodeRefs(step.label, index)}</span>
        </div>
        {(step.options ?? []).length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1 pl-1">
            {step.options!.map((opt, i) => (
              <p key={i} className="pv-serif text-[11.5px] leading-[1.45] text-[hsl(var(--pv-text-faint))]">· {opt}</p>
            ))}
          </div>
        )}
      </div>
    );
  }
  // note / ask / done — the agent speaking. Rehydrate any bare node-id references into human labels first.
  return (
    <div className="max-w-[92%] pv-serif text-[14.5px] leading-[1.62] text-[hsl(var(--pv-text-muted))] prose prose-sm max-w-none prose-p:my-2 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-headings:text-foreground prose-strong:text-foreground prose-strong:font-semibold prose-code:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {humanizeNodeRefs(step.label, index)}
      </ReactMarkdown>
    </div>
  );
}
