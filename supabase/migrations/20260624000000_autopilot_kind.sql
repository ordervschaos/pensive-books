-- Allow a new book_generations kind: 'autopilot'.
--
-- Auto-build: walk the whole Novel DNA forward pass (seed → premise → pillar → cast/world/
-- set-pieces/relationships → movements → threads → games → beat sheet → scenes → prose) end to end
-- from the brief. Unlike write_all it is CLIENT-DRIVEN (the browser loops the existing client-side
-- expandNode, which is the only place DNA generate+persist lives, so it works through the dev bridge
-- too) — so there is NO self-chaining edge worker and the cron watchdog must NOT try to revive it.
-- The row is the durable mirror of the loop: refresh-safe progress, the milestone pause (status
-- 'ready' = waiting for the author to approve a stage), and resume after a closed tab. Reuses the
-- existing statuses: running | ready (paused at a milestone) | done | error | cancelled (user Stop).
ALTER TABLE public.book_generations DROP CONSTRAINT IF EXISTS book_generations_kind_chk;
ALTER TABLE public.book_generations
  ADD CONSTRAINT book_generations_kind_chk
  CHECK (kind IN (
    'page_write', 'page_revise', 'write_all', 'rerender_stale', 'scaffold', 'bible', 'voice', 'auto_revise',
    'spine', 'spine_options', 'objective_options', 'node_revise', 'beat_candidates',
    'foundations_options', 'spine_routes', 'autopilot'
  ));
