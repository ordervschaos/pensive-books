// AscendButton — the INDUCTIVE move, made available the moment it becomes possible (P3).
//
// Every other generate affordance in the studio runs downhill: a filled parent expands into children. This
// one runs uphill. It appears only when the tree contains a `stub` — a rung that is empty but has written
// material beneath it — which is precisely the state "the author started somewhere other than the top".
// Write a character before you have a premise and this button turns up on its own; that IS the door
// detection, so the author is never asked which way they came in.
import { useMemo, useState } from "react";
import { ascentAsk, runAscent } from "@/features/dna/lib/dnaExpand";
import type { DnaNode } from "@/features/dna/lib/novelDna";
import { MONO, T } from "./treeChrome";

const KIND_LABEL: Record<string, string> = { seed: "logline", premise: "premise", pillar: "controlling idea" };

export function AscendButton({ bookId, nodes }: { bookId: number; nodes: DnaNode[] }) {
  const [busy, setBusy] = useState(false);
  // Derived live from the tree, so it self-hides the moment the rungs are filled — by this button, by the
  // agent, or by the author typing them in by hand.
  const ask = useMemo(() => ascentAsk(nodes), [nodes]);
  if (!ask) return null;

  const what = ask.targets.map((t) => KIND_LABEL[t.kind] ?? t.kind).join(" · ");
  const run = async () => {
    if (busy) return;
    if (!window.confirm(`Infer the ${what} from what you've already written?\n\nYour existing material is treated as ground truth — this only fills the empty rungs above it, and won't overwrite anything you've written.`)) return;
    setBusy(true);
    try {
      const { applied } = await runAscent(bookId);
      if (!applied) alert("Nothing was inferred — there may not be enough written yet to imply a story above it.");
    } catch (e) { alert(`Couldn't infer: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  return (
    <button onClick={run} disabled={busy} title={`Read what you've written and infer the ${what} it already implies`}
      style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase",
        color: T.accent, background: "transparent", border: `1px solid ${T.accent}`, borderRadius: 3,
        padding: "3px 7px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}>
      {busy ? "inferring…" : `↑ infer ${what}`}
    </button>
  );
}
