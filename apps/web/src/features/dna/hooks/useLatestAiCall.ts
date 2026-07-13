// Admin-only debug surface: the exact request sent to the LLM for a run's latest turn
// (docs/agent-turn-grounding.md). ai_calls is published over Realtime (20260713100000_ai_calls_realtime)
// as a SIGNAL only — its system/input/output columns hold tens of KB, so every event just triggers a
// re-read of this ONE row (scoped to taskId) rather than trusting the broadcast payload. Mirrors
// pages/admin/AiCalls.tsx's established pattern, scoped down from "poll everything" to "one row."
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AiCallDebug {
  id: number; created_at: string; status: string; model: string | null; provider: string | null;
  system: string | null; input: unknown; output: string | null;
  input_tokens: number | null; output_tokens: number | null;
}

const COLUMNS = "id, created_at, status, model, provider, system, input, output, input_tokens, output_tokens";

export function useLatestAiCall(taskTable: string, taskId: number | undefined, enabled: boolean): AiCallDebug | null {
  const [call, setCall] = useState<AiCallDebug | null>(null);

  useEffect(() => {
    if (!enabled || !taskId) { setCall(null); return; }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from("ai_calls").select(COLUMNS)
        .eq("task_table", taskTable).eq("task_id", taskId)
        .order("id", { ascending: false }).limit(1).maybeSingle();
      if (!cancelled) setCall((data as unknown as AiCallDebug) ?? null);
    };
    void load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 200); };
    const channel = supabase
      .channel(`ai_call_${taskTable}_${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_calls", filter: `task_id=eq.${taskId}` }, scheduleReload)
      .subscribe();
    return () => { cancelled = true; if (timer) clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [taskTable, taskId, enabled]);

  return call;
}
