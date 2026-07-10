-- Fix: the agent rail's chat blanks to the empty-state while "thinking…". Root cause is the Supabase
-- Realtime "unchanged TOAST" gotcha: book_agent_runs has large jsonb columns (steps, transcript,
-- proposals) stored out-of-line (TOAST). When the edge fn does a PARTIAL update that doesn't touch
-- them — e.g. `update({ turns })` right before each model call — Postgres omits those unchanged
-- TOASTed columns from the WAL new-tuple, so the Realtime payload.new arrives with steps = null. The
-- client (useLatestTaskRow) then overwrites its good row with the partial one and the feed empties.
--
-- REPLICA IDENTITY FULL makes Realtime emit the COMPLETE row on every change, so partial updates no
-- longer drop steps/proposals. (Costs a bit more WAL; fine for this low-volume table.)

ALTER TABLE public.book_agent_runs REPLICA IDENTITY FULL;
