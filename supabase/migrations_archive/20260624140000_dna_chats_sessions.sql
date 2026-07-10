-- dna_chats.sessions: archive of past conversations on the same (book, stage) thread.
--
-- "+ New chat" pushes the current { messages, pending_proposal, ended_at } onto sessions and resets
-- the active messages/pending_proposal to empty — so a finished conversation leaves the model's
-- active context but stays recoverable in the rail's "Past chats" disclosure.
ALTER TABLE public.dna_chats
  ADD COLUMN IF NOT EXISTS sessions jsonb not null default '[]'::jsonb;
