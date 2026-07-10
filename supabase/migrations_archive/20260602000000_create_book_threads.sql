-- Create book_threads: tracked narrative threads (foreshadowing / open loops / setups).
--
-- A thread is a promise the book makes and must keep: a setup that wants a payoff. Unlike
-- per-page summaries (pages.metadata.summary), a thread cuts ACROSS pages, so it lives in
-- its own table. The point is to manage foreshadowing DISTANCE — how far (in words) a setup
-- is from its payoff — so an author can see open loops and close them deliberately.
--
-- Lifecycle:
--   planned  → scaffold INTENDS the thread (target setup/payoff pages); prose hasn't seeded it
--   open     → prose has seeded the setup; not yet paid off
--   closed   → paid off
--
-- Threads are AI-extracted by default (the scan-threads function reconciles prose against the
-- existing rows and proposes a diff) but author-editable. `author_locked` protects a row the
-- author has edited: the reconcile pass proposes AROUND it instead of overwriting.
--
-- Anchors are stored as page id + word_offset (cumulative manuscript words before that point).
-- The setup→payoff DISTANCE is payoff.word_offset − setup.word_offset; `target_distance` is the
-- planned budget set at scaffold time.
--
-- Reuses user_can_edit_book(_book_id) from 20260527000000 for the RLS predicate. Like
-- book_revisions, threads are driven CLIENT-side (the author applies a reviewed scan diff and
-- hand-edits rows), so authors need INSERT/UPDATE/DELETE here, not just the edge function.

CREATE TABLE IF NOT EXISTS public.book_threads (
  id                 bigint generated always as identity primary key,
  book_id            integer not null references public.books(id) on delete cascade,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  name               text not null,                    -- short label, e.g. "Mara's locket"
  description        text,                             -- what the thread promises / pays off
  status             text not null default 'open',     -- planned | open | closed

  -- Setup anchor: where the thread is seeded. page id is a target at scaffold time, confirmed
  -- once prose seeds it. on delete set null so deleting a page doesn't orphan the thread row.
  setup_page_id      integer references public.pages(id) on delete set null,
  setup_word_offset  integer,                          -- cumulative words before the setup

  -- Payoff anchor: where the thread is closed (null until paid off).
  payoff_page_id     integer references public.pages(id) on delete set null,
  payoff_word_offset integer,

  target_distance    integer,                          -- planned setup→payoff distance (words)

  source             text not null default 'ai',       -- ai | author (who proposed it)
  author_locked      boolean not null default false,   -- author edited → reconcile must not clobber

  CONSTRAINT book_threads_status_chk CHECK (status IN ('planned', 'open', 'closed')),
  CONSTRAINT book_threads_source_chk CHECK (source IN ('ai', 'author'))
);

CREATE INDEX IF NOT EXISTS book_threads_book_id_idx
  ON public.book_threads (book_id, status);

-- Touch updated_at on every write (lets the UI tell a freshly-reconciled thread from a stale one).
CREATE OR REPLACE FUNCTION public.touch_book_threads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS book_threads_touch_updated_at ON public.book_threads;
CREATE TRIGGER book_threads_touch_updated_at
  BEFORE UPDATE ON public.book_threads
  FOR EACH ROW EXECUTE FUNCTION public.touch_book_threads_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Author-only, same surface as editing the book. Client-driven (apply scan diff + hand-edit),
-- so editors need full CRUD.
ALTER TABLE public.book_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "editors read threads" ON public.book_threads;
CREATE POLICY "editors read threads"
  ON public.book_threads FOR SELECT TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors insert threads" ON public.book_threads;
CREATE POLICY "editors insert threads"
  ON public.book_threads FOR INSERT TO authenticated
  WITH CHECK (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors update threads" ON public.book_threads;
CREATE POLICY "editors update threads"
  ON public.book_threads FOR UPDATE TO authenticated
  USING (public.user_can_edit_book(book_id));

DROP POLICY IF EXISTS "editors delete threads" ON public.book_threads;
CREATE POLICY "editors delete threads"
  ON public.book_threads FOR DELETE TO authenticated
  USING (public.user_can_edit_book(book_id));
