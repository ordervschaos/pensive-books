-- context_variant — an A/B seam on the agent thread.
--
-- Why a column rather than two deployments: comparing agent versions by "deploy A, run N trials, deploy B,
-- run N trials" is TIME-CONFOUNDED — provider-side model updates, load, and cache state all drift between
-- the halves, and none of that can be separated from the change under test. With both arms live in ONE
-- deploy, trials can be interleaved (A, B, A, B) and randomised, so drift hits both arms equally.
--
-- NULL is production. The edge function must behave byte-identically when this is unset — the seam exists
-- for evals and must never change what a real author gets.
alter table public.book_agent_runs add column if not exists context_variant text;

comment on column public.book_agent_runs.context_variant is
  'Eval A/B arm for this thread (see book-agent/variants.ts). NULL = production behaviour, unchanged.';
