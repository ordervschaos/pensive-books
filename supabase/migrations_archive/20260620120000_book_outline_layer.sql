-- Structure-as-render: the durable plan layer.  See docs/structure-as-render.md.
--
-- The book's outline becomes a first-class, cheaply-revisable artifact (books.outline jsonb) instead
-- of being eagerly smeared across page rows the moment it's proposed. Pages are a RENDER of the
-- outline, produced by reconcile() (lib/outline.ts). The outline is the virtual DOM; pages are the
-- real DOM; reconcile is the diff.
--
-- Shape of books.outline (nullable — NULL = legacy/page-native book, reconcile never runs):
--   { structure, nodes:[{id,type,title,objective,delta?,tentpoleId?}], threads:[...],
--     spine_hash, rev, compiled_rev }
-- The page↔node link lives in pages.metadata.node_id (jsonb — no column needed).

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS outline jsonb;

COMMENT ON COLUMN public.books.outline IS
  'Durable plan layer (docs/structure-as-render.md): { structure, nodes[], threads[], spine_hash, rev, compiled_rev }. NULL = legacy page-native book. Pages are reconcile()d from this; pages.metadata.node_id links a page back to its node.';

-- book_threads: the node id is the DURABLE plan anchor; the page anchors (book_thread_anchors, role
-- promise/resolution) are DERIVED on reconcile via the node->page map, so reordering the outline never
-- loses a thread — it re-points the same anchor row.
-- plan_thread_id = the outline thread's id, for idempotent upsert from outline.threads.
ALTER TABLE public.book_threads
  ADD COLUMN IF NOT EXISTS setup_node_id   text,
  ADD COLUMN IF NOT EXISTS payoff_node_id  text,
  ADD COLUMN IF NOT EXISTS plan_thread_id  text;

-- Find a book's planned threads by their outline id quickly (reconcile upserts by this).
CREATE INDEX IF NOT EXISTS book_threads_plan_thread_id_idx
  ON public.book_threads (book_id, plan_thread_id);
