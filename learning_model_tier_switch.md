# Learning: AI Model Tier Switching

## Concepts Encountered

- **Chokepoint / Single Point of Control**
  - A single module through which all instances of a category of work must pass, enabling global policy enforcement
  - `_shared/claude.ts` is the chokepoint — every AI call routes through `callClaude`, so model routing logic added there affects every function without touching individual callers

- **Feature Flag (Runtime Config)**
  - A setting that changes system behavior at runtime without code deployment
  - `admin_settings.ai_model_tier` is a feature flag: flip it from `opus` to `sonnet` and all generation calls use the cheaper model immediately

- **API Normalization / Adapter Pattern**
  - Translate between two different API shapes so callers see a uniform interface regardless of the backend
  - `anthropicToOpenAI()` converts Anthropic request format → DeepSeek (OpenAI-compatible) format; `openAIToAnthropic()` normalizes the response back — all existing callers remain unchanged

- **Request Body Translation**
  - Mapping fields from one API's schema to another's (e.g., `system` string → system role message; `stop_sequences` → `stop`; stripping `cache_control` and `thinking` fields not supported by the target)
  - Applied in `anthropicToOpenAI()` to strip Anthropic-specific fields (cache_control, thinking, output_config) before sending to DeepSeek

- **Response Normalization**
  - Converting a provider's response shape to the expected shape so downstream extraction code doesn't need to know which provider was used
  - `openAIToAnthropic()` maps `choices[0].message.content` → `content[0].text` and `usage.prompt_tokens` → `usage.input_tokens`

- **Parameter Threading**
  - Passing a value through a chain of function calls rather than using a global or re-fetching it at each level
  - `evalModel` is fetched once at the top of the request handler in `evaluate-book` and threaded through `runEvaluation` → `evaluateMapReduce` → `runTriage` / `runGroup` / `runVerdict` → `anthropicCall`

- **DB-backed Admin Settings**
  - A `key/value` table in the database used to store operator-controlled configuration that needs to be changeable at runtime without redeployment
  - `admin_settings` table with a single row `ai_model_tier` read by edge functions via `serviceClient()` (bypasses RLS)

- **Row-Level Security (RLS) for Admin Tables**
  - Only authenticated admin users (checked via `admin_users` join) can read/write the settings; edge functions bypass via service role
  - Applied on `admin_settings`: admin-read + admin-write policies; edge functions use `serviceClient()` which holds the service role key

- **Tier / Tier Map**
  - A named level in a hierarchy that maps to concrete configuration values
  - `ModelTier = "opus" | "sonnet" | "deepseek"` each maps to `{ high: string, low: string }` model IDs in `TIER_MODELS`

- **Lazy Route Loading**
  - Components are only downloaded by the browser when the route is first visited, not on initial page load
  - `AdminSettings` is registered with `lazy(() => import(...))` in `App.tsx`, same pattern as other admin pages
