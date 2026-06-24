-- Picture-book mode (docs/picture-book-mode.md). A book-level choice that changes only the LAST rung of
-- the Novel DNA ladder: in 'prose' mode a scene resolves into ~280 words of prose; in 'picture' mode the
-- same scene plan resolves into one illustrated page (scene image + 1–3 sentence caption). Everything above
-- the scene node is mode-agnostic. The illustration + caption live on scene.content (jsonb — no column),
-- and Authoring.illus_src_hash stamps staleness; only this book-level flag needs a column.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'prose'
  CHECK (mode IN ('prose', 'picture'));

COMMENT ON COLUMN public.books.mode IS
  'prose | picture — gates the DNA Draft step (write prose vs illustrate) and the render projection (text pages vs image pages).';
