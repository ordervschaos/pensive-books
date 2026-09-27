// The chat's model picker — mirrors SELECTABLE_TIERS in supabase/functions/_shared/model-config.ts.
// "default" = the admin's agent tier. The server re-validates the key; an unknown one falls back to default.
export interface ModelChoice { key: string; label: string; hint: string }

export const MODEL_CHOICES: ModelChoice[] = [
  { key: "default", label: "Default", hint: "the admin-configured agent model" },
  { key: "opus", label: "Claude Opus", hint: "highest quality, most expensive" },
  { key: "sonnet", label: "Claude Sonnet", hint: "strong quality at ~5× lower cost" },
  { key: "gpt", label: "GPT-5.5", hint: "rich, warm prose; runs long" },
  { key: "deepseek-v4", label: "DeepSeek V4 Pro", hint: "cheap, 1M context, bounded reasoning" },
  { key: "deepseek", label: "DeepSeek (legacy)", hint: "resolves to V4 Flash" },
  { key: "qwen", label: "Qwen 3 Max", hint: "budget, competitive" },
  { key: "qwen-plus", label: "Qwen 3.7 Plus", hint: "budget, planning" },
  { key: "kimi", label: "Kimi K2.7", hint: "long-context, structured" },
  { key: "glm", label: "GLM 5.2", hint: "budget" },
  { key: "minimax", label: "MiniMax M3", hint: "budget" },
];

export const modelLabel = (key: string | null | undefined): string =>
  MODEL_CHOICES.find((m) => m.key === (key ?? "default"))?.label ?? "Default";
