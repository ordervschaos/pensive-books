-- Pin-driven Build flow, phase 1+2 (docs/pinned_method.md): the Foundations stage + pins.
--
-- 1. books.foundations — the new stage-2 artifact (argument, ending, cast, tentpoles, voice
--    exemplar), each entry carrying { pinned, author_edited_at, candidates }. The column doubles
--    as the FLOW FLAG: NULL = the old 9-step rail (brief→spine→outline→voice→…), non-NULL = the
--    new rail (brief→foundations→spine-routes→…). Existing books stay NULL (old flow keeps
--    working, no migration of mid-flight books); the DEFAULT flips only newly created books in.
--
-- 2. book_threads.source gains 'genre_template' — Brief save seeds the promise ledger from a
--    genre template (mystery → "central question", …); seeded threads are unpinned + deletable.
--
-- 3. book_generations gains the two new durable short-op kinds: 'foundations_options' (one kind,
--    params.step picks argument|ending|cast|tentpoles|voice; target_key 'foundations:{step}')
--    and 'spine_routes' (2–3 alternative route summaries built from the foundations).

-- 1. The foundations jsonb + new-book default ({} = new flow, nothing authored yet).
ALTER TABLE public.books ADD COLUMN IF NOT EXISTS foundations jsonb;
ALTER TABLE public.books ALTER COLUMN foundations SET DEFAULT '{}'::jsonb;

-- 2. Genre-template threads.
ALTER TABLE public.book_threads DROP CONSTRAINT IF EXISTS book_threads_source_chk;
ALTER TABLE public.book_threads
  ADD CONSTRAINT book_threads_source_chk
  CHECK (source IN ('ai', 'author', 'genre_template'));

-- 3. New durable run kinds.
ALTER TABLE public.book_generations DROP CONSTRAINT IF EXISTS book_generations_kind_chk;
ALTER TABLE public.book_generations
  ADD CONSTRAINT book_generations_kind_chk
  CHECK (kind IN (
    'page_write', 'page_revise', 'write_all', 'rerender_stale', 'scaffold', 'bible', 'voice', 'auto_revise',
    'spine', 'spine_options', 'objective_options', 'node_revise', 'beat_candidates',
    'foundations_options', 'spine_routes'
  ));
