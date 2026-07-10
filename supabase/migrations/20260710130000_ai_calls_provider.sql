-- ai_calls.provider — WHICH HOST actually served the call.
--
-- `model` records what the caller ASKED for (e.g. "deepseek/deepseek-v4-pro"), which is not enough to know
-- where the tokens were spent: the same id is servable by OpenRouter, MuleRouter, and DeepSeek's own API, and
-- the admin `ai_provider` switch (plus its fallback when a provider can't serve a model) picks between them at
-- call time. Without this column the switch is unobservable — you can flip it and not be able to prove it took.
--
-- Nullable: rows written before this column existed, and any future writer that doesn't resolve a route.
alter table public.ai_calls add column if not exists provider text;

comment on column public.ai_calls.provider is
  'Host that served the call (anthropic | openrouter | deepseek | mulerouter), as resolved by resolveRoute from the model id and the ai_provider admin setting. Null for rows logged before 2026-07-10.';
