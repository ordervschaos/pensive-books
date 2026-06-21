-- dna_chats: the per-STAGE conversational reviser for the Novel DNA journey (the dna-chat edge fn).
-- Mirrors revision_chats, but scoped to a DNA journey stage instead of a legacy layer. One thread per
-- (book, stage): the author talks to a stage-focused story editor that holds that resolution's context
-- and actions, and may propose a structured change to the tree. The edge fn is the single writer
-- (append author msg → model → append reply → store any proposal); the client subscribes over Realtime
-- and projects the row (refresh = no-op). A proposed change rides in pending_proposal until applied
-- (node ops over book_nodes) or discarded. See docs/novel-dna-spec.md.

CREATE TABLE IF NOT EXISTS public.dna_chats (
  id                bigint generated always as identity primary key,
  book_id           integer not null references public.books(id) on delete cascade,
  stage             text not null check (stage in ('premise','foundations','structure','scenes','draft')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  status            text not null default 'idle',           -- idle | thinking | error
  messages          jsonb not null default '[]'::jsonb,      -- [{ role:'user'|'assistant', text, ts, plan? }]
  pending_proposal  jsonb,                                   -- { summary, ops:[…] } awaiting review (or null)
  error             text,
  unique (book_id, stage)
);

CREATE OR REPLACE FUNCTION public.touch_dna_chats_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS dna_chats_touch_updated_at ON public.dna_chats;
CREATE TRIGGER dna_chats_touch_updated_at
  BEFORE UPDATE ON public.dna_chats
  FOR EACH ROW EXECUTE FUNCTION public.touch_dna_chats_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Editors read + start a thread; message/proposal writes come from the edge fn (service role).
ALTER TABLE public.dna_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read dna_chats" ON public.dna_chats;
CREATE POLICY "editors read dna_chats" ON public.dna_chats FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));
DROP POLICY IF EXISTS "editors insert dna_chats" ON public.dna_chats;
CREATE POLICY "editors insert dna_chats" ON public.dna_chats FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));
DROP POLICY IF EXISTS "editors update dna_chats" ON public.dna_chats;
CREATE POLICY "editors update dna_chats" ON public.dna_chats FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- ── Realtime ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'dna_chats'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dna_chats;
  END IF;
END $$;
