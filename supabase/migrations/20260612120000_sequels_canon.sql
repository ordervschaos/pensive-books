-- Sequels (docs/pinned_method.md §8): continue a new book from a finished one.
--
-- 1. books.parent_book_id — the series link. Null = not a sequel. ON DELETE SET NULL: deleting
--    the parent orphans the sequel but never cascades into it (the canon jsonb keeps the facts).
--
-- 2. books.canon — the canon packet, written ONCE by createSequel() at creation time: the parent's
--    final folded state, last character ledger, settled ending, cast as book 1 left them, and the
--    resolved/carried thread lists. Canon is to a sequel what a pin is to a draft — generation
--    must honor it and never contradict it (rendered via _shared/canon-core.ts canonContext).
--
-- 3. book_threads.source gains 'carryover' — the parent's still-open threads copied into the
--    sequel's promise ledger as its starting hooks (status 'planned', unpinned, deletable).

-- 1+2. Series link + canon packet.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS parent_book_id integer REFERENCES public.books(id) ON DELETE SET NULL;
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS canon jsonb;

-- Lookup: a finished book's sequels ("this book continues in …", future series UI).
CREATE INDEX IF NOT EXISTS books_parent_book_id_idx
  ON public.books (parent_book_id)
  WHERE parent_book_id IS NOT NULL;

-- 3. Carryover threads.
ALTER TABLE public.book_threads DROP CONSTRAINT IF EXISTS book_threads_source_chk;
ALTER TABLE public.book_threads
  ADD CONSTRAINT book_threads_source_chk
  CHECK (source IN ('ai', 'author', 'genre_template', 'carryover'));
