// ScaffoldButton — the ONE-SHOT trigger for the dense tree (P2, doc_1785673597000.md §6).
//
// Materializes the structure template's shape as real, empty `book_nodes` rows, so every slot the book's
// plan calls for has a stable id you can type into, attach, or point the agent at. That's what makes
// "start anywhere" work: writing Act 2 first becomes filling a row that already exists, instead of a
// creation gesture the tool has no place to hang.
//
// AUTHOR-INITIATED ON PURPOSE. This is emphatically not a reconciler running in the background — if it
// re-minted slots, deleting a placeholder would silently undo itself and the author would be fighting the
// tool. It's idempotent (seedSkeleton only returns genuine gaps) and it honours tombstones, so pressing it
// twice is a no-op and a declined slot never comes back.
import { useMemo, useState } from "react";
import { seedSkeleton } from "@/features/dna/lib/dnaSkeleton";
import { saveNodes } from "@/features/dna/lib/bookNodes";
import type { DnaNode } from "@/features/dna/lib/novelDna";
import { MONO, T } from "./treeChrome";

export function ScaffoldButton({ bookId, nodes }: { bookId: number; nodes: DnaNode[] }) {
  const [busy, setBusy] = useState(false);
  // Derived live from the tree, so it disappears the moment the work is done — no local "seeded" flag to go
  // stale against another tab (refresh = no-op; the tree arrives over Realtime).
  const pending = useMemo(() => seedSkeleton(nodes, bookId), [nodes, bookId]);
  if (!pending.length) return null;

  const counts = pending.reduce<Record<string, number>>((a, n) => ({ ...a, [n.kind]: (a[n.kind] ?? 0) + 1 }), {});
  const summary = ["act", "beat", "character"].filter((k) => counts[k]).map((k) => `${counts[k]} ${k}${counts[k] === 1 ? "" : "s"}`).join(" · ");

  const run = async () => {
    if (busy) return;
    if (!window.confirm(`Add ${pending.length} empty slots to the tree (${summary})?\n\nThey hold no content — they're placeholders you (or the agent) can fill in any order. Deleting one records it as deliberately declined.`)) return;
    setBusy(true);
    try { await saveNodes(pending); } catch (e) { alert(`Couldn't scaffold: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  return (
    <button onClick={run} disabled={busy} title={`Materialize the structure template's remaining slots as empty, fillable nodes (${summary})`}
      style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase",
        color: T.accent, background: "transparent", border: `1px dashed ${T.accent}`, borderRadius: 3,
        padding: "3px 7px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
      {busy ? "scaffolding…" : `⬚ scaffold ${pending.length}`}
    </button>
  );
}
