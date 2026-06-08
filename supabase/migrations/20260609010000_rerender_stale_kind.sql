-- Allow a new book_generations kind: 'rerender_stale'.
--
-- The "re-render out-of-sync pages" run is the generate-book cascade in its pageIds mode: it rewrites
-- named pages that already have prose (clobbering it) and re-stamps prose_src_hash so they're back in
-- sync with the plan. It's a DISTINCT kind from 'write_all' so the "Write all pages" watcher doesn't
-- adopt a re-render run's progress — but it self-chains the same way, so the watchdog must cover it.

-- 1. Widen the kind CHECK to include the new kind.
ALTER TABLE public.book_generations DROP CONSTRAINT IF EXISTS book_generations_kind_chk;
ALTER TABLE public.book_generations
  ADD CONSTRAINT book_generations_kind_chk
  CHECK (kind IN ('page_write', 'page_revise', 'write_all', 'rerender_stale', 'scaffold', 'bible'));

-- 2. Teach the self-chain watchdog to revive a stalled rerender_stale chain too (same generate-book
-- continue call as write_all). Verbatim re-definition with the kind filter widened.
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
