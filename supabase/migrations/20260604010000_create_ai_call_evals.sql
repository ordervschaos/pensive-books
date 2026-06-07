-- ai_call_evals: on-demand quality judgement of a logged AI call (phase 2, on top of ai_calls).
--
-- ai_calls captures WHAT was sent and returned. This table captures HOW GOOD that was: an
-- LLM-as-judge reads the call's (fn, system, context, output) and scores whether the output served
-- its context, with concrete findings and suggested amendments. Eval is ON DEMAND — a row is created
-- only when someone asks to judge a call (the edge fn evaluate-ai-call, the dev bridge /eval-call, or
-- scripts/eval-calls.mjs), never automatically.
--
-- amendments[].target is 'output' | 'prompt' | 'code': when judged via the dev bridge (Claude Code,
-- which has the repo), 'code' amendments can name the real prompt-assembly file/function to change;
-- the edge judge has no repo so its 'code' notes stay descriptive. Applying any code change is a
-- human/review step — this table only records the recommendation.

create table if not exists public.ai_call_evals (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  ai_call_id  bigint not null references public.ai_calls(id) on delete cascade,
  book_id     integer references public.books(id) on delete set null,  -- denormalized for RLS/filtering
  status      text not null default 'pending' check (status in ('pending','running','done','error')),
  judge_model text,
  scores      jsonb,   -- { objective_fidelity, context_use, instruction_following, quality } each 1-5
  verdict     text,    -- short overall label
  findings    jsonb,   -- [{ criterion, severity, note, evidence }]
  amendments  jsonb,   -- [{ target: 'output'|'prompt'|'code', suggestion, rationale }]
  error       text
);

create index if not exists ai_call_evals_call_idx          on public.ai_call_evals (ai_call_id);
create index if not exists ai_call_evals_book_created_idx  on public.ai_call_evals (book_id, created_at desc);

alter table public.ai_call_evals enable row level security;

-- Same read predicate as ai_calls: owner + editor + admin. Writes via the service role only.
drop policy if exists "editors_and_admins_read_ai_call_evals" on public.ai_call_evals;
create policy "editors_and_admins_read_ai_call_evals"
  on public.ai_call_evals
  for select
  using (public.user_can_edit_book(book_id));
