-- book_agent_sessions: archived agent conversations, split out of book_agent_runs.sessions (a jsonb
-- array with no eviction). That array embedded the full transcript of every past chat forever — one
-- production thread had grown to ~2MB across 38 archived sessions. Two compounding costs:
--   1. book_agent_runs is REPLICA IDENTITY FULL (20260625140000, to fix the unchanged-TOAST blank-rail
--      bug) — Realtime broadcasts the COMPLETE row on every update, so every tool call during a live
--      turn pushed that whole blob to connected clients.
--   2. "New chat" (startNewAgentSession) had to read the entire array, append one entry, and write the
--      entire array back — a read-modify-write that scales with total history, not the one new entry.
-- One row per archived chat instead: archiving is a single INSERT, the live run row never carries past
-- history, and the history panel can page through this table instead of loading everything at once.

CREATE TABLE IF NOT EXISTS public.book_agent_sessions (
  id          bigint generated always as identity primary key,
  thread_id   bigint not null references public.book_agent_runs(id) on delete cascade,
  book_id     integer not null references public.books(id) on delete cascade,
  steps       jsonb not null default '[]'::jsonb,
  transcript  jsonb not null default '[]'::jsonb,
  proposals   jsonb not null default '[]'::jsonb,
  ended_at    timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS book_agent_sessions_thread_id_ended_at_idx
  ON public.book_agent_sessions (thread_id, ended_at desc);

ALTER TABLE public.book_agent_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read agent sessions" ON public.book_agent_sessions;
CREATE POLICY "editors read agent sessions"
  ON public.book_agent_sessions FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert agent sessions" ON public.book_agent_sessions;
CREATE POLICY "editors insert agent sessions"
  ON public.book_agent_sessions FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors delete agent sessions" ON public.book_agent_sessions;
CREATE POLICY "editors delete agent sessions"
  ON public.book_agent_sessions FOR DELETE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- Backfill: unpack each run's embedded sessions array into rows here. Order doesn't need to be
-- preserved by id — every read orders by ended_at desc, which is already carried on each entry.
INSERT INTO public.book_agent_sessions (thread_id, book_id, steps, transcript, proposals, ended_at)
SELECT
  r.id,
  r.book_id,
  coalesce(elem -> 'steps', '[]'::jsonb),
  coalesce(elem -> 'transcript', '[]'::jsonb),
  coalesce(elem -> 'proposals', '[]'::jsonb),
  coalesce((elem ->> 'ended_at')::timestamptz, r.created_at)
FROM public.book_agent_runs r,
     jsonb_array_elements(r.sessions) AS elem
WHERE jsonb_typeof(r.sessions) = 'array';

ALTER TABLE public.book_agent_runs DROP COLUMN IF EXISTS sessions;
