// useAIRun — the client side of the durable short-op harness (ai-run edge fn / bridge /ai-run).
//
// A short AI op (objective options, spine, node-revise, beats…) is a server-owned book_generations
// row. This hook is the one place that starts a run, watches it live over Realtime (via
// useLatestTaskRow), and exposes accept / reject / cancel — so the surface holds NO in-flight state
// and a refresh / navigate-away-and-back reattaches the exact run.
//
//   const { run, starting, start, accept, reject, cancel } = useAIRun({ bookId, kind, targetKey });
//
// `run` is the latest non-terminal row (running | ready) or null. Terminal rows (applied | dismissed
// | cancelled | error) are surfaced too so the UI can show an error; the consumer decides.
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";
import { stopRun } from "@/lib/stopRun";
import { useLatestTaskRow, type TaskRow } from "./useLatestTaskRow";

export interface AIRunRow<R = unknown> extends TaskRow {
  kind: string;
  result: R | null;
  error: string | null;
  target_key: string | null;
  target_page_id: number | null;
}

interface Options {
  bookId: number;
  kind: string;
  /** Stable key for non-page runs (spine = "book", a draft slot = "draft:{rowId}:{i}", …). */
  targetKey?: string;
  /** Set for page-scoped runs so the row reattaches to that page. */
  targetPageId?: number;
  enabled?: boolean;
  staleMs?: number;
}

const ACTIVE = ["pending", "running"] as const;

export function useAIRun<R = unknown>(opts: Options) {
  const { bookId, kind, targetKey, targetPageId, enabled = true, staleMs = 180_000 } = opts;
  const [starting, setStarting] = useState(false);

  const match: Record<string, string | number> = { kind };
  if (targetKey != null) match.target_key = targetKey;
  if (targetPageId != null) match.target_page_id = targetPageId;

  const { row, refetch, stale, loading } = useLatestTaskRow<AIRunRow<R>>({
    table: "book_generations",
    bookId,
    match,
    activeStatuses: ACTIVE,
    staleMs,
    enabled,
  });

  // Kick a new run. The server inserts the 'running' row (which Realtime delivers immediately), so
  // we just refetch to catch it without waiting for the slow response.
  const start = useCallback(async (params: Record<string, unknown>) => {
    if (starting) return;
    setStarting(true);
    try {
      const body = { bookId, kind, targetKey, targetPageId, params };
      if (BRIDGE) {
        const r = await bridgeFetch("/ai-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json();
        if (d.error) throw new Error(d.error);
      } else {
        const { data, error } = await supabase.functions.invoke("ai-run", { body });
        if (error) throw error;
        if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      }
      refetch();
    } finally {
      setStarting(false);
    }
  }, [bookId, kind, targetKey, targetPageId, starting, refetch]);

  const setStatus = useCallback(async (status: string) => {
    if (!row) return;
    const { error } = await supabase.from("book_generations").update({ status }).eq("id", row.id);
    if (error) throw new Error(error.message);
    refetch();
  }, [row, refetch]);

  // Accept: apply the result (caller persists), then mark the row applied so the panel closes.
  const accept = useCallback(async (apply: (result: R) => Promise<void>) => {
    if (!row || row.result == null) return;
    await apply(row.result);
    await setStatus("applied");
  }, [row, setStatus]);

  const reject = useCallback(() => setStatus("dismissed"), [setStatus]);
  // Cancel = abandon: stopRun marks the row 'cancelled'; the worker discards its result when it sees
  // that status (the same unified stop every AI surface uses).
  const cancel = useCallback(async () => {
    if (!row) return;
    await stopRun("book_generations", row.id, row.status);
    refetch();
  }, [row, refetch]);

  // A run worth showing: running (with its spinner) or ready (a proposal awaiting accept/reject).
  const live = row && (row.status === "running" || row.status === "pending" || row.status === "ready" || row.status === "error") ? row : null;

  return { run: live, starting, stale, loading, start, accept, reject, cancel };
}
