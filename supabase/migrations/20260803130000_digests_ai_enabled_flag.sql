-- Per-digest gate for ALL model calls (search gather, editorial select, write, quiz closer) — the seed
-- column for the paid AI tier. `web_search_enabled` already gates the one adapter that bills per run;
-- this is the broader switch that sits above it, since select/write/quiz now call a model too.
--
-- DEFAULT FALSE for the same reason as web_search_enabled: the paid path is opted INTO, not opted out of.
-- Existing digests keep working without it — every one of the four call sites has a non-model fallback
-- (raw item list instead of written prose, feed order instead of editorial triage, section dropped instead
-- of a written quiz), so turning this off narrows the output, it never breaks the pipeline.
alter table public.digests
  add column if not exists ai_enabled boolean not null default false;

comment on column public.digests.ai_enabled is
  'Umbrella gate for every model call in the pipeline (search/select/write/quiz). False = mechanical fallback only. Also subject to DIGEST_AI_ENABLED env override (see lib/digest/llm.ts aiEnabled) — off by default outside production regardless of this column.';
