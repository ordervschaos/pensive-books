-- Prompt-cache visibility per call: until now cache behavior was inferred from latency. Providers
-- report it in usage; llm.ts was discarding it.
--   cache_read_tokens  — input tokens served from the provider's prompt cache
--                        (Anthropic cache_read_input_tokens · DeepSeek prompt_cache_hit_tokens ·
--                         OpenAI prompt_tokens_details.cached_tokens)
--   cache_write_tokens — tokens written INTO the cache this call (Anthropic
--                        cache_creation_input_tokens; other providers don't report a write count)
-- Null = provider reported nothing (or pre-2026-07-23 row) — distinct from 0 (reported, no hit).
alter table public.ai_calls add column if not exists cache_read_tokens int;
alter table public.ai_calls add column if not exists cache_write_tokens int;

comment on column public.ai_calls.cache_read_tokens is
  'Input tokens served from the provider prompt cache (Anthropic cache_read_input_tokens / DeepSeek prompt_cache_hit_tokens / OpenAI cached_tokens). Null = not reported.';
comment on column public.ai_calls.cache_write_tokens is
  'Tokens written into the provider prompt cache this call (Anthropic cache_creation_input_tokens). Null = not reported.';
