-- Rename the brief's raw-idea field: books.brief.premise → books.brief.idea.
-- The brief's "what is the book about?" field was named `premise`, which collided with the L1
-- `premise` node kind (genre/tone/dramatic_question/shape). The brief field is the author's RAW idea
-- (the amateur entry point); a logline is a separate, polished artifact derived from it. Renaming the
-- key disambiguates. Code reads `idea` with a `premise` fallback, so this backfill is safe to run any
-- time; it just normalizes existing rows so the fallback can eventually be dropped.
-- Idempotent: only touches rows that still carry `premise` and don't yet have `idea`.
update public.books
set brief = (brief - 'premise') || jsonb_build_object('idea', brief -> 'premise')
where brief ? 'premise'
  and not (brief ? 'idea');

-- If a row somehow has BOTH keys (e.g. a partial write), keep `idea` and drop the stale `premise`.
update public.books
set brief = brief - 'premise'
where brief ? 'premise'
  and brief ? 'idea';
