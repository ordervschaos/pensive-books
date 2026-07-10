-- ai_calls.status — make an in-flight call visible the instant it starts.
--
-- Until now a row was written only AFTER the Claude call returned (on the bridge: on subprocess
-- close). A long call (e.g. a 30-min replan) was therefore invisible in /admin/ai-calls until it
-- finished or errored. Now the chokepoint inserts a 'running' row at START and updates it to
-- 'done'/'error' at the end, so the admin page (which polls) shows live in-flight work.
--
-- Default 'done' backfills the existing finished rows. A worker killed mid-call can leave a stale
-- 'running' row (no terminal update) — acceptable for an observability table; the partial index
-- makes such rows cheap to find/reap later.
alter table public.ai_calls
  add column if not exists status text not null default 'done'
  check (status in ('running', 'done', 'error'));

create index if not exists ai_calls_status_running_idx
  on public.ai_calls (created_at desc) where status = 'running';
