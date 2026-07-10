-- Create book_thread_scans: the durable, reviewable output of a thread scan.
--
-- A thread scan (scan-threads) is an EXPENSIVE Claude call that returns a DIFF the author reviews
-- before applying to book_threads. Holding that diff only in React state meant a refresh threw the
-- paid result away. So we persist it here the moment it lands — exactly like book_evaluations and
-- book_revisions persist their AI output — and resume the review on reload.
--
-- Lifecycle:
--   pending_review → just scanned; the author hasn't applied or dismissed it yet (resume on reload)
--   applied        → the author applied (some/all of) the diff to book_threads
--   dismissed      → the author explicitly discarded it (Cancel), or it was superseded by a re-scan
--
-- The newest row per book is the source of truth: if it's pending_review, the panel resumes that
-- review; otherwise it shows the tracked-threads list. `changes` is the SERVER-RESOLVED diff
-- (word offsets + distances already computed), so a resumed review needs no recomputation.
--
-- Reuses user_can_edit_book(_book_id) for RLS, like book_threads. Author-only, full CRUD: the scan
-- is created and its status advanced from the client/edge under the author's JWT.

CREATE TABLE IF NOT EXISTS public.book_thread_scans (
  id          bigint generated always as identity primary key,
  book_id     integer not null references public.books(id) on delete cascade,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),

  status      text not null default 'pending_review',  -- pending_review | applied | dismissed
  summary     text,                                     -- the scan's 2-3 sentence overview
  changes     jsonb not null default '[]'::jsonb,       -- ThreadChange[] (server-resolved)
  model       text,

  CONSTRAINT book_thread_scans_status_chk
    CHECK (status IN ('pending_review', 'applied', 'dismissed'))
);

-- "latest scan for this book" — the lookup the panel does on every load.
CREATE INDEX IF NOT EXISTS book_thread_scans_book_id_created_idx
  ON public.book_thread_scans (book_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Author-only, same surface as editing the book (mirrors book_threads).
ALTER TABLE public.book_thread_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read thread scans" ON public.book_thread_scans;
CREATE POLICY "editors read thread scans"
  ON public.book_thread_scans FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert thread scans" ON public.book_thread_scans;
CREATE POLICY "editors insert thread scans"
  ON public.book_thread_scans FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update thread scans" ON public.book_thread_scans;
CREATE POLICY "editors update thread scans"
  ON public.book_thread_scans FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors delete thread scans" ON public.book_thread_scans;
CREATE POLICY "editors delete thread scans"
  ON public.book_thread_scans FOR DELETE TO authenticated
  USING (public.user_can_edit_book(book_id));
