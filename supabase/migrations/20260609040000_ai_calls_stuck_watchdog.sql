-- ai_calls stuck-row watchdog.
--
-- ai_calls rows are inserted as 'running' at the START of a Claude/DeepSeek call and
-- updated to 'done'/'error' when it finishes. If the edge function worker dies mid-call
-- (wall-clock timeout, OOM, unhandled rejection in the caller) the update never fires
-- and the row stays 'running' forever — polluting the admin view.
--
-- This cron job marks any row that has been 'running' for more than 10 minutes as
-- 'error' with a clear message. 10 min is generous: even the longest legitimate call
-- (evaluate-book on a large manuscript) finishes within ~5 min before the Supabase
-- free-tier wall-clock kills the worker.

create extension if not exists pg_cron;

create or replace function public.expire_stalled_ai_calls()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_calls
  set
    status = 'error',
    error  = 'timed out — worker exited before logging a result',
    latency_ms = extract(epoch from (now() - created_at))::int * 1000
  where status = 'running'
    and created_at < now() - interval '10 minutes';
end;
$$;

comment on function public.expire_stalled_ai_calls() is
  'Every 5 minutes: mark ai_calls rows stuck in ''running'' for >10 min as error (worker died before logging).';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-stalled-ai-calls') then
    perform cron.unschedule('expire-stalled-ai-calls');
  end if;
  perform cron.schedule('expire-stalled-ai-calls', '*/5 * * * *', 'select public.expire_stalled_ai_calls();');
end $$;
