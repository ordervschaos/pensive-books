-- Cover book_decompositions with the self-chain stall watchdog.
-- dna-decompose advances one link per invocation and re-invokes itself; a dropped link (worker
-- killed between the row patch and the chain dispatch — observed on book 1234 during the
-- 2026-07-08 WORKER_RESOURCE_LIMIT window) left the run 'running' forever with nothing driving
-- it. Same recovery as every other durable task: once a minute, re-kick chains with no progress
-- for 5 minutes. Full-function redefinition (create or replace), same body as
-- 20260701120000 plus the decompositions loop.
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

  -- revise builds stuck in 'building'
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

  -- editor's-agent runs stuck in 'running' (never awaiting_input — that waits on the author)
  for r in
    select id from public.book_agent_runs
    where status = 'running' and not cancel_requested and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/book-agent',
      body := jsonb_build_object('runId', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;

  -- imported-draft decompositions stuck in 'running' (cancel is a status, not a flag, here —
  -- stopRun sets status='cancelled' directly, so the 'running' filter already excludes it)
  for r in
    select id from public.book_decompositions
    where status = 'running' and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/dna-decompose',
      body := jsonb_build_object('id', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;
end;
$$;

comment on function public.revive_stalled_chains() is
  'Once-a-minute pg_cron job: re-invokes the continue call of any generate-book / build-revision / book-agent / dna-decompose job whose self-chain stalled (no progress for 5 min).';
