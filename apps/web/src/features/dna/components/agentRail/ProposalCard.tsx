import { Check, Loader2, Square, X } from "lucide-react";
import { describeOps, humanizeNodeRefs, nodeLabel } from "@/features/dna/lib/dnaChat";
import { byId, type DnaNode } from "@/features/dna/lib/novelDna";
import { ActionLink, Eyebrow, Panel } from "@/components/book/shared/studioUi";
import type { AgentProposal } from "@/features/dna/lib/agentThread";
import { DiffRows } from "./DiffRows";

// A reviewable proposal the agent made — the verify step. Renders the DNA node-op diff (describeOps,
// shared with the per-stage chat) and Apply/Discard; Apply runs the ops against book_nodes.
export function ProposalCard({ proposal, nodes, applying, onApply, onDiscard, onStop }: {
  proposal: AgentProposal; nodes: DnaNode[]; applying: boolean; onApply: () => void; onDiscard: () => void; onStop: () => void;
}) {
  const isProseRender = proposal.layer === "prose-render";
  const isExpansion = proposal.layer === "expansion";
  // Only these two layers run a real, abortable browser-side generation — Stop actually cancels it (the
  // proposal stays staged, unresolved). Plain 'dna' ops apply instantly, so there's nothing to stop.
  const isAbortable = isProseRender || isExpansion;
  const index = byId(nodes);
  const scenes = isProseRender ? (proposal.sceneIds ?? []).map((id) => index.get(id)).filter((n): n is DnaNode => !!n) : [];
  const rows = isProseRender || isExpansion ? [] : describeOps(proposal.ops, nodes);
  const hasBrief = !!proposal.brief && (!!proposal.brief.focus || !!proposal.brief.mustHonor?.length || !!proposal.brief.avoid?.length);
  const briefBlock = hasBrief && (
    <div className="rounded-md border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 px-2.5 py-2 space-y-1">
      <p className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-accent))]">{isExpansion ? "your steering" : "agent's brief"}</p>
      {proposal.brief?.focus && <p className="pv-serif text-[12px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">{proposal.brief.focus}</p>}
      {proposal.brief?.mustHonor?.map((x, i) => (
        <p key={`h${i}`} className="pv-serif text-[12px] leading-[1.5] text-[hsl(var(--pv-text-faint))]">↳ {x}</p>
      ))}
      {proposal.brief?.avoid?.map((x, i) => (
        <p key={`a${i}`} className="pv-serif text-[12px] leading-[1.5] text-[hsl(var(--pv-text-faint))]">✕ {x}</p>
      ))}
    </div>
  );
  return (
    <Panel className="border-[hsl(var(--pv-accent))]/45 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <Eyebrow tone="accent">{isProseRender ? "Render prose" : isExpansion ? "Run the engine" : "Proposed change"}</Eyebrow>
        <button type="button" onClick={onDiscard} disabled={applying} title={applying ? "Stop the run to discard" : "Discard"}
          className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground disabled:opacity-30 disabled:hover:text-[hsl(var(--pv-text-faint))]"><X className="h-4 w-4" /></button>
      </div>
      {proposal.summary && <p className="pv-serif mt-1.5 text-[13.5px] leading-[1.55] text-[hsl(var(--pv-text-muted))]">{humanizeNodeRefs(proposal.summary, index)}</p>}
      {isProseRender ? (
        <div className="mt-3 space-y-2">
          <p className="pv-serif text-[12px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">
            Applying streams fresh prose for {scenes.length} scene{scenes.length === 1 ? "" : "s"} in your browser — in the book's voice, with full continuity. This can take a minute per scene.
          </p>
          {briefBlock}
          <div className="flex flex-wrap gap-1.5">
            {scenes.map((n) => (
              <span key={n.id} className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/40 px-2 py-0.5 pv-serif text-[12px] text-foreground">
                <span className="pv-mono text-[9px] uppercase tracking-[0.08em] text-[hsl(var(--pv-accent))]">scene</span>
                <span className="max-w-[170px] truncate">{nodeLabel(n)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : isExpansion ? (
        <div className="mt-3 space-y-2">
          <p className="pv-serif text-[12px] italic leading-[1.5] text-[hsl(var(--pv-text-faint))]">
            Applying runs the engine now in your browser and writes the result into the tree — this can take a moment.
          </p>
          {briefBlock}
        </div>
      ) : (
        <div className="mt-3">
          <DiffRows rows={rows} />
        </div>
      )}
      <div className="mt-3.5 flex items-center gap-4">
        <button type="button" onClick={applying && isAbortable ? onStop : onApply} disabled={applying && !isAbortable}
          className="pv-serif inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13.5px] text-primary-foreground disabled:opacity-50">
          {applying
            ? (isAbortable ? <Square className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />)
            : <Check className="h-3.5 w-3.5" />}
          {applying ? (isAbortable ? "Stop" : "Apply") : (isProseRender ? "Render" : isExpansion ? "Run" : "Apply")}
        </button>
        {/* discard only makes sense on a staged-but-not-running proposal — while a run is in flight, Stop
            (above) is the one way out; discarding mid-generation would race resolveProposal's write. */}
        {!applying && <ActionLink tone="faint" onClick={onDiscard}>discard</ActionLink>}
      </div>
    </Panel>
  );
}
