-- Author-only page metadata stored as a flexible JSONB blob.
--
-- Phase 0 holds the page's "objective" — what this page must achieve. It is invisible
-- to readers and is the author's planning + self-evaluation undercurrent. One column
-- covers BOTH chapter (page_type='section') and page (page_type='text') objectives,
-- since a chapter is just a section page. Shape today: { "objective": "..." }.
-- Headroom for later render provenance (e.g. status/dirty/hash) without a new migration.
--
-- Mirrors books.brief (migration 20260521010000): RLS gates the ROW, not the column, so
-- the application must OMIT this column from reader-facing SELECTs. (Paragraph-level
-- objectives live inside pages.content as node attributes and are stripped at
-- serialization, not here.)
ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN public.pages.metadata IS
  'Author-only page metadata (objective, …). Never shown to readers.';
