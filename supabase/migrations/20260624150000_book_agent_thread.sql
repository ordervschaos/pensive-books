-- Promote book_agent_runs to ALSO host one persistent conversational THREAD per book — the omni-rail
-- agent (docs/agent-rail.md, option B). Additive: existing per-run rows (the eval-driven editor agent
-- and the prose chat) stay kind='eval' and behave exactly as before; the new omni-thread is
-- kind='thread', a single row per book that never terminates (a turn ends in 'idle', not 'done').

ALTER TABLE public.book_agent_runs
  ADD COLUMN IF NOT EXISTS kind text not null default 'eval',            -- 'eval' (per-run) | 'thread' (persistent omni-rail)
  ADD COLUMN IF NOT EXISTS proposals jsonb not null default '[]'::jsonb;  -- reviewable per-layer artifacts the author applies

-- At most ONE persistent thread per book. Per-run 'eval' rows are unconstrained (many per book).
CREATE UNIQUE INDEX IF NOT EXISTS book_agent_runs_one_thread_per_book
  ON public.book_agent_runs (book_id) WHERE kind = 'thread';

-- The watchdog (revive_stalled_chains) already re-kicks any book_agent_runs row stuck in 'running'
-- regardless of kind, so a stalled thread TURN is revived too. 'idle' is a quiescent status it
-- correctly ignores. No watchdog change needed.

COMMENT ON COLUMN public.book_agent_runs.kind IS
  'eval = per-run editor agent / prose chat (terminal done); thread = the persistent omni-rail conversation (turns end idle).';
