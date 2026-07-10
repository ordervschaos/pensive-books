-- The DNA omni-rail agent (docs/agent-rail.md) gets the client-computed STORY ANALYSIS (pacing /
-- dangling-promise / sagging-run lints) as a structural backstop, the same way dna-chat does. The
-- analysis engine lives in the web app (lib/novelDna.analysisText), so the client passes it with each
-- message; we stash the latest on the thread so it's in context across the turn's self-chain links.

ALTER TABLE public.book_agent_runs
  ADD COLUMN IF NOT EXISTS context_analysis text;  -- latest client-computed story-analysis for the thread turn

COMMENT ON COLUMN public.book_agent_runs.context_analysis IS
  'Latest client-computed story analysis (pacing/promises/topography lints) for the thread; refreshed each message, fed to the agent as a backstop.';
