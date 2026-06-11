-- Admin transparency: page → generating-call lineage + a labeled artifact manifest per AI call.
--
-- Two additive, forward-only columns (no backfill):
--   pages.last_ai_call_id  — the ai_calls row whose prose generation last wrote this page's body, so
--                            an admin can jump from a page straight to the exact prompt that made it.
--   ai_calls.artifacts     — the LABELED inputs that composed the call's prompt (brief, objective,
--                            beat, character states, open loops, preceding-prose refs). The full
--                            merged prompt already lives in ai_calls.input; this is provenance, so
--                            "which artifacts fed this call" is a column read, not a parse.

alter table public.pages
  add column if not exists last_ai_call_id bigint references public.ai_calls(id) on delete set null;

comment on column public.pages.last_ai_call_id is
  'ai_calls row whose prose generation last wrote this page''s body (admin lineage; null for hand-written or pre-feature pages).';

alter table public.ai_calls
  add column if not exists artifacts jsonb;

comment on column public.ai_calls.artifacts is
  'Labeled inputs that composed this call''s prompt (brief, objective, beat, character_states, open_loops, story_so_far, preceding_prose refs). Provenance for admin transparency; the full merged prompt is still in `input`.';
