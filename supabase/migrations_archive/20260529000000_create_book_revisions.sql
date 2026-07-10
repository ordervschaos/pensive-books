-- Create book_revisions: durable, resumable "revise this book with AI" tasks.
--
-- Generalizes book_evaluations (20260527000000). A revision is a long task with a
-- lifecycle the author can leave and come back to:
--
--   planning → awaiting_review → building → done
--                             ↘ cancelled / error
--
-- The row is the single source of truth, watched over Realtime, so closing the tab
-- never loses work: completed pages are already persisted, `progress` records what's
-- done, and reopening the book resumes from the first unfinished page. The architect
-- output lives in `plan`; the per-page build state in `progress`.
--
-- Reuses user_can_edit_book(_book_id) from 20260527000000 for the RLS predicate.

CREATE TABLE IF NOT EXISTS public.book_revisions (
  id               bigint generated always as identity primary key,
  book_id          integer not null references public.books(id) on delete cascade,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  status           text not null default 'planning',  -- planning|awaiting_review|building|done|cancelled|error
  source           text not null default 'prompt',    -- prompt | evaluation
  instruction      text,                              -- the author's free-text ask
  evaluation_id    bigint references public.book_evaluations(id) on delete set null,
  evaluation       jsonb,                             -- the eval snapshot fed to the architect (if any)
  plan             jsonb,                             -- the revision plan (architect output)
  progress         jsonb,                             -- build state: { structureDone, addedIds, tasks[], done, total }
  version_id       bigint,                            -- snapshot taken before building = restore point
  cancel_requested boolean not null default false,
  error            text
);

CREATE INDEX IF NOT EXISTS book_revisions_book_id_created_at_idx
  ON public.book_revisions (book_id, created_at desc);

-- Touch updated_at on every write (so the UI can tell a live task from a stale one).
CREATE OR REPLACE FUNCTION public.touch_book_revisions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS book_revisions_touch_updated_at ON public.book_revisions;
CREATE TRIGGER book_revisions_touch_updated_at
  BEFORE UPDATE ON public.book_revisions
  FOR EACH ROW EXECUTE FUNCTION public.touch_book_revisions_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Author-only, same surface as editing the book. Unlike evaluations (written by an
-- edge function with the service role), revisions are driven CLIENT-side, so the
-- author needs INSERT/UPDATE here too.
ALTER TABLE public.book_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read revisions" ON public.book_revisions;
CREATE POLICY "editors read revisions"
  ON public.book_revisions FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert revisions" ON public.book_revisions;
CREATE POLICY "editors insert revisions"
  ON public.book_revisions FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update revisions" ON public.book_revisions;
CREATE POLICY "editors update revisions"
  ON public.book_revisions FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

-- ── Realtime ──────────────────────────────────────────────────────────────
-- So a reopened tab learns when planning → awaiting_review → building → done
-- without polling. Guarded: ADD TABLE errors if already in the publication.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'book_revisions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.book_revisions;
  END IF;
END $$;
