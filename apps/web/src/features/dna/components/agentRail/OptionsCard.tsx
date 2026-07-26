import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { describeOps, nodeLabel } from "@/features/dna/lib/dnaChat";
import { chooseNodeProposal, discardNodeProposals } from "@/features/dna/lib/dnaProposals";
import type { DnaNode } from "@/features/dna/lib/novelDna";
import { useToast } from "@/hooks/use-toast";
import { ActionLink, Eyebrow, Panel } from "@/components/book/shared/studioUi";

// A node carrying STAGED OPTIONS (book_nodes.proposals, written by the agent's propose_options) rendered
// as a pickable card IN THE CHAT. The tree's ProposalPicker renders the same decision in place, in tree
// chrome; this is the rail-native twin so the author never has to leave the conversation to resolve what
// the agent just staged. Both call the SAME writes (dnaProposals.ts) and derive their before→after from the
// same describeOps, so a pick means exactly one thing wherever it's made.
export function OptionsCard({ node, nodes, onJump }: {
  node: DnaNode; nodes: DnaNode[]; onJump?: (id: string) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const options = node.proposals ?? [];
  if (!options.length) return null;

  const choose = async (id: string) => {
    setBusy(id);
    try { await chooseNodeProposal(node, id, nodes); } // commit + re-stale descendants + log a turn
    catch (e) {
      setBusy(null);
      toast({ title: "Couldn't use that option", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
    // On success the node's `proposals` clear over Realtime and this card unmounts — no need to reset busy.
  };
  const discard = async () => {
    setBusy("discard");
    try { await discardNodeProposals(node); }
    catch (e) {
      setBusy(null);
      toast({ title: "Couldn't discard the options", description: String((e as Error)?.message ?? e), variant: "destructive" });
    }
  };

  const note = options.find((p) => p.note)?.note;
  return (
    <Panel className="border-[hsl(var(--pv-accent))]/45 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <Eyebrow tone="accent">Pick one · {node.kind}</Eyebrow>
        <button type="button" onClick={() => void discard()} disabled={!!busy} title="Discard all options"
          className="shrink-0 text-[hsl(var(--pv-text-faint))] hover:text-foreground disabled:opacity-30">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="pv-serif mt-1.5 text-[13.5px] leading-[1.55] text-[hsl(var(--pv-text-muted))]">
        {note || `${options.length} alternatives for ${nodeLabel(node, node.kind)}.`}
      </p>

      <div className="mt-3 space-y-2.5">
        {options.map((p, i) => {
          const fields = describeOps([{ op: "edit", id: node.id, content: p.content }], nodes)[0]?.fields ?? [];
          const picking = busy === p.id;
          return (
            <div key={p.id} className="rounded-lg border border-[hsl(var(--pv-border-soft))] bg-[hsl(var(--pv-surface-2))]/30 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="pv-mono text-[9.5px] uppercase tracking-[0.12em] text-[hsl(var(--pv-accent))]">option {i + 1}</span>
                <button type="button" onClick={() => void choose(p.id)} disabled={!!busy}
                  className="pv-serif inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[12.5px] text-primary-foreground disabled:opacity-50">
                  {picking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  {picking ? "using…" : "use this"}
                </button>
              </div>
              <div className="mt-1.5 space-y-1">
                {fields.length === 0 && <p className="pv-serif text-[12px] italic text-[hsl(var(--pv-text-faint))]">(no fields)</p>}
                {fields.map((f) => (
                  <div key={f.key}>
                    <span className="pv-mono text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--pv-text-faint))]">{f.key}</span>
                    {f.old && f.old !== f.next && (
                      <p className="pv-serif text-[12px] leading-[1.45] text-[hsl(var(--pv-text-faint))] line-through decoration-[hsl(var(--pv-text-faint))]/40">{f.old}</p>
                    )}
                    <p className="pv-serif text-[12.5px] leading-[1.5] text-[hsl(var(--pv-text-muted))]">{f.next}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4">
        <ActionLink tone="faint" disabled={!!busy} onClick={() => void discard()}>{busy === "discard" ? "discarding…" : "discard all"}</ActionLink>
        {onJump && <ActionLink tone="faint" onClick={() => onJump(node.id)}>show in tree</ActionLink>}
      </div>
    </Panel>
  );
}
