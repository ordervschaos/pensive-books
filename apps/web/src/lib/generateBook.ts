import { supabase } from "@/integrations/supabase/client";
import { BRIDGE, bridgeFetch } from "@/lib/bridge";

// Single entry point for the durable "build the draft" job (beats → optional pause → prose). In local
// dev with the bridge configured (VITE_EVAL_BRIDGE_URL), this routes to scripts/eval-bridge.mjs — free
// local Claude Code — instead of the PAID generate-book edge function. Both backends write the SAME
// book_generations row, so the studio's useLatestTaskRow watchers behave identically either way.
//
// Returns the supabase.functions.invoke-shaped { data, error } so call sites stay a one-line swap.
export async function invokeGenerateBook(
  body: Record<string, unknown>,
): Promise<{ data: unknown; error: Error | null }> {
  if (BRIDGE) {
    try {
      const r = await bridgeFetch("/generate-book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok || data?.error) return { data, error: new Error(data?.error ?? `bridge ${r.status}`) };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  }
  return await supabase.functions.invoke("generate-book", { body });
}
