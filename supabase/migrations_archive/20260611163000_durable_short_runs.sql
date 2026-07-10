-- Durable short AI runs: spine, options, node-revise, beat-candidates all become book_generations
-- rows so they survive navigation/refresh, feed back over Realtime, and are cancellable + accept/reject.
--
-- These are SINGLE-SHOT (no self-chain): insert running → waitUntil(Claude) → flip ready/error, just
-- like scaffold/bible. So no watchdog change is needed (the watchdog only revives self-chaining kinds).
--
--   1. Widen the kind CHECK with the new short-op kinds.
--   2. Add 'cancelled' to the status CHECK (cancel = abandon: mark cancelled, discard the result).
--   3. Add target_key — a stable string key for runs that aren't page-scoped (spine = 'book',
--      a pre-commit scaffold draft slot = 'draft:{scaffoldRowId}:{pageIndex}', a revise layer, …),
--      so useLatestTaskRow can reattach the right run after navigating back.

-- 1. Kinds
ALTER TABLE public.book_generations DROP CONSTRAINT IF EXISTS book_generations_kind_chk;
ALTER TABLE public.book_generations
  ADD CONSTRAINT book_generations_kind_chk
  CHECK (kind IN (
    'page_write', 'page_revise', 'write_all', 'rerender_stale', 'scaffold', 'bible', 'voice', 'auto_revise',
    'spine', 'spine_options', 'objective_options', 'node_revise', 'beat_candidates'
  ));

-- 2. Statuses (+ cancelled)
ALTER TABLE public.book_generations DROP CONSTRAINT IF EXISTS book_generations_status_chk;
ALTER TABLE public.book_generations
  ADD CONSTRAINT book_generations_status_chk
  CHECK (status IN ('pending', 'running', 'ready', 'applied', 'dismissed', 'cancelled', 'done', 'error'));

-- 3. target_key for non-page-scoped reattachment.
ALTER TABLE public.book_generations ADD COLUMN IF NOT EXISTS target_key text;
CREATE INDEX IF NOT EXISTS book_generations_target_key_created_idx
  ON public.book_generations (book_id, kind, target_key, created_at DESC)
  WHERE target_key IS NOT NULL;
