-- Manuscript agent memory: standing author preferences for THIS book (style rules, spellings, names,
-- "never touch the prologue"). Lives on the thread row, NOT in steps/transcript, so it survives
-- "New chat" (start_new_agent_session archives steps/transcript/proposals and leaves other columns).
-- Written by the agent (remember/forget tools) and by the author (delete from the memory popover).
ALTER TABLE public.book_agent_runs ADD COLUMN IF NOT EXISTS memory jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.book_agent_runs.memory IS
  'Manuscript agent: string[] of standing author preferences for the book; injected every turn, kept across chats.';
