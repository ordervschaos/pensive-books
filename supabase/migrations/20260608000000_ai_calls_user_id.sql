-- Add user_id to ai_calls so we can distinguish user-triggered calls from automated ones
-- (self-chains, pg_cron watchdog). Null = system/automated, non-null = a real user triggered it.
alter table public.ai_calls
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists ai_calls_user_idx on public.ai_calls (user_id, created_at desc);
