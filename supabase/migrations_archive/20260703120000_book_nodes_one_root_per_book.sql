-- Enforce at most one root (parent_id IS NULL) per book. Two independent client paths can now race to
-- mint the seed node (brief save vs. the DNA tree's own bootstrap) — this constraint makes the loser's
-- insert fail with a unique violation (23505) instead of silently creating a duplicate root; ensureSeed
-- (features/dna/lib/dnaExpand.ts) catches that and re-reads the winner's seed.
CREATE UNIQUE INDEX IF NOT EXISTS book_nodes_one_root_per_book
  ON public.book_nodes (book_id)
  WHERE parent_id IS NULL;
