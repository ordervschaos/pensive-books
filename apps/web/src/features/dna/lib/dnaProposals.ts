// dnaProposals — the AUTHOR's side of the options/picker channel (book_nodes.proposals). The agent's
// propose_options tool STAGES 2–4 candidate contents onto a node; here the author commits one or discards
// them. Both register a turn on the book's agent thread (the chat is the agent's surface — docs/agent-rail.md),
// best-effort. Generating/judging options are AI calls that happen IN the agent; this side is pure local state.
import { saveNode } from "@/features/dna/lib/bookNodes";
import { byId, chooseProposal, stampInput, type DnaNode, type NodeContent } from "@/features/dna/lib/novelDna";
import { logAgentTurn } from "@/features/dna/lib/agentThread";

/** A short human handle for a node/option content (first meaningful field). */
function handleOf(content: NodeContent | undefined): string {
  const c = (content ?? {}) as Record<string, unknown>;
  const h = c.logline ?? c.name ?? c.title ?? c.controlling_idea ?? c.dramatic_question ?? c.summary ?? c.goal;
  return typeof h === "string" && h.trim() ? h.trim().slice(0, 60) : "";
}

/** Commit one staged option as the node's content: chooseProposal (content←option, clears proposals,
 *  status→accepted) + re-stamp the input hash (so the node itself reads FRESH against its parent) + persist.
 *  Its descendants now read STALE — their input set changed — ready for the author to regenerate. The pick
 *  is logged as a turn on the agent thread. `nodes` is the live tree snapshot (for the stamp's input set). */
export async function chooseNodeProposal(node: DnaNode, proposalId: string, nodes: DnaNode[]): Promise<void> {
  const chosen = node.proposals?.find((p) => p.id === proposalId);
  if (!chosen) return;
  const next = stampInput(chooseProposal(node, proposalId), byId(nodes));
  await saveNode(next);
  const h = handleOf(chosen.content);
  await logAgentTurn(node.book_id, `✓ chose a ${node.kind} option${h ? `: ${h}` : ""}`).catch(() => {});
}

/** Drop all staged options without committing any (the node keeps its current content). Logs a turn. */
export async function discardNodeProposals(node: DnaNode): Promise<void> {
  if (!node.proposals?.length) return;
  await saveNode({ ...node, proposals: undefined });
  await logAgentTurn(node.book_id, `✕ discarded ${node.proposals.length} ${node.kind} options`).catch(() => {});
}
