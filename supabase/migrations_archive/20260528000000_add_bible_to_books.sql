-- Author-only "book bible": the established facts of the book (characters, world, style,
-- names) that every page should stay consistent with. Layer A of generation context,
-- beyond the brief. Free-text markdown stored under { text } for headroom, mirroring how
-- books.brief is treated (author-only; RLS gates the row; never shown to readers).
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS bible jsonb;

COMMENT ON COLUMN public.books.bible IS
  'Author-only book bible (established facts: characters, world, style). Shape { text }. Never shown to readers.';
