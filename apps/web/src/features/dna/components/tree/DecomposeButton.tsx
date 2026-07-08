// DecomposeButton — the tree-chrome face of the server-owned semantic ascent (dnaDecompose). Pure
// projection: useLatestTaskRow watches book_decompositions over Realtime, so a refresh or a second
// tab shows the same live progress (refresh = no-op). Start invokes the edge fn; stop rides the
// universal stopRun chokepoint (status → cancelled; the next chain link sees it and exits).
import { useMemo, useState } from "react";
import { decomposeLabel, startDecompose, type DecomposeRow } from "@/features/dna/lib/dnaDecompose";
import { useLatestTaskRow } from "@/hooks/useLatestTaskRow";
import { isStoppable, stopRun } from "@/lib/stopRun";
import type { DnaNode } from "@/features/dna/lib/novelDna";

export function DecomposeButton({ bookId, nodes }: { bookId: number; nodes: DnaNode[] }) {
  const [busy, setBusy] = useState(false); // start/stop request in flight
  const [note, setNote] = useState<string | null>(null);
  const { row, refetch } = useLatestTaskRow({ table: "book_decompositions", bookId, activeStatuses: ["running"] });
  const run = row as DecomposeRow | null;
  const active = !!run && isStoppable("book_decompositions", run.status);

  // "Fresh import" shape: locked prose exists but the plan rungs above it are still empty.
  const showIdle = useMemo(() => {
    const hasProse = nodes.some((n) => n.kind === "scene" && ((n.content as { prose?: { text?: string } }).prose?.text ?? "").trim());
    const seed = nodes.find((n) => n.kind === "seed");
    const seedEmpty = !((seed?.content as { logline?: string } | undefined)?.logline ?? "").trim();
    const noCast = !nodes.some((n) => n.kind === "character");
    return hasProse && seedEmpty && noCast;
  }, [nodes]);
  if (!active && !showIdle) return null;

  const start = async () => {
    setBusy(true);
    setNote(null);
    try {
      await startDecompose(bookId);
      refetch();
    } catch (e) {
      setNote(`failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!run) return;
    setBusy(true);
    try {
      await stopRun("book_decompositions", run.id as number, run.status);
      refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {(active || note) && (
        <span style={{ color: note ? "#d0a060" : "#9bd3e6", fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
          {note ?? decomposeLabel(run!)}
        </span>
      )}
      <button
        disabled={busy}
        onClick={() => void (active ? stop() : start())}
        title={active
          ? "Stop the run — chapters already read are kept"
          : "Read the manuscript and infer the plan above it — beats, premise, pillar, cast, world, threads, games. Your prose is never touched. Runs on the server; you can close the tab."}
        style={{ background: "none", border: "none", color: busy ? "#555" : active ? "#d0a060" : "#9bd3e6", fontSize: 10, cursor: busy ? "default" : "pointer", letterSpacing: "0.1em", textTransform: "uppercase" }}
      >
        {busy ? "…" : active ? "stop" : "infer plan →"}
      </button>
    </span>
  );
}
