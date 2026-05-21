-- Author-only creative brief stored as a flexible JSONB blob.
-- Hidden from readers; the application must omit this column from
-- reader-facing SELECTs (RLS gates the row, not the column).
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS brief jsonb;

COMMENT ON COLUMN public.books.brief IS
  'Author-only creative brief (scope, genre, audience, premise, tone, success_criteria). Never shown to readers.';
