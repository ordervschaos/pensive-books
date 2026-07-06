// treeVersions — history for the DNA tree (book_tree_versions). Every version is a frozen snapshot of
// book_nodes, taken by the snapshot_book_tree() Postgres function (the one chokepoint, so client, edge
// fns, and the bridge all land the same shape). This gives the author a forward-moving, git-revert-style
// history without branches/merges: save a checkpoint, see what changed since the last one, restore.
import { supabase } from "@/integrations/supabase/client";
import { saveNodes, deleteNode } from "@/features/dna/lib/bookNodes";
import type { DnaNode } from "@/features/dna/lib/novelDna";

export interface TreeVersion {
  id: number;
  book_id: number;
  label: string | null;
  nodes: DnaNode[];
  created_at: string;
}

/** Freeze the live tree as a new version. label=undefined → an auto checkpoint; set it for an
 *  author-named "Save this version". Returns the new version's id. */
export async function snapshotTree(bookId: number, label?: string): Promise<number> {
  const { data, error } = await supabase.rpc("snapshot_book_tree", { p_book_id: bookId, p_label: label ?? null });
  if (error) throw error;
  return data as number;
}

/** List a book's versions, newest first. Excludes `nodes` (can be large) — fetch a single version's
 *  nodes with loadVersion when the author actually opens it. */
export async function listVersions(bookId: number): Promise<Omit<TreeVersion, "nodes">[]> {
  const { data, error } = await supabase
    .from("book_tree_versions").select("id, book_id, label, created_at")
    .eq("book_id", bookId).order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Omit<TreeVersion, "nodes">[] | null) ?? [];
}

/** Load one version's frozen node set. */
export async function loadVersion(versionId: number): Promise<DnaNode[]> {
  const { data, error } = await supabase
    .from("book_tree_versions").select("nodes").eq("id", versionId).maybeSingle();
  if (error) throw error;
  return ((data?.nodes as DnaNode[] | null) ?? []);
}

export interface TreeDiff { added: number; removed: number; changed: number }

/** Compare the live tree against a frozen version by node id — added/removed/changed counts for a
 *  badge. "changed" = same id, different content/authoring/proposals/chosen (position moves don't count;
 *  reordering siblings isn't a meaningful change to flag). */
export function diffAgainstVersion(live: DnaNode[], version: DnaNode[]): TreeDiff {
  const liveById = new Map(live.map((n) => [n.id, n]));
  const versionById = new Map(version.map((n) => [n.id, n]));
  let added = 0, removed = 0, changed = 0;
  for (const [id, node] of liveById) {
    const prior = versionById.get(id);
    if (!prior) { added++; continue; }
    if (
      JSON.stringify(node.content) !== JSON.stringify(prior.content) ||
      JSON.stringify(node.authoring) !== JSON.stringify(prior.authoring) ||
      JSON.stringify(node.proposals ?? null) !== JSON.stringify(prior.proposals ?? null) ||
      (node.chosen ?? null) !== (prior.chosen ?? null)
    ) changed++;
  }
  for (const id of versionById.keys()) if (!liveById.has(id)) removed++;
  return { added, removed, changed };
}

/** Restore a version: re-write its nodes, delete any live node the version doesn't have, then snapshot
 *  the result as a new version (forward-moving — restoring never rewrites history, it appends). */
export async function restoreVersion(bookId: number, versionId: number, live: DnaNode[]): Promise<void> {
  const version = await loadVersion(versionId);
  const versionIds = new Set(version.map((n) => n.id));
  const extraLiveIds = live.filter((n) => !versionIds.has(n.id)).map((n) => n.id);
  await saveNodes(version);
  for (const id of extraLiveIds) await deleteNode(id);
  await snapshotTree(bookId, `Restored to ${new Date().toLocaleString()}`);
}
