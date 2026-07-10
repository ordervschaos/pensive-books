-- Create book_evaluations: stored "editor's read" reports.
--
-- One row per run → history is kept. An evaluation is a point-in-time event
-- ("on DATE, at N words, the editor said X"), not a living document, so re-running
-- after a revision adds a NEW row rather than overwriting — that's how an author
-- sees progress across drafts.
--
-- `result` JSONB is the contract shared by the evaluate-book edge function (writer)
-- and BookEvaluationSection.tsx (reader). Shape: { verdict:{genre_contract, stance,
-- letter, priorities[]}, sections:[{id, title, stance, assessment, strengths[],
-- issues:[{severity, note, evidence, suggestion, page_ref}]}] }.

-- ── Edit predicate ──────────────────────────────────────────────────────────
-- "Can the current user edit this book?" = owner OR accepted editor. Routed through
-- SECURITY DEFINER so the inner reads bypass RLS — this is the repo's pattern for
-- avoiding the books↔book_access recursion fixed in 20260520000002. Composes the
-- existing user_is_book_editor() helper (access_level='edit' AND status='accepted').
CREATE OR REPLACE FUNCTION public.user_can_edit_book(_book_id integer)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.books
    WHERE books.id = _book_id
      AND books.owner_id = auth.uid()
  ) OR public.user_is_book_editor(_book_id);
$$;

-- ── Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.book_evaluations (
  id             bigint generated always as identity primary key,
  book_id        integer not null references public.books(id) on delete cascade,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  kind           text not null default 'fiction',   -- fiction | nonfiction
  model          text,                              -- e.g. 'claude-opus-4-7'
  status         text not null default 'pending',   -- pending | done | error
  word_count     integer,                           -- manuscript size at run time
  brief_snapshot jsonb,                             -- the brief used (staleness / compare)
  result         jsonb,                             -- the editor's read (UI contract above)
  error          text
);

CREATE INDEX IF NOT EXISTS book_evaluations_book_id_created_at_idx
  ON public.book_evaluations (book_id, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Reports are author-only — same surface as editing the book. The edge function
-- writes with the service role (RLS-exempt); these policies govern CLIENT reads
-- (initial load + Realtime) and any client-side writes.
ALTER TABLE public.book_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read evaluations" ON public.book_evaluations;
CREATE POLICY "editors read evaluations"
  ON public.book_evaluations
  FOR SELECT
  TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert evaluations" ON public.book_evaluations;
CREATE POLICY "editors insert evaluations"
  ON public.book_evaluations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update evaluations" ON public.book_evaluations;
CREATE POLICY "editors update evaluations"
  ON public.book_evaluations
  FOR UPDATE
  TO authenticated
  USING (public.user_can_edit_book(book_id));

-- ── Realtime ──────────────────────────────────────────────────────────────
-- So the browser learns when a background eval flips pending → done without polling.
-- Guarded: ADD TABLE errors if the table is already in the publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'book_evaluations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.book_evaluations;
  END IF;
END $$;
