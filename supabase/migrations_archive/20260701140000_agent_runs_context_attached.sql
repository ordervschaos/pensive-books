-- The DNA omni-rail agent's CONTEXT TRAY (docs/agent-context-model.md): the node ids the author
-- attached as anchors ("＋ add to agent context"). These used to ride glued to the user message as a
-- "Focus —" text prefix, so the transcript accumulated STALE copies across turns (detaching a node never
-- removed the frozen prefix from an earlier message). Move them out-of-band onto the thread, like
-- context_objective/context_analysis: the client passes the CURRENT tray with each message; we stash the
-- latest and rebuild a live, hydrated <focus> block in the system prompt every turn — never stale, never
-- duplicated. An anchor, not a fence: the agent still sees the whole tree.

ALTER TABLE public.book_agent_runs
  ADD COLUMN IF NOT EXISTS context_attached_ids jsonb;  -- latest author-attached node ids (the context tray)

COMMENT ON COLUMN public.book_agent_runs.context_attached_ids IS
  'Latest author-attached DNA node ids (the context tray) for the thread; refreshed each message, hydrated into the agent prompt as a live <focus> block.';
