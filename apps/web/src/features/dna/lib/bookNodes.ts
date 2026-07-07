// bookNodes — persistence for the Novel DNA tree (book_nodes). Thin CRUD over the table; all tree LOGIC
// is pure in lib/novelDna.ts. The studio is a live projection: subscribe to book_nodes over Realtime and
// re-load (refresh = no-op). See docs/novel-dna-spec.md.
import { supabase } from "@/integrations/supabase/client";
import { editContent, type DnaNode, type NodeContent } from "@/features/dna/lib/novelDna";

const COLS = "id, book_id, parent_id, level, kind, position, content, authoring, proposals, chosen, last_ai_call_id";

/** Load a book's whole tree (one query; ~100 rows + prose). Ordered by position for stable sibling order. */
export async function loadTree(bookId: number): Promise<DnaNode[]> {
  const { data, error } = await supabase
    .from("book_nodes").select(COLS).eq("book_id", bookId).order("position", { ascending: true });
  if (error) throw error;
  return (data as DnaNode[] | null) ?? [];
}

/** Upsert one node (insert or update). The whole DnaNode shape maps 1:1 to columns. */
export async function saveNode(node: DnaNode): Promise<void> {
  const { error } = await supabase.from("book_nodes").upsert({
    id: node.id, book_id: node.book_id, parent_id: node.parent_id, level: node.level, kind: node.kind,
    position: node.position, content: node.content, authoring: node.authoring,
    proposals: node.proposals ?? null, chosen: node.chosen ?? null,
    last_ai_call_id: node.last_ai_call_id ?? null,
  });
  if (error) throw error;
}

/** Edit a node's content via a fresh-read merge: re-load its LIVE row, deep-merge the patch onto that (not
 *  the caller's render snapshot), and write back. This makes two rapid field edits to the same node compose
 *  instead of the second clobbering the first (Realtime echoes lag the edit). Falls back to no-op if the
 *  node vanished. The merge + authoring bump is editContent — the one canonical edit path. */
export async function patchNodeContent(node: DnaNode, patch: NodeContent): Promise<void> {
  const { data, error } = await supabase.from("book_nodes").select(COLS).eq("id", node.id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("node no longer exists");
  await saveNode(editContent(data as DnaNode, patch));
}

/** Upsert many nodes at once (a generated subtree, a migration). */
export async function saveNodes(nodes: DnaNode[]): Promise<void> {
  if (!nodes.length) return;
  const { error } = await supabase.from("book_nodes").upsert(nodes.map((n) => ({
    id: n.id, book_id: n.book_id, parent_id: n.parent_id, level: n.level, kind: n.kind,
    position: n.position, content: n.content, authoring: n.authoring,
    proposals: n.proposals ?? null, chosen: n.chosen ?? null,
    last_ai_call_id: n.last_ai_call_id ?? null,
  })));
  if (error) throw error;
}

/** Delete a node and (via ON DELETE CASCADE) its whole subtree. */
export async function deleteNode(id: string): Promise<void> {
  const { error } = await supabase.from("book_nodes").delete().eq("id", id);
  if (error) throw error;
}
