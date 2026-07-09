// useAutoAccept — the client half of the agent's auto-accept mode, and the engine of the LIVE apply loop.
// When the author arms "auto" in the rail, the agent makes ONE change per turn and idles; this hook applies
// that change to the tree immediately (reusing the exact manual path — applyAgentProposal / chooseNodeProposal),
// then RESUMES the run (continueAgent) so the agent's next turn reads the freshly-updated tree. Repeat until
// the agent finishes. So each change is visible before the next is proposed — true live application, with the
// write logic staying client-side (no server-side duplication of the engine). It also auto-answers a stray
// parked question (answerAgent), though autonomous mode normally prevents asking.
//
// It only ever acts while the thread is QUIESCENT (idle / awaiting_input) — never mid-turn, when the edge fn
// owns the row. A single-flight ref serialises actions; a skip-set claims each item exactly once (so a stale
// snapshot can't re-apply an `add` and duplicate nodes, and a poison item can't hot-loop). The autonomous
// instruction is bounded by the run's MAX_TURNS server-side (continueAgent doesn't reset the turn budget).
import { useEffect, useRef } from "react";
import { applyAgentProposal, answerAgent, continueAgent, discardAgentProposal, type AgentProposal, type AgentThreadRow } from "@/features/dna/lib/agentThread";
import { chooseNodeProposal } from "@/features/dna/lib/dnaProposals";
import type { DnaNode } from "@/features/dna/lib/novelDna";

const AUTO_ANSWER =
  "I'm away — auto-accept mode is on, so I can't answer. Make the strongest creative call yourself and keep going.";

export function useAutoAccept({ enabled, bookId, row, nodes, refetch, onApplyingChange, abortRef }: {
  enabled: boolean;
  bookId: number;
  row: AgentThreadRow | null | undefined;
  nodes: DnaNode[];
  refetch: () => void;
  // Mirrors the manual apply path's applyingId/abort-controller state up into the rail so a card being
  // applied BY THE WATCHER shows the same live "applying"/Stop feedback as a manual click — otherwise an
  // autonomous expansion/render runs silently for minutes with the card reading as idle (looks stuck).
  onApplyingChange?: (id: string | null) => void;
  abortRef?: { current: AbortController | null };
}): void {
  const busy = useRef(false);
  const skip = useRef<Set<string>>(new Set()); // ids that errored once — don't retry forever

  useEffect(() => {
    if (!enabled || !row || busy.current) return;
    if (row.status === "running") return; // the edge fn is driving — keep hands off

    const proposals = (Array.isArray(row.proposals) ? row.proposals : []).filter((p) => !skip.current.has(p.id)) as AgentProposal[];
    // A node carrying staged options the agent left behind (e.g. propose_options before auto was armed).
    // Key options by the staged set's first id (fresh on every (re)generation) so a later regenerate on the
    // SAME node isn't permanently skipped by its node id.
    const optKey = (n: DnaNode) => `opt:${n.id}:${n.proposals![0].id}`;
    const optionNode = nodes.find((n) => Array.isArray(n.proposals) && n.proposals.length > 0 && !skip.current.has(optKey(n)));

    let key: string;
    let run: () => Promise<unknown>;
    if (row.status === "awaiting_input" && row.pending) {
      // A parked question: unblock it. (In true auto mode the agent never asks; this catches a run that was
      // already parked when auto was armed, or a model that ignored the no-ask instruction.)
      key = `ask:${row.id}:${row.pending.question}`;
      if (skip.current.has(key)) return;
      run = () => answerAgent(row.id, AUTO_ANSWER);
    } else if (row.status === "idle" && proposals.length) {
      // A staged proposal (the agent's own edit OR an engine generation routed through the thread): apply it
      // LIVE, then ALWAYS resume the run so the agent's next turn sees the updated tree. Crucially, resume
      // even if the apply fails — otherwise a single un-appliable proposal leaves the run idle-stuck forever
      // (the watchdog only revives 'running'). A hard failure → discard it (a discarded card) so the agent
      // isn't re-confronted with the same bad change, then continue.
      const p = proposals[0];
      const all = (row.proposals ?? []) as AgentProposal[];
      key = p.id;
      run = async () => {
        // A render/engine apply streams in the browser and can hang indefinitely on a dead worker.
        // An un-settled apply never releases `busy`, which kills the watcher for the life of the
        // page — so abort on a deadline; the apply promise must ALWAYS settle.
        const ctrl = new AbortController();
        if (abortRef) abortRef.current = ctrl;
        onApplyingChange?.(p.id);
        const deadline = window.setTimeout(() => ctrl.abort(), p.layer === "prose-render" ? 6 * 60_000 : 3 * 60_000);
        try { await applyAgentProposal(bookId, row.id, p, all, nodes, ctrl.signal); }
        catch { await discardAgentProposal(row.id, p.id, all).catch(() => {}); }
        finally {
          window.clearTimeout(deadline);
          if (abortRef) abortRef.current = null;
          onApplyingChange?.(null);
          await continueAgent(row.id).catch(() => {});
        }
      };
    } else if (row.status === "idle" && optionNode) {
      // Staged options the author would pick among: commit the first, then resume the run (the edge case
      // where the agent staged options in autonomous mode).
      const props = optionNode.proposals!;
      const pick = props[0];
      key = optKey(optionNode);
      run = async () => {
        try { await chooseNodeProposal(optionNode, pick.id, nodes); } catch { /* leave for the human */ }
        finally { await continueAgent(row.id).catch(() => {}); }
      };
    } else {
      return; // nothing to auto-accept
    }

    // Claim this item up front (exactly-once): a stale row can re-present an already-applied proposal before
    // its removal lands over Realtime — re-running an `add` op would duplicate nodes. A failed item stays
    // claimed too, so we leave it for the human rather than spinning on it.
    skip.current.add(key);
    busy.current = true;
    void run()
      .catch(() => { /* claimed above; left for the human */ })
      .finally(() => { busy.current = false; refetch(); });
  }, [enabled, bookId, row, nodes, refetch]);
}
