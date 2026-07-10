-- Self-chain watchdog: restart a long AI job whose chain dropped a link.
--
-- generate-book (write_all) and build-revision (the revise build) advance ONE unit per edge
-- invocation, then fire-and-forget a call to themselves for the next unit. If one of those
-- self-calls is ever lost (a worker killed between persisting progress and dispatching the next
-- call, a transient network blip), the job would stall forever in 'running'/'building'. This cron
-- job is the safety net: once a minute it finds jobs that haven't advanced in a while and re-kicks
-- their chain via pg_net — exactly the continue call the function would have made.
--
-- Idempotency / racing live work: the threshold is deliberately generous (5 minutes). A single page
-- generation (with retries) can take a couple of minutes, during which updated_at doesn't advance;
-- re-invoking then would double-write that page. Five minutes is comfortably past any live unit, so
-- the watchdog only ever fires on a genuinely dead chain — accepting up to ~5 min recovery latency.
--
-- Auth: the continue call carries the x-chain secret (Vault 'chain_secret', the same value set as
-- the CHAIN_SECRET edge env). generate-book / build-revision have verify_jwt=false, so the request
-- needs no user JWT — isChainCall() gates it. Mirrors notify_task_done()'s pg_net pattern.
--
-- SETUP (run once, out of band — already done for this project; documented for fresh environments):
--   select vault.create_secret('<long-random>', 'chain_secret', '...');   -- == CHAIN_SECRET edge env

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.revive_stalled_chains()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_base   text := 'https://qiqeyirtpstdjkkeyfss.supabase.co/functions/v1';
  v_stale  interval := interval '5 minutes';
  r        record;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'chain_secret' limit 1;
  -- No secret → the continue call would 401; do nothing rather than hammer the function.
  if v_secret is null then
    raise warning 'revive_stalled_chains: no chain_secret in vault; skipping';
    return;
  end if;

  -- write_all cascades stuck in 'running'
  for r in
    select id from public.book_generations
    where kind = 'write_all' and status = 'running' and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/generate-book',
      body := jsonb_build_object('generationId', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;

  -- revise builds stuck in 'building' (skip ones the author asked to cancel — the next continue
  -- call would cancel them, but no need to wake a job that's about to stop)
  for r in
    select id from public.book_revisions
    where status = 'building' and not cancel_requested and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/build-revision',
      body := jsonb_build_object('revisionId', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;
end;
$$;

comment on function public.revive_stalled_chains() is
  'Once-a-minute pg_cron job: re-invokes the continue call of any generate-book / build-revision job whose self-chain stalled (no progress for 5 min).';

-- Schedule it every minute (idempotent: unschedule a prior definition first).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'revive-stalled-chains') then
    perform cron.unschedule('revive-stalled-chains');
  end if;
  perform cron.schedule('revive-stalled-chains', '* * * * *', 'select public.revive_stalled_chains();');
end $$;
