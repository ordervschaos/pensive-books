// model-config.ts — reads the active AI model tier from admin_settings and returns
// model strings for "high" (main generation) and "low" (cheap/fast) tasks.
//
// Tier is set via the /admin/settings page. Defaults to "opus" if unset or on error.
// All expensive edge functions call getActiveModels() instead of hardcoding MODEL.
import { serviceClient } from "./task.ts";

export type ModelTier = "opus" | "sonnet" | "deepseek" | "qwen";

// high = opus/sonnet/deepseek/qwen for generation; low = haiku for cheap passes (summaries, scans)
const TIER_MODELS: Record<ModelTier, { high: string; low: string }> = {
  opus:     { high: "claude-opus-4-8",          low: "claude-haiku-4-5-20251001" },
  sonnet:   { high: "claude-sonnet-4-6",         low: "claude-haiku-4-5-20251001" },
  deepseek: { high: "deepseek-chat",             low: "deepseek-chat" },
  qwen:     { high: "qwen3-max",                 low: "qwen3-flash" },
};

export async function getActiveModels(): Promise<{ high: string; low: string }> {
  try {
    const { data } = await serviceClient()
      .from("admin_settings")
      .select("value")
      .eq("key", "ai_model_tier")
      .single();
    const tier = (data?.value as ModelTier) ?? "opus";
    return TIER_MODELS[tier] ?? TIER_MODELS.opus;
  } catch {
    return TIER_MODELS.opus;
  }
}
