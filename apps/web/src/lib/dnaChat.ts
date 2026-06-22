// dnaChat — client for the per-stage DNA reviser (dna-chat edge fn, bridge in dev). The edge fn owns the
// dna_chats thread; the rail watches it over Realtime. A proposed change rides in pending_proposal as node
// OPS the author reviews, then applies to book_nodes here. See docs/novel-dna-spec.md.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { deleteNode, loadTree, saveNode } from "@/lib/bookNodes";
import { byId, editContent, emptyNode, stampInput, type DnaNode, type NodeContent, type NodeKind } from "@/lib/novelDna";
import type { StageKey } from "@/lib/dnaJourney";

export interface DnaChatMessage { role: "user" | "assistant"; text: string; ts: string; plan?: string }
export type NodeOp =
  | { op: "edit"; id: string; content: NodeContent }
  | { op: "add"; kind: NodeKind; parentId: string; content: NodeContent }
  | { op: "delete"; id: string };
export interface DnaProposal { summary: string; ops: NodeOp[] }

const KIND_LEVEL: Record<NodeKind, number> = {
  seed: 0, premise: 1, pillar: 2, character: 2, relationship: 2, tentpole: 2, world_fact: 2, thread: 2, movement: 3, beat: 4, scene: 5,
};

/** Send one message in a (book, stage) thread. The edge fn appends + persists; the rail re-reads over Realtime.
 *  `analysis` = the three-axis story analysis (pacing/promises/topography/lints), computed client-side from the
 *  live tree (the engine lives in the web app) and handed to the reviser so it can act on drift/dangling/sag. */
export async function sendDnaMessage(bookId: number, stage: StageKey, message: string, analysis?: string): Promise<void> {
  const body = { bookId, stage, message, analysis };
  if (BRIDGE) {
    const r = await bridgeFetch(`/dna-chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return;
  }
  const { data, error } = await supabase.functions.invoke("dna-chat", { body });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
}

/** Apply a reviewed proposal: run its node ops against book_nodes, then clear the pending proposal. */
export async function applyDnaProposal(bookId: number, stage: StageKey, proposal: DnaProposal): Promise<void> {
  const nodes = await loadTree(bookId);
  const index = byId(nodes);
  const childCount = (parentId: string) => nodes.filter((n) => n.parent_id === parentId).length;
  let added = 0;
  for (const op of proposal.ops) {
    if (op.op === "edit") {
      const node = index.get(op.id);
      if (node && !node.authoring.locked) await saveNode(editContent(node, op.content));
    } else if (op.op === "delete") {
      const node = index.get(op.id);
      if (node && !node.authoring.locked) await deleteNode(op.id);
    } else if (op.op === "add" && index.has(op.parentId)) {
      const fresh = emptyNode(bookId, op.kind, KIND_LEVEL[op.kind] ?? 5, op.parentId, childCount(op.parentId) + added++);
      const node: DnaNode = { ...fresh, content: op.content, authoring: { source: "ai", locked: false, status: "accepted" } };
      await saveNode(stampInput(node, byId([...nodes, node])));
    }
  }
  await clearDnaProposal(bookId, stage);
}

/** Discard the pending proposal without applying it. */
export async function clearDnaProposal(bookId: number, stage: StageKey): Promise<void> {
  await supabase.from("dna_chats").update({ pending_proposal: null }).eq("book_id", bookId).eq("stage", stage);
}
