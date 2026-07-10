-- Add books.spine: the "book spine" — a single book-level objective node between the brief and the
-- page objectives (the multi-resolution ladder: brief → spine → page objective → beat → prose).
--
-- Shape: { "text": "<the book's objective/synopsis>", "brief_hash": "<hash of the brief it was
-- generated from>" }. brief→spine is the one one-way edge: AI drafts the spine from the brief, never
-- the reverse, so the spine only needs to remember its parent's hash to know when it has drifted.
-- jsonb (not a bare text column) keeps the node + its provenance together, matching how page-level
-- nodes (objective/beat + their sync hashes) live in pages.metadata.

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS spine jsonb;
