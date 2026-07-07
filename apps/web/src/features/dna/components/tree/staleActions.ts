// Accept/discard actions for a stale node — the ONE implementation behind both surfaces that
// offer them (the row's stale-chip popover via Subtree, and the FocusPanel's freshness section),
// so "accept" and "discard" always mean the same write.
import { saveNode } from "@/features/dna/lib/bookNodes";
import { isProseStale, isStale, stampInput, stampProse, type DnaNode, type SceneContent } from "@/features/dna/lib/novelDna";

export interface StaleActions {
  onApprove: () => Promise<void>;
  onRegen?: () => Promise<void>; // regeneration is the agent's job (the rail) — no surface wires this today
  onDiscard: () => Promise<void>;
}

/** undefined when the node isn't stale. Approve = re-stamp the hashes (accept the node as-is
 * against its current inputs). Discard = drop the stale artifact: for prose-only staleness clear
 * the prose itself; otherwise clear the hashes so the node reads as not-yet-generated. */
export function staleActionsFor(node: DnaNode, index: Map<string, DnaNode>): StaleActions | undefined {
  const nodeStale = isStale(node, index);
  const proseStale = node.kind === "scene" && isProseStale(node);
  if (!nodeStale && !proseStale) return undefined;
  return {
    onApprove: async () => {
      let n = node;
      if (nodeStale) n = stampInput(n, index);
      if (proseStale) n = stampProse(n);
      await saveNode(n);
    },
    onDiscard: async () => {
      if (proseStale && !nodeStale) {
        const sc = node.content as SceneContent;
        await saveNode({ ...node, content: { ...sc, prose: undefined }, authoring: { ...node.authoring, prose_src_hash: undefined } });
      } else {
        await saveNode({ ...node, authoring: { ...node.authoring, src_hash: undefined, prose_src_hash: undefined } });
      }
    },
  };
}
