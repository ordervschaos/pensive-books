// nodeRevisions — per-node content history (book_node_revisions). The fine-grained twin of treeVersions:
// treeVersions snapshots the WHOLE tree at checkpoints; this reads one node's timeline of content changes,
// captured by the log_book_node_revision trigger on every content-changing write (agent, manual, bridge).
// The table is append-only + system-written (SECURITY DEFINER trigger) — the client only READS it and
// reverts by writing book_nodes (which appends a fresh revision, forward-moving).
import { supabase } from "@/integrations/supabase/client";
import { saveNode } from "@/features/dna/lib/bookNodes";
import type { DnaNode, NodeContent } from "@/features/dna/lib/novelDna";

export interface NodeRevision {
  id: number;
  node_id: string;
  book_id: number;
  content: NodeContent;
  authoring: DnaNode["authoring"];
  chosen: string | null;
  ai_call_id: number | null;
  op: "insert" | "update" | "delete";
  created_at: string;
}

/** One node's revisions, newest first. Each row is the full content the node held at that write; diff two
 *  adjacent rows to see what a given change (AI op or hand edit) did. */
export async function listNodeRevisions(nodeId: string): Promise<NodeRevision[]> {
  const { data, error } = await supabase
    .from("book_node_revisions")
    .select("id, node_id, book_id, content, authoring, chosen, ai_call_id, op, created_at")
    .eq("node_id", nodeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as NodeRevision[] | null) ?? [];
}

/** Restore a node's content to an earlier revision. Forward-moving: this writes the live book_nodes row,
 *  which fires the capture trigger and appends the restore as a NEW revision — history is never rewritten.
 *  Content-only (v1): parentage/kind/position are unchanged, so it can't resurrect a deleted node. */
export async function revertNodeToRevision(node: DnaNode, revision: NodeRevision): Promise<void> {
  await saveNode({ ...node, content: revision.content });
}
