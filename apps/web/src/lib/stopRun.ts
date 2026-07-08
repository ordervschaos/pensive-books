// stopRun — the one way to stop a running AI task, whatever table it lives in.
//
// Every AI activity is a task row that marches to a terminal status (see useLatestTaskRow). "Stop"
// means driving that row terminal in the way its worker respects. There are two shapes:
//
//   • Looping/chained workers (book_revisions, book_agent_runs) re-persist their working status
//     between units, so a direct status write WHILE THEY LOOP would be clobbered (and the watchdog
//     could revive it). They poll a `cancel_requested` flag between units and mark themselves
//     'cancelled' cleanly. BUT once such a run parks to wait on the author (awaiting_review /
//     awaiting_input) no worker is looping to notice the flag — so a parked row must be marked
//     'cancelled' directly.
//   • Everything else (single-shot generations, the long eval, terminal-write chains like write_all)
//     has no clobbering loop, so a direct status='cancelled' is correct and immediate.
//
// We standardize the user-stop terminal status on 'cancelled' (NOT 'error') so a stop reads as a stop
// in history, not a failure. The honest caveat: an in-flight Claude call keeps generating and BILLS
// after we hang up — stopping a single-shot call frees the UI but doesn't refund it; stopping a
// loop/chain genuinely saves the *next* turn.
import { supabase } from "@/integrations/supabase/client";

/** Tables whose worker loops and honors a cooperative `cancel_requested` flag while active. */
const COOP_CANCEL = new Set<string>(["book_revisions", "book_agent_runs"]);

/** For a coop table, the statuses where the run is PARKED (no worker looping) → cancel directly. */
const PARKED_STATUSES: Record<string, readonly string[]> = {
  book_revisions: ["awaiting_review"],
  book_agent_runs: ["awaiting_input"],
};

/** Statuses where "AI is working" and a Stop button should appear. */
const ACTIVE_STATUSES: Record<string, readonly string[]> = {
  book_generations: ["pending", "running"],
  book_evaluations: ["pending", "running"],
  book_revisions: ["planning", "building", "awaiting_review"],
  book_agent_runs: ["running", "awaiting_input"],
  revision_chats: ["thinking"],
  // dna-decompose self-chain: direct cancel works — every link re-reads status before continuing.
  book_decompositions: ["running"],
};

export type StoppableTable = "book_generations" | "book_evaluations" | "book_revisions" | "book_agent_runs" | "revision_chats" | "book_decompositions";

/** True while a row is in a state a Stop button should appear for. */
export function isStoppable(table: string, status: string | null | undefined): boolean {
  if (!status) return false;
  return (ACTIVE_STATUSES[table] ?? ["pending", "running"]).includes(status);
}

/**
 * Stop the run on row `id` the way its worker respects. `status` is the row's current status — it
 * decides, for a looping table, between the cooperative flag (while looping) and a direct cancel
 * (while parked). Throws on a write failure.
 */
export async function stopRun(table: StoppableTable, id: number, status?: string | null): Promise<void> {
  let patch: Record<string, unknown>;
  if (COOP_CANCEL.has(table)) {
    const parked = status != null && (PARKED_STATUSES[table] ?? []).includes(status);
    // Always set the flag (a unit that's mid-flight will see it next); add a direct cancel when no
    // worker is looping to act on the flag.
    patch = parked ? { cancel_requested: true, status: "cancelled" } : { cancel_requested: true };
  } else {
    patch = { status: "cancelled" };
  }
  const { error } = await supabase.from(table).update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
