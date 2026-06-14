-- beat_chats: the durable conversation behind the beat editor (beats-agent edge function).
--
-- The author talks to a story editor about the BEAT SHEET — asking questions, asking for a summary,
-- evaluating against the fiction criteria, and sometimes asking for a change. It's a CONVERSATION,
-- not a one-shot: each turn is one model call. The edge function is the single writer (it appends the
-- author's message, calls the model, appends the reply, and stores any proposed plan); the client
-- subscribes over Realtime and just projects the row (refresh = no-op).
--
-- One thread per book (book_id unique). A proposed beat revision rides in `pending_plan` until the
-- author applies it (build-revision, via a book_revisions row) or discards it.

CREATE TABLE IF NOT EXISTS public.beat_chats (
  id            bigint generated always as identity primary key,
  book_id       integer not null unique references public.books(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  status        text not null default 'idle',          -- idle | thinking | error
  messages      jsonb not null default '[]'::jsonb,     -- [{ role:'user'|'assistant', text, ts, plan? }]
  pending_plan  jsonb,                                  -- the latest proposed RevisionPlan awaiting review (or null)
  error         text
);

-- Touch updated_at on every write (the "thinking" stale clock + live-vs-stale detection).
CREATE OR REPLACE FUNCTION public.touch_beat_chats_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS beat_chats_touch_updated_at ON public.beat_chats;
CREATE TRIGGER beat_chats_touch_updated_at
  BEFORE UPDATE ON public.beat_chats
  FOR EACH ROW EXECUTE FUNCTION public.touch_beat_chats_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Editors read + start a thread; the message/plan writes come from the edge function (service role).
ALTER TABLE public.beat_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read beat chats" ON public.beat_chats;
CREATE POLICY "editors read beat chats"
  ON public.beat_chats FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert beat chats" ON public.beat_chats;
CREATE POLICY "editors insert beat chats"
  ON public.beat_chats FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update beat chats" ON public.beat_chats;
CREATE POLICY "editors update beat chats"
  ON public.beat_chats FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- ── Realtime ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'beat_chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.beat_chats;
  END IF;
END $$;
