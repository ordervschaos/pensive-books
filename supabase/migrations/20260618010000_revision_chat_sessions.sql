-- revision_chats.sessions: archive of past conversations on the same (book, layer) thread.
--
-- "+ New chat" pushes the current { messages, pending_proposal, ended_at } onto sessions and resets
-- the active messages/pending_proposal to empty — so a finished conversation leaves the model's
-- active context but stays recoverable in the rail's "Past chats" disclosure. One row per
-- (book, layer) is unchanged; the edge fn keeps writing the active `messages` as before.
ALTER TABLE public.revision_chats
  ADD COLUMN IF NOT EXISTS sessions jsonb not null default '[]'::jsonb;
