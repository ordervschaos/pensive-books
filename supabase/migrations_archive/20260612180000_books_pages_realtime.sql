-- Add public.books and public.pages to the Realtime publication.
--
-- Standard: the rendered UI is a projection of server state, so a page refresh is a no-op. The book
-- workspace host (BookDetails) fetches book + pages ONCE and derives the whole build studio (page
-- map, % complete, current step, navigator dots) from that snapshot. A background AI run — a revise
-- build rewriting pages, a generation advancing books.journey/spine/foundations — mutates these
-- tables server-side, but without a publication entry the host never learns, so the studio shows the
-- pre-run state until a manual reload. Publishing both tables lets the host re-read on change and
-- stay live. Mirrors the publication block the task tables already carry; idempotent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'books'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.books;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pages;
  END IF;
END $$;

-- pages are archived (UPDATE archived=true), not hard-deleted, so the default replica identity (PK)
-- is enough for the book_id filter on INSERT/UPDATE — the events the host cares about.
