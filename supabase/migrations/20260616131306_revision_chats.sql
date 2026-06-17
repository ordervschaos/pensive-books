-- revision_chats: the durable conversation behind the UNIFIED revision layer (revise-chat edge fn).
--
-- Generalizes beat_chats: instead of one beat-only thread per book, this is ONE THREAD PER (book,
-- layer) — the author talks to a layer-focused story editor (foundations / spine / beats) that holds
-- that layer's knowledge base, asks questions, evaluates, and sometimes proposes a structured change.
-- The edge function is the single writer (append author msg → model call → append reply → store any
-- proposal); the client subscribes over Realtime and projects the row (refresh = no-op).
--
-- A proposed change rides in `pending_proposal` (a layer-tagged RevisionProposal envelope) until the
-- author applies it (the per-layer write path — writeFoundations / saveSpine / build-revision) or
-- discards it.

CREATE TABLE IF NOT EXISTS public.revision_chats (
  id                bigint generated always as identity primary key,
  book_id           integer not null references public.books(id) on delete cascade,
  layer             text not null check (layer in ('foundations','spine','beats')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  status            text not null default 'idle',          -- idle | thinking | error
  messages          jsonb not null default '[]'::jsonb,     -- [{ role:'user'|'assistant', text, ts, plan? }]
  pending_proposal  jsonb,                                  -- the latest proposed RevisionProposal awaiting review (or null)
  error             text,
  unique (book_id, layer)
);

-- Touch updated_at on every write (the "thinking" stale clock + live-vs-stale detection).
CREATE OR REPLACE FUNCTION public.touch_revision_chats_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS revision_chats_touch_updated_at ON public.revision_chats;
CREATE TRIGGER revision_chats_touch_updated_at
  BEFORE UPDATE ON public.revision_chats
  FOR EACH ROW EXECUTE FUNCTION public.touch_revision_chats_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Editors read + start a thread; the message/proposal writes come from the edge fn (service role).
ALTER TABLE public.revision_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read revision chats" ON public.revision_chats;
CREATE POLICY "editors read revision chats"
  ON public.revision_chats FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert revision chats" ON public.revision_chats;
CREATE POLICY "editors insert revision chats"
  ON public.revision_chats FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update revision chats" ON public.revision_chats;
CREATE POLICY "editors update revision chats"
  ON public.revision_chats FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- ── Realtime ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'revision_chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.revision_chats;
  END IF;
END $$;

-- ── Carry the existing beats threads over (layer='beats'), mapping pending_plan → the
--    pending_proposal envelope. beat_chats is kept one release as a safety net; new writes land here.
INSERT INTO public.revision_chats (book_id, layer, created_at, updated_at, status, messages, pending_proposal, error)
SELECT
  bc.book_id,
  'beats',
  bc.created_at,
  bc.updated_at,
  CASE WHEN bc.status = 'thinking' THEN 'idle' ELSE bc.status END,  -- don't import a stuck "thinking"
  bc.messages,
  CASE
    WHEN bc.pending_plan IS NULL THEN NULL
    ELSE jsonb_build_object(
      'summary', coalesce(bc.pending_plan->>'summary', ''),
      'patch', jsonb_build_object('layer', 'beats', 'data', bc.pending_plan)
    )
  END,
  bc.error
FROM public.beat_chats bc
ON CONFLICT (book_id, layer) DO NOTHING;
