// Shared reads + waiting for the headless agent harness. Both drivers (observe-only dryrun and the
// applying run) sit on this, so they can't drift on "what does the thread look like right now".
import { supabase } from "@/integrations/supabase/client";
import { loadTree } from "@/features/dna/lib/bookNodes";
import type { AgentThreadRow } from "@/features/dna/lib/agentThread";
import { stageComplete, stageSubsteps } from "@/features/dna/lib/dnaJourney";
import type { DnaNode } from "@/features/dna/lib/novelDna";
import type { AutoAction } from "@/features/dna/lib/autoAccept";

/** Statuses where the edge fn is NOT mid-turn, so a watcher may act. */
export const QUIESCENT = ["idle", "awaiting_input", "done", "error"];

export async function loadThread(bookId: number): Promise<AgentThreadRow | null> {
  const { data, error } = await supabase
    .from("book_agent_runs").select("*").eq("book_id", bookId).eq("kind", "thread").maybeSingle();
  if (error) throw new Error(`loadThread: ${error.message}`);
  return (data ?? null) as AgentThreadRow | null;
}

// Delegates to the app's OWN loader rather than a hand-rolled projection. A local `select(...)` here
// silently dropped book_id and last_ai_call_id, so every saveNode() the harness triggered tried to write a
// row with a null book — the same twin-drift failure this harness exists to avoid, one level down.
export const loadNodes = loadTree;

export async function loadBrief(bookId: number): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from("books").select("brief").eq("id", bookId).maybeSingle();
  return (data?.brief ?? null) as Record<string, unknown> | null;
}

/**
 * Serialize a thrown value. Supabase/PostgREST rejects with a PLAIN OBJECT ({message, details, hint,
 * code}), not an Error — so `String(e)` yields "[object Object]" and hides the actual failure. Every
 * catch in the harness must go through this.
 */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(" · ");
    return JSON.stringify(e);
  }
  return String(e);
}

/** Human-readable one-liner for a decision — used by both drivers' logs. */
export function describe(a: AutoAction): string {
  switch (a.kind) {
    case "answer": return `answer the parked question — "${a.question}"`;
    case "apply":  return `apply [${a.proposal.layer}${a.proposal.target ? `/${a.proposal.target}` : ""}] ${a.proposal.summary}`;
    case "choose": return `choose staged option ${a.proposalId} on node ${a.node.id}`;
    case "halt":   return `HALT — ${a.reason} · would have been: ${a.proposal.summary}`;
    case "none":   return "nothing to do";
  }
}

/** Node tally across the ladder rungs, so a run's progress is legible at a glance. */
export function ladder(nodes: DnaNode[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  const rungs = ["seed", "premise", "pillar", "character", "thread", "act", "beat", "scene"];
  return rungs.map((k) => `${k} ${counts.get(k) ?? 0}`).join(" · ");
}

/**
 * Which premise sub-steps are done — the harness's progress readout AND its halt predicate, taken from
 * the product's own journey model (dnaJourney.stageSubsteps) rather than a bespoke definition. The rungs
 * are exactly: interview (vision) → seed (logline) → premise (dramatic question).
 */
export function premiseProgress(nodes: DnaNode[], brief: unknown) {
  // NB: SubStep exposes `status` ("done" | "now" | "locked" | "available"), NOT a boolean `done` — that
  // only exists on the internal SubSpec the resolver consumes. Reading `.done` here silently yields
  // undefined and reports every rung as incomplete even on a finished book.
  const subs = stageSubsteps("premise", nodes, brief as never);
  return {
    substeps: subs.map((s) => ({ key: s.key, label: s.label, done: s.status === "done" })),
    complete: stageComplete(nodes).premise,
    line: subs.map((s) => `${s.status === "done" ? "✓" : "·"} ${s.label}`).join("  "),
  };
}

/** Poll until the edge fn hands the row back (or the deadline passes). */
export async function waitForQuiescent(bookId: number, opts: { timeoutMs?: number; pollMs?: number } = {}) {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const pollMs = opts.pollMs ?? 3_000;
  const until = Date.now() + timeoutMs;
  for (;;) {
    const row = await loadThread(bookId);
    if (row && QUIESCENT.includes(row.status)) return row;
    if (Date.now() > until) throw new Error(`thread still ${row?.status ?? "missing"} after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
