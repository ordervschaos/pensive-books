-- book_agent_runs.target_page_id: scope a prose-editor run to ONE page.
--
-- The Draft step's prose editor (ProseEditor with no pageId) runs whole-book — target_page_id stays
-- NULL. The page view's prose chat (PageReview rail) runs page-scoped — target_page_id is the page,
-- so each page keeps its own thread/latest-run (the rail watches runs filtered by this column).
ALTER TABLE public.book_agent_runs
  ADD COLUMN IF NOT EXISTS target_page_id integer references public.pages(id) on delete cascade;

CREATE INDEX IF NOT EXISTS book_agent_runs_page_idx
  ON public.book_agent_runs (book_id, target_page_id, created_at desc);
