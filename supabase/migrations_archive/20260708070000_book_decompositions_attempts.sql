-- attempts: per-unit retry counts for the dna-decompose self-chain — {"<chapterIdx>": n, "<phase>": n}.
-- A timed-out chapter read leaves its digest slot empty and is re-attempted on a later link; after 2
-- failures it gets a placeholder (keeps chapter numbering aligned). A failed fold phase retries once.
-- Bounded so a poison chapter can't loop the chain forever.
ALTER TABLE public.book_decompositions
  ADD COLUMN IF NOT EXISTS attempts jsonb not null default '{}';

-- New 'acts' phase (act re-segmentation from digests) slots in after 'top'.
ALTER TABLE public.book_decompositions DROP CONSTRAINT IF EXISTS book_decompositions_phase_chk;
ALTER TABLE public.book_decompositions ADD CONSTRAINT book_decompositions_phase_chk
  CHECK (phase IN ('chapters', 'top', 'acts', 'entities', 'systems', 'seal'));
