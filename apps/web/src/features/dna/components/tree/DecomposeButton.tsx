// DecomposeButton — the tree-chrome trigger for the semantic ascent (dnaDecompose): shown only when
// the book looks like a fresh import (prose-bearing scenes, empty seed logline, no cast yet). The run
// is client-owned and cooperative-cancel; results land incrementally, so the tree fills in live via
// the page's Realtime subscription while this just narrates progress.
import { useMemo, useRef, useState } from "react";
import { decomposeBook, type DecomposeProgress } from "@/features/dna/lib/dnaDecompose";
import type { DnaNode } from "@/features/dna/lib/novelDna";
import { MONO, T } from "./treeChrome";

const label = (p: DecomposeProgress): string =>
  p.phase === "chapters" ? `reading ch ${p.done + 1}/${p.total}…`
    : p.phase === "top" ? "distilling premise…"
      : p.phase === "entities" ? "extracting cast & world…"
        : "sealing…";

export function DecomposeButton({ bookId, nodes }: { bookId: number; nodes: DnaNode[] }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const stopRef = useRef(false);

  // "Fresh import" shape: locked prose exists but the plan rungs above it are still empty.
  const show = useMemo(() => {
    const hasProse = nodes.some((n) => n.kind === "scene" && ((n.content as { prose?: { text?: string } }).prose?.text ?? "").trim());
    const seed = nodes.find((n) => n.kind === "seed");
    const seedEmpty = !((seed?.content as { logline?: string } | undefined)?.logline ?? "").trim();
    const noCast = !nodes.some((n) => n.kind === "character");
    return hasProse && seedEmpty && noCast;
  }, [nodes]);
  if (!show && !running) return null;

  const run = async () => {
    setRunning(true);
    stopRef.current = false;
    setStatus("starting…");
    try {
      const r = await decomposeBook(bookId, {
        onProgress: (p) => setStatus(label(p)),
        shouldStop: () => stopRef.current,
      });
      setStatus(r.stopped ? "stopped" : r.rejected.length || r.skipped.length ? `done (${r.rejected.length + r.skipped.length} items skipped)` : null);
    } catch (e) {
      setStatus(`failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {status && <span style={{ color: T.muted, fontSize: 10, fontFamily: MONO }}>{status}</span>}
      <button
        onClick={() => { if (running) stopRef.current = true; else void run(); }}
        title="Read the manuscript and infer the plan above it — beats, premise, pillar, cast, world, threads. Your prose is never touched."
        style={{ background: "none", border: "none", color: running ? T.warn : T.accent, fontSize: 10.5, cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: MONO }}
      >
        {running ? "stop" : "infer plan →"}
      </button>
    </span>
  );
}
