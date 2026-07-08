-- book_decompositions: the durable task row for the imported-draft SEMANTIC ASCENT ("infer plan").
-- Until now the run lived only in the tab's JS — a refresh killed it and the button forgot it was
-- running (violating the refresh-is-a-no-op standard every other AI task follows). Same contract as
-- book_generations/book_revisions: the row is the single source of truth, written server-side by the
-- self-chaining dna-decompose fn, watched over Realtime by DecomposeButton.
--
-- Lifecycle:  running → done            (phases: chapters → top → entities → systems → seal)
--                     → cancelled       (stopRun sets it; the next chain link sees it and exits)
--                     → error
--
-- digests: one slot per prose-bearing chapter, filled as chapter reads land (jsonb array, index-
-- aligned with reading order so the systems step's chapter numbers map to the right beats).

CREATE TABLE IF NOT EXISTS public.book_decompositions (
  id          bigint generated always as identity primary key,
  book_id     integer not null references public.books(id) on delete cascade,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  status      text not null default 'running',   -- running|done|cancelled|error
  phase       text not null default 'chapters',  -- chapters|top|entities|systems|seal
  done        integer not null default 0,        -- chapter reads completed
  total       integer not null default 0,        -- prose-bearing chapters
  digests     jsonb not null default '[]',       -- [{title, digest} | null] per chapter index
  skipped     jsonb not null default '[]',       -- human-readable notes for dropped items
  error       text,

  CONSTRAINT book_decompositions_status_chk
    CHECK (status IN ('running', 'done', 'cancelled', 'error')),
  CONSTRAINT book_decompositions_phase_chk
    CHECK (phase IN ('chapters', 'top', 'entities', 'systems', 'seal'))
);

CREATE INDEX IF NOT EXISTS book_decompositions_book_id_created_idx
  ON public.book_decompositions (book_id, created_at DESC);

-- Touch updated_at on every write — the UI uses it to tell a live run from a stalled one.
CREATE OR REPLACE FUNCTION public.touch_book_decompositions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS book_decompositions_touch_updated_at ON public.book_decompositions;
CREATE TRIGGER book_decompositions_touch_updated_at
  BEFORE UPDATE ON public.book_decompositions
  FOR EACH ROW EXECUTE FUNCTION public.touch_book_decompositions_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Author-only, same surface as editing the book (mirrors book_generations).
ALTER TABLE public.book_decompositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read decompositions" ON public.book_decompositions;
CREATE POLICY "editors read decompositions"
  ON public.book_decompositions FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert decompositions" ON public.book_decompositions;
CREATE POLICY "editors insert decompositions"
  ON public.book_decompositions FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update decompositions" ON public.book_decompositions;
CREATE POLICY "editors update decompositions"
  ON public.book_decompositions FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- ── Realtime ────────────────────────────────────────────────────────────────
-- So a reopened tab learns running → done/cancelled/error without polling.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'book_decompositions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.book_decompositions;
  END IF;
END $$;
