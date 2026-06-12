-- book_agent_runs: durable runs of the editor's AGENT — the tool-using loop that addresses an
-- editor's evaluation (revise-agent edge function).
--
-- Unlike the one-shot architect (book_revisions.planning), an agent run is a CONVERSATION with
-- state: the Claude transcript is the checkpoint, each self-chain link advances it by one model
-- call, and the run can pause on the author (`awaiting_input`) mid-flight:
--
--   running ⇄ awaiting_input → done            (done = a proposed plan in book_revisions, or a report)
--                            ↘ cancelled / error
--
-- The run never mutates the book itself: its only "write" is inserting a book_revisions row in
-- awaiting_review — from there the existing review dialog + build-revision chain take over.

CREATE TABLE IF NOT EXISTS public.book_agent_runs (
  id               bigint generated always as identity primary key,
  book_id          integer not null references public.books(id) on delete cascade,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  status           text not null default 'running',   -- running|awaiting_input|done|cancelled|error
  evaluation       jsonb,                             -- the eval snapshot the agent is addressing
  transcript       jsonb not null default '[]'::jsonb, -- the Claude messages array (the checkpoint)
  steps            jsonb not null default '[]'::jsonb, -- narrated activity feed for the UI
  pending          jsonb,                             -- awaiting_input payload: { tool_use_id, question, options? }
  turns            integer not null default 0,        -- model calls so far (runaway guard)
  revision_id      bigint references public.book_revisions(id) on delete set null,
  report           text,                              -- the agent's closing summary
  cancel_requested boolean not null default false,
  error            text
);

CREATE INDEX IF NOT EXISTS book_agent_runs_book_id_created_at_idx
  ON public.book_agent_runs (book_id, created_at desc);

-- Touch updated_at on every write (live-vs-stale detection, and the watchdog's idle clock).
CREATE OR REPLACE FUNCTION public.touch_book_agent_runs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS book_agent_runs_touch_updated_at ON public.book_agent_runs;
CREATE TRIGGER book_agent_runs_touch_updated_at
  BEFORE UPDATE ON public.book_agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_book_agent_runs_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Editors read + start runs and may flip cancel_requested; the transcript/status writes come from
-- the edge function (service role). Same surface as book_revisions.
ALTER TABLE public.book_agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read agent runs" ON public.book_agent_runs;
CREATE POLICY "editors read agent runs"
  ON public.book_agent_runs FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert agent runs" ON public.book_agent_runs;
CREATE POLICY "editors insert agent runs"
  ON public.book_agent_runs FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update agent runs" ON public.book_agent_runs;
CREATE POLICY "editors update agent runs"
  ON public.book_agent_runs FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- ── Realtime ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'book_agent_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.book_agent_runs;
  END IF;
END $$;

-- ── Watchdog ──────────────────────────────────────────────────────────────
-- Extend revive_stalled_chains (20260603230000) with a third loop: re-kick agent runs stuck in
-- 'running' (a dropped self-chain link). awaiting_input rows are deliberately NOT revived — they
-- are waiting on the author, not on a worker.
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
      url := v_base || '/revise-agent',
      body := jsonb_build_object('runId', r.id, 'chain', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-chain', v_secret)
    );
  end loop;
end;
$$;

comment on function public.revive_stalled_chains() is
  'Once-a-minute pg_cron job: re-invokes the continue call of any generate-book / build-revision / revise-agent job whose self-chain stalled (no progress for 5 min).';
