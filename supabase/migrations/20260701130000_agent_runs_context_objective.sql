-- The DNA omni-rail agent (docs/agent-capabilities.md) gets a client-computed CURRENT OBJECTIVE —
-- the one journey rung to drive the author through next (lib/dnaJourney.currentObjective), the same
-- channel as context_analysis. The journey engine lives in the web app, so the client passes the
-- objective with each message; we stash the latest on the thread so it's in context across the turn's
-- self-chain links. An anchor, not a fence: the agent still sees the whole tree.

ALTER TABLE public.book_agent_runs
  ADD COLUMN IF NOT EXISTS context_objective text;  -- latest client-computed current journey objective

COMMENT ON COLUMN public.book_agent_runs.context_objective IS
  'Latest client-computed current journey objective (the now stage/sub-step + its recipe) for the thread; refreshed each message, injected into the agent prompt as a guided-flow anchor.';
