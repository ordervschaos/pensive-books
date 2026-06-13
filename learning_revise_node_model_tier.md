# learning: revise-node model tier fix

## Concepts

- **Model tier / tier routing**
  - *Tier*: a named level in a hierarchy (here: which AI provider/model to use)
  - A lookup table maps a tier name (opus/sonnet/deepseek/qwen) to concrete model strings
  - Showed up as `TIER_MODELS` in `model-config.ts`; admin sets the active tier in `admin_settings`

- **getActiveModels()**
  - Runtime DB read that returns `{ high, low }` model strings for the current tier
  - Showed up as the function all generation edges must call instead of hardcoding a model

- **Hardcoded constant vs. dynamic config**
  - `const MODEL = "claude-sonnet-4-6"` = hardcoded; bypasses the tier system entirely
  - `const { high: model } = await getActiveModels()` = dynamic; respects admin setting
  - The bug: `revise-node` had the hardcoded form while all other revise/spine functions used dynamic config

- **Provider routing via model name prefix**
  - `callClaude` in `_shared/claude.ts` inspects `body.model` to decide which API to call:
    - `deepseek-*` → DeepSeek API + `DEEPSEEK_API_KEY`
    - `qwen/*` → OpenRouter API + `OPENROUTER_API_KEY`
    - anything else → Anthropic API + `ANTHROPIC_API_KEY`
  - So passing the Anthropic key is always safe; it's ignored when the model routes elsewhere

- **Credit balance error (Anthropic 400)**
  - Surfaces as `invalid_request_error` with "credit balance too low"
  - Root cause here: function was pinned to Anthropic even though the active tier was qwen/OpenRouter
