-- Context filter for the omni-rail agent (docs/agent-rail.md). A thread carries a context_scope: the
-- set of book aspects ('promise' | 'characters' | 'beats' | 'scenes' | 'prose') the agent sees and may
-- touch. NULL = unconstrained (the whole book / all created aspects) — the default. The aspect names
-- are DNA-aligned so the same scope drives which book_nodes kinds load when this re-homes into DNA.

ALTER TABLE public.book_agent_runs
  ADD COLUMN IF NOT EXISTS context_scope jsonb;  -- string[] of in-scope aspects, or NULL = all

COMMENT ON COLUMN public.book_agent_runs.context_scope IS
  'Thread scope: which book aspects (promise/characters/beats/scenes/prose) the agent sees + can edit. NULL = all.';
