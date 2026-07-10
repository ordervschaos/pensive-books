// model-config.ts — reads the active AI model tier from admin_settings and returns
// model strings for "high" (main generation) and "low" (cheap/fast) tasks.
//
// Tier is set via the /admin/settings page. Defaults to "sonnet" if unset or on error so a missing
// or newly-added tier never silently falls back to the most expensive model.
// All expensive edge functions call getActiveModels() instead of hardcoding MODEL.
import { serviceClient } from "./task.ts";

export type ModelTier = "opus" | "sonnet" | "deepseek" | "deepseek-v4" | "qwen" | "qwen-plus" | "kimi" | "glm" | "minimax" | "gpt" | "hermes";

// WHICH HOST runs the call, chosen independently of WHICH MODEL runs it (the tier above). Several of our
// models are served by more than one provider — deepseek-v4-pro is reachable via OpenRouter, MuleRouter, and
// DeepSeek's own API — so the provider is a spend/latency switch, not a model choice. "auto" keeps the
// historical behaviour (infer the host from the model id; MuleRouter takes over when its key is set).
// A preference the chosen provider CANNOT serve falls back to the model's native host — see resolveRoute
// in llm.ts, which owns the actual table. Set from /admin/settings.
export type Provider = "anthropic" | "openrouter" | "deepseek" | "mulerouter";
export type ProviderPref = "auto" | Provider;
const PROVIDER_PREFS: ProviderPref[] = ["auto", "anthropic", "openrouter", "deepseek", "mulerouter"];

export async function getActiveProvider(): Promise<ProviderPref> {
  try {
    const { data } = await serviceClient()
      .from("admin_settings")
      .select("value")
      .eq("key", "ai_provider")
      .single();
    const pref = data?.value as ProviderPref;
    return PROVIDER_PREFS.includes(pref) ? pref : "auto";
  } catch {
    return "auto";
  }
}

// The cheap/fast model for incidental passes (summaries, character-state extraction). Exported so
// callers that default a `low` model don't re-hardcode the string and drift from this file.
export const DEFAULT_LOW_MODEL = "claude-haiku-4-5-20251001";

// Image-PROMPT composition (scene/portrait) is a tiny text task we deliberately keep OFF the Anthropic
// path so prod doesn't depend on ANTHROPIC_API_KEY for it — it always runs on a cheap OpenRouter
// (Qwen) model, regardless of the admin tier. (In dev this never runs: the bridge composes on
// claude-local.) `provider/model` ids route through OPENROUTER_API_KEY in llm.ts.
export const IMAGE_PROMPT_MODEL = "qwen/qwen3-235b-a22b";

// Continuity-DIGEST model (dna-expand's per-page fold). Deliberately NOT the cheap `low` model (qwen3-8b):
// the digest is read-comprehension that downstream prose treats as authoritative, so a weak model's
// misreadings (e.g. taking the protagonist's auction-lot designation "Lot Seven" as a separate character)
// poison every later page. But NOT a slow reasoning model either (qwen-plus reads it correctly but at
// ~84s/fold — a cold backfill of N pages then blows the ~150s worker ceiling, the fold runs synchronously
// on the worker). qwen3-235b is the sweet spot: capable enough to read designations correctly (verified on
// book 1192's "Lot Seven") at ~13s/fold. Pinned regardless of the active tier. `provider/model` routes
// through OPENROUTER_API_KEY in llm.ts.
export const DIGEST_MODEL = "qwen/qwen3-235b-a22b";

// high = selected generation model; low = cheap passes (summaries, scans).
const TIER_MODELS: Record<ModelTier, { high: string; low: string }> = {
  opus:        { high: "claude-opus-4-8",           low: DEFAULT_LOW_MODEL },
  sonnet:      { high: "claude-sonnet-4-6",         low: DEFAULT_LOW_MODEL },
  // `deepseek-chat` is now only a legacy ALIAS on DeepSeek's own API — it resolves to deepseek-v4-flash
  // (verified against GET api.deepseek.com/models, 2026-07-10). Prefer the deepseek-v4 tier.
  deepseek:    { high: "deepseek-chat",             low: "deepseek-chat" },
  // DeepSeek V4: 1M ctx, tool-use capable, cheap — pro high (~$0.44/$0.87 per M), flash low (~$0.14/$0.28).
  // Named with the OpenRouter prefix, but every provider can serve it: `ai_provider` picks the host, and
  // DeepSeek's own API takes the same ids bare. Uniquely among our OpenAI-compatible hosts, DeepSeek honors
  // `reasoning_effort` AND counts reasoning inside max_tokens — so it's the one cheap tier whose agent-loop
  // latency is actually boundable (see EFFORT_THINKING_BUDGET's warning in llm.ts).
  "deepseek-v4": { high: "deepseek/deepseek-v4-pro", low: "deepseek/deepseek-v4-flash" },
  qwen:        { high: "qwen/qwen3-235b-a22b",      low: "qwen/qwen3-8b" },
  "qwen-plus": { high: "qwen/qwen3.7-plus",         low: "qwen/qwen3-8b" },
  kimi:        { high: "moonshotai/kimi-k2.7-code", low: "qwen/qwen3-8b" },
  glm:         { high: "z-ai/glm-5.2",              low: "qwen/qwen3-8b" },
  minimax:     { high: "minimax/minimax-m3",        low: "qwen/qwen3-8b" },
  gpt:         { high: "openai/gpt-5",               low: "qwen/qwen3-8b" },
  // Non-reasoning, fast (~37s/scene vs qwen-plus ~207s) and the one model that delivered explicit heat
  // that LANDS while honoring the beat + voice contract (model-prose-compare, book 1192 scene 22). Picked
  // for the explicit-mandate books. NOTE: this tier governs ALL high-tier generation (beats/outline JSON
  // too) — hermes is a creative generalist, so watch structural-JSON passes if you flip it on globally.
  hermes:      { high: "nousresearch/hermes-3-llama-3.1-405b", low: "qwen/qwen3-8b" },
};

// Models with NO OpenRouter endpoint that supports tool use. The agent loop (book-agent) ALWAYS sends
// `tools`, so routing its calls to one of these 404s ("No endpoints found that support tool use"). The
// prose/structure roles never send tools, so they may still use these — this only fences the agent role.
// Keep in sync with any tier whose `high` is a non-tool-use model (hermes is a non-reasoning prose model).
const TOOL_INCAPABLE_MODELS = new Set<string>([
  "nousresearch/hermes-3-llama-3.1-405b", // hermes tier — prose specialist, no tool-use endpoint on OpenRouter
]);
// Tool-capable last resort for the agent role when NEITHER its resolved model NOR the base tier can do
// tool use. hermes is the only tool-incapable tier and it's always OpenRouter, so the last resort is an
// OpenRouter model (qwen) — NOT Anthropic sonnet: a hermes user is deliberately off the Anthropic path,
// and the agent fallback must respect that rather than silently reintroducing the ANTHROPIC_API_KEY dep.
const AGENT_FALLBACK_MODEL = TIER_MODELS.qwen.high;

export function isToolCapable(model: string): boolean {
  return !TOOL_INCAPABLE_MODELS.has(model);
}

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

// Per-role models (docs/agent-improvement-plan.md §4c): the agent's reasoning loop, structural JSON, and
// prose have DIFFERENT best models (the model-prose benchmark; and model-config warns hermes writes great
// prose but breaks structural JSON). Each role reads its OWN admin_settings tier override, falling back to
// the base `ai_model_tier` — so with no overrides set every role is the base `high` (identical to before).
// This lets an admin run prose on a prose-specialist tier while keeping structure/agent on a JSON-reliable
// one, WITHOUT this code guessing the assignment (that's a taste/benchmark call made from /admin/settings).
export type ModelRole = "agent" | "structure" | "prose";
export const ROLE_TIER_KEYS: Record<ModelRole, string> = {
  agent: "ai_model_tier_agent",
  structure: "ai_model_tier_structure",
  prose: "ai_model_tier_prose",
};

// Pure: resolve the four role models from a (settings key → tier) map. An absent/unknown per-role override
// falls back to the base tier's `high`, so an empty map yields every role = base high (behaviour-preserving).
export function resolveRoleModels(tiers: Partial<Record<string, ModelTier>>): { agent: string; structure: string; prose: string; low: string } {
  const base = TIER_MODELS[(tiers.ai_model_tier as ModelTier) ?? "sonnet"] ?? TIER_MODELS.sonnet;
  const highOf = (t?: ModelTier) => (t && TIER_MODELS[t]?.high) || base.high;
  // The agent role drives a tool-use loop, so it can't run on a tool-incapable model (e.g. hermes). If the
  // resolved model can't do tools, prefer the base tier's high (keeps an Anthropic base on Anthropic, an
  // OpenRouter base on OpenRouter); only if THAT is also tool-incapable drop to the OpenRouter default. So
  // an admin who sets hermes globally for its prose still gets a working, in-family agent — no OpenRouter 404.
  const toolCapableAgent = (m: string) =>
    isToolCapable(m) ? m : isToolCapable(base.high) ? base.high : AGENT_FALLBACK_MODEL;
  return {
    agent: toolCapableAgent(highOf(tiers[ROLE_TIER_KEYS.agent])),
    structure: highOf(tiers[ROLE_TIER_KEYS.structure]),
    prose: highOf(tiers[ROLE_TIER_KEYS.prose]),
    low: base.low,
  };
}

export async function getRoleModels(): Promise<{ agent: string; structure: string; prose: string; low: string }> {
  try {
    const { data } = await serviceClient()
      .from("admin_settings")
      .select("key, value")
      .in("key", ["ai_model_tier", ...Object.values(ROLE_TIER_KEYS)]);
    const tiers = Object.fromEntries((data ?? []).map((r) => [r.key as string, r.value as ModelTier]));
    return resolveRoleModels(tiers);
  } catch {
    return resolveRoleModels({});
  }
}
