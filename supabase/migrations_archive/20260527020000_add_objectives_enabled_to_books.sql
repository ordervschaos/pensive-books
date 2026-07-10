-- Book-level master switch for the "objectives" feature (page + paragraph objectives).
-- Off by default: the objective UI (page bar, paragraph `//` trigger, gutter notes,
-- toolbar button) only surfaces when the book owner turns this on. Not sensitive — a
-- plain boolean, fine for readers to see; it just gates author-only UI.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS objectives_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.books.objectives_enabled IS
  'When true, the page/paragraph objective UI is shown to editors. Off by default.';
