-- Chat history for the DNA omni-rail agent (docs/agent-rail.md): "+ New chat" archives the current
-- conversation here and starts fresh; the author can resume a past one. Mirrors revision_chats.sessions
-- / dna_chats.sessions. Each entry snapshots { transcript, steps, proposals, ended_at }.

ALTER TABLE public.book_agent_runs
  ADD COLUMN IF NOT EXISTS sessions jsonb not null default '[]'::jsonb;  -- archived conversations, newest first

COMMENT ON COLUMN public.book_agent_runs.sessions IS
  'Archived agent conversations (newest first): each { transcript, steps, proposals, ended_at }. The thread row holds the live one.';
