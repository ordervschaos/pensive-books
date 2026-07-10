-- Rename the editor's-agent edge function revise-agent → book-agent.
-- The self-chain stall watchdog (revive_stalled_chains, pg_cron once-a-minute) hardcodes the
-- function URL it re-pokes, so it must be repointed at /book-agent or it would 404 stalled agent
-- runs once the old function is deleted. Only the book_agent_runs loop's URL + the comment change;
-- the generate-book / build-revision loops are untouched.
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
end;
$$;

comment on function public.revive_stalled_chains() is
  'Once-a-minute pg_cron job: re-invokes the continue call of any generate-book / build-revision / book-agent job whose self-chain stalled (no progress for 5 min).';
