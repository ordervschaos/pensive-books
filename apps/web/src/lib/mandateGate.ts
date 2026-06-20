import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";

// The conformance backstop ("gate (a)"). Scores a finished book against the SAME brief MANDATE the
// generator was handed and returns a per-axis report. It reports, it does not block.
//
// Mirrors invokeGenerateBook's backend switch: in local dev (VITE_EVAL_BRIDGE_URL) it routes to
// scripts/eval-bridge.mjs (free local Claude Code); in prod it calls the mandate-gate edge function.

export type Verdict = "pass" | "partial" | "fail";

export interface MandateAxisVerdict {
  axis: "length" | "heat" | "genre" | "success";
  verdict: Verdict;
  detail: string;
  evidence?: string;
}

export interface ConformanceReport {
  overall: Verdict;
  axes: MandateAxisVerdict[];
  wordCount: number;
  wordTarget: number | null;
}

export async function invokeMandateGate(
  bookId: number,
): Promise<{ report: ConformanceReport | null; error: Error | null }> {
  if (BRIDGE) {
    try {
      const r = await bridgeFetch(`/mandate-gate/${bookId}`, { method: "POST" });
      const data = (await r.json().catch(() => ({}))) as { report?: ConformanceReport; error?: string };
      if (!r.ok || data?.error) return { report: null, error: new Error(data?.error ?? `bridge ${r.status}`) };
      return { report: data.report ?? null, error: null };
    } catch (e) {
      return { report: null, error: e as Error };
    }
  }
  const { data, error } = await supabase.functions.invoke("mandate-gate", { body: { bookId } });
  if (error) return { report: null, error };
  const d = data as { report?: ConformanceReport; error?: string };
  if (d?.error) return { report: null, error: new Error(d.error) };
  return { report: d?.report ?? null, error: null };
}
