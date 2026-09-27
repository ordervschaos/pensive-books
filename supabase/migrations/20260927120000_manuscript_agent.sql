-- Manuscript agent — a second, page-level agent thread per book (kind='manuscript'), driven by the
-- new manuscript-agent edge function. It rides the SAME durable-run table as the Studio's DNA agent
-- (book_agent_runs: RLS, Realtime, cooperative cancel, session archive RPCs all apply unchanged); the
-- only things it needs are a one-per-book guard for its own kind, a column for the author's per-thread
-- model choice, and a watchdog that revives a stalled run through the RIGHT function for its kind.

-- One manuscript thread per book — same guard the Studio thread has (book_agent_runs_one_thread_per_book).
CREATE UNIQUE INDEX IF NOT EXISTS book_agent_runs_one_manuscript_per_book
  ON public.book_agent_runs (book_id) WHERE kind = 'manuscript';

-- The author's model pick for this thread (a model-config tier key, e.g. 'sonnet', 'deepseek-v4').
-- NULL = the admin default agent model. Re-sent with every message, so switching mid-conversation works.
ALTER TABLE public.book_agent_runs ADD COLUMN IF NOT EXISTS context_model text;
COMMENT ON COLUMN public.book_agent_runs.context_model IS
  'Manuscript agent: the author-picked model tier for this thread (NULL = admin default). Read at turn start.';

-- Watchdog: route a stalled book_agent_runs row to the function that owns its kind. Before this every
-- stalled row was kicked through /book-agent, which would drive a manuscript run with the DNA tool belt.
-- Body otherwise identical to the baseline (20260710140000) version.
CREATE OR REPLACE FUNCTION public.revive_stalled_chains() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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

  -- agent runs stuck in 'running' (never awaiting_input — that waits on the author). The function that
  -- owns the run is chosen by kind: 'manuscript' → manuscript-agent, everything else → book-agent.
  for r in
    select id, kind from public.book_agent_runs
    where status = 'running' and not cancel_requested and updated_at < now() - v_stale
  loop
    perform net.http_post(
      url := v_base || case when r.kind = 'manuscript' then '/manuscript-agent' else '/book-agent' end,
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

COMMENT ON FUNCTION public.revive_stalled_chains() IS
  'Once-a-minute pg_cron job: re-invokes the continue call of any generate-book / build-revision / book-agent / manuscript-agent / dna-decompose job whose self-chain stalled (no progress for 5 min).';
