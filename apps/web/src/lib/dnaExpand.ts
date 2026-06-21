// dnaExpand — Phase 5: the "expand" verb. Calls dna-expand (bridge in dev, edge in prod) and applies the
// result as ONE authoritative value (not proposals): child nodes get the generated content (source=ai,
// accepted); a scene gets its prose. The author then edits / regenerates / locks. See novel-dna-spec.md §6.
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { saveNode, saveNodes } from "@/lib/bookNodes";
import { byId, newId, stampInput, stampProse, type DnaNode, type NodeContent, type NodeKind } from "@/lib/novelDna";

interface ExpandResult {
  childKind?: NodeKind; childLevel?: number; children?: NodeContent[]; prose?: string;
}

async function callExpand(bookId: number, nodeId: string, target: string): Promise<ExpandResult> {
  if (BRIDGE) {
    const r = await bridgeFetch(`/dna-expand`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookId, nodeId, target }) });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    return d as ExpandResult;
  }
  const { data, error } = await supabase.functions.invoke("dna-expand", { body: { bookId, nodeId, target } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as ExpandResult;
}

const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/** Expand a node toward `target`: generate prose (scene) or the next-rung children (one true set), persist. */
export async function expandNode(bookId: number, node: DnaNode, target: string, startPosition = 0): Promise<{ added: number }> {
  const res = await callExpand(bookId, node.id, target);

  if (target === "prose") {
    const text = (res.prose ?? "").trim();
    if (!text) throw new Error("No prose was generated.");
    const updated: DnaNode = {
      ...node,
      content: { ...node.content, prose: { text, words: wordCount(text) } },
      authoring: { ...node.authoring, source: node.authoring.source === "user" ? "ai_then_user" : "ai", status: "accepted" },
    };
    await saveNode(stampProse(updated));
    return { added: 0 };
  }

  const children = res.children ?? [];
  if (!children.length) throw new Error("No children were generated.");
  const made: DnaNode[] = children.map((content, i) => ({
    id: newId(), book_id: bookId, parent_id: node.id,
    level: res.childLevel ?? node.level + 1, kind: (res.childKind ?? "scene") as NodeKind,
    position: startPosition + i, content,
    authoring: { source: "ai", locked: false, status: "accepted" },
  }));
  // Stamp each against its inputs (parent + the new siblings) so they don't read as stale on arrival.
  const index = byId([node, ...made]);
  await saveNodes(made.map((n) => stampInput(n, index)));
  return { added: made.length };
}
