// useActiveStep — which build step currently has an AI job running, for the Navigator's live badge.
//
// An active run can live in any of four task tables, and book_generations spans many kinds — each
// maps to a different step. This watches all four over Realtime (via useLatestTaskRow) and returns
// the StepKey of the newest actively-working run, or null. It does NOT move the user's view (the
// studio chose a badge over auto-navigation): it just lets the Navigator mark "● running" on the
// step where work is happening, so the surface reflects server truth without a refresh — and the
// step row is already clickable to jump there.
import { useLatestTaskRow, type TaskRow } from "@/hooks/useLatestTaskRow";
import type { StepKey } from "./studioModel";

const GEN_ACTIVE = ["pending", "running"] as const;
const REV_ACTIVE = ["planning", "building"] as const;
const AGENT_ACTIVE = ["running"] as const;
const EVAL_ACTIVE = ["pending"] as const;

// book_generations.kind → the step it belongs to. Page-scoped/unknown kinds (e.g. node_revise) are
// intentionally absent: better no badge than a wrong one.
const GEN_STEP: Record<string, StepKey> = {
  foundations_options: "foundations",
  objective_options: "outline",
  beat_candidates: "beats",
  write_all: "draft",
};

interface GenRow extends TaskRow { kind?: string }

const rowTime = (r: TaskRow | null) => (r ? new Date(r.updated_at || r.created_at).getTime() : 0);
const isActive = (r: TaskRow | null, active: readonly string[]) => !!r && active.includes(r.status);

export function useActiveStep(bookId: number, enabled = true): StepKey | null {
  const gen = useLatestTaskRow<GenRow>({ table: "book_generations", bookId, activeStatuses: GEN_ACTIVE, enabled });
  const rev = useLatestTaskRow({ table: "book_revisions", bookId, activeStatuses: REV_ACTIVE, enabled });
  const agent = useLatestTaskRow({ table: "book_agent_runs", bookId, activeStatuses: AGENT_ACTIVE, enabled });
  const evalRow = useLatestTaskRow({ table: "book_evaluations", bookId, activeStatuses: EVAL_ACTIVE, enabled });

  // Each candidate: a running row mapped to its step. Newest (by updated_at, else created_at) wins
  // when more than one is live.
  const candidates: Array<{ step: StepKey; t: number }> = [];
  if (isActive(gen.row, GEN_ACTIVE) && gen.row?.kind && GEN_STEP[gen.row.kind]) {
    candidates.push({ step: GEN_STEP[gen.row.kind], t: rowTime(gen.row) });
  }
  // Prose work — the durable revise-agent run (the Draft prose editor) and its build-revision apply —
  // badges the Draft step now (the standalone Revise step was retired). An evaluation badges Read.
  if (isActive(rev.row, REV_ACTIVE)) candidates.push({ step: "draft", t: rowTime(rev.row) });
  if (isActive(agent.row, AGENT_ACTIVE)) candidates.push({ step: "draft", t: rowTime(agent.row) });
  if (isActive(evalRow.row, EVAL_ACTIVE)) candidates.push({ step: "read", t: rowTime(evalRow.row) });

  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (b.t > a.t ? b : a)).step;
}
