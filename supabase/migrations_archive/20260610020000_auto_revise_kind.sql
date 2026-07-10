-- Allow a new book_generations kind: 'auto_revise', and teach the self-chain watchdog to revive it.
--
-- auto-revise is the closed eval→revise→re-eval loop. It self-chains exactly like generate-book
-- (one unit of work per invocation, fire-and-forget reinvoke of itself), so a dead link must be
-- recovered by the same pg_cron watchdog. Verbatim re-definition of revive_stalled_chains with the
-- generate-book kind set widened note left intact and an auto-revise loop added.

-- 1. Widen the kind CHECK.
ALTER TABLE public.book_generations DROP CONSTRAINT IF EXISTS book_generations_kind_chk;
ALTER TABLE public.book_generations
  ADD CONSTRAINT book_generations_kind_chk
  CHECK (kind IN ('page_write', 'page_revise', 'write_all', 'rerender_stale', 'scaffold', 'bible', 'voice', 'auto_revise'));

-- 2. Watchdog: revive stalled generate-book, auto-revise, and build-revision chains.
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

  -- generate-book cascades (fill + re-render) stuck in 'running'
  for r in
    select id from public.book_generations
    where kind in ('write_all', 'rerender_stale') and status = 'running' and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/generate-book',
      body := jsonb_build_object('generationId', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;

  -- auto-revise loops stuck in 'running'
  for r in
    select id from public.book_generations
    where kind = 'auto_revise' and status = 'running' and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || '/auto-revise',
      body := jsonb_build_object('generationId', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;

  -- revise builds stuck in 'building' (skip ones the author asked to cancel)
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
