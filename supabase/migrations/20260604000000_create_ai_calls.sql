-- ai_calls: one row per Claude invocation — the LLM layer beneath the task rows.
--
-- The task tables (book_evaluations, book_generations, book_revisions, book_thread_scans) already
-- store each activity's `input` params and PARSED `result`. They do NOT capture the LLM call itself:
-- the assembled prompt (system + the full context block — bible, objective map, story-so-far,
-- preceding prose), the RAW completion before our code parses/strips it, the model, token usage,
-- latency, and stop_reason. This table is that missing layer, so "analyze context and results" is a
-- query — and it links back to the task row it served via (task_table, task_id).
--
-- Written by the service role only: the edge functions log through _shared/claude.ts (source='edge')
-- and the dev bridge logs its local `claude -p` runs (source='bridge'). Logging is best-effort and
-- never breaks the AI call.

create table if not exists public.ai_calls (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  book_id       integer references public.books(id) on delete set null,  -- keep logs if a book is deleted
  task_table    text,            -- 'book_evaluations' | 'book_generations' | 'book_revisions' | 'book_thread_scans'
  task_id       bigint,          -- the durable task row this call served (join key)
  fn            text not null,   -- logical step: 'evaluate-book' | 'generate-unit' | 'summarize' | 'scan-page' | ...
  source        text not null default 'edge',  -- 'edge' | 'bridge'
  model         text,
  system        text,            -- the system prompt (flattened from string or text blocks)
  input         jsonb,           -- the messages array = the assembled context sent to the model
  output        text,            -- the raw completion text, pre-parse
  input_tokens  integer,
  output_tokens integer,
  latency_ms    integer,
  stop_reason   text,
  error         text
);

create index if not exists ai_calls_book_created_idx on public.ai_calls (book_id, created_at desc);
create index if not exists ai_calls_task_idx          on public.ai_calls (task_table, task_id);
create index if not exists ai_calls_fn_created_idx     on public.ai_calls (fn, created_at desc);

alter table public.ai_calls enable row level security;

-- Read: owner + editor + admin, via the shared predicate (it already folds in admins, and returns
-- true for admins even on null-book rows). No insert/update/delete policies → writes only via the
-- service role, which bypasses RLS. No editor UI yet; this gates future PostgREST/SQL reads.
drop policy if exists "editors_and_admins_read_ai_calls" on public.ai_calls;
create policy "editors_and_admins_read_ai_calls"
  on public.ai_calls
  for select
  using (public.user_can_edit_book(book_id));
