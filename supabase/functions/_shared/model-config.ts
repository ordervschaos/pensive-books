// model-config.ts — reads the active AI model tier from admin_settings and returns
// model strings for "high" (main generation) and "low" (cheap/fast) tasks.
//
// Tier is set via the /admin/settings page. Defaults to "sonnet" if unset or on error so a missing
// or newly-added tier never silently falls back to the most expensive model.
// All expensive edge functions call getActiveModels() instead of hardcoding MODEL.
import { serviceClient } from "./task.ts";

export type ModelTier = "opus" | "sonnet" | "deepseek" | "qwen" | "qwen-plus" | "kimi" | "glm" | "minimax";

// The cheap/fast model for incidental passes (summaries, character-state extraction). Exported so
// callers that default a `low` model don't re-hardcode the string and drift from this file.
export const DEFAULT_LOW_MODEL = "claude-haiku-4-5-20251001";

// Image-PROMPT composition (scene/portrait) is a tiny text task we deliberately keep OFF the Anthropic
// path so prod doesn't depend on ANTHROPIC_API_KEY for it — it always runs on a cheap OpenRouter
// (Qwen) model, regardless of the admin tier. (In dev this never runs: the bridge composes on
// claude-local.) `provider/model` ids route through OPENROUTER_API_KEY in claude.ts.
export const IMAGE_PROMPT_MODEL = "qwen/qwen3-235b-a22b";

// high = selected generation model; low = cheap passes (summaries, scans).
const TIER_MODELS: Record<ModelTier, { high: string; low: string }> = {
  opus:        { high: "claude-opus-4-8",           low: DEFAULT_LOW_MODEL },
  sonnet:      { high: "claude-sonnet-4-6",         low: DEFAULT_LOW_MODEL },
  deepseek:    { high: "deepseek-chat",             low: "deepseek-chat" },
  qwen:        { high: "qwen/qwen3-235b-a22b",      low: "qwen/qwen3-8b" },
  "qwen-plus": { high: "qwen/qwen3.7-plus",         low: "qwen/qwen3-8b" },
  kimi:        { high: "moonshotai/kimi-k2.7-code", low: "qwen/qwen3-8b" },
  glm:         { high: "z-ai/glm-5.2",              low: "qwen/qwen3-8b" },
  minimax:     { high: "minimax/minimax-m3",        low: "qwen/qwen3-8b" },
};

export async function getActiveModels(): Promise<{ high: string; low: string }> {
  try {
    const { data } = await serviceClient()
      .from("admin_settings")
      .select("value")
      .eq("key", "ai_model_tier")
      .single();
    const tier = (data?.value as ModelTier) ?? "sonnet";
    return TIER_MODELS[tier] ?? TIER_MODELS.sonnet;
  } catch {
    return TIER_MODELS.sonnet;
  }
}
