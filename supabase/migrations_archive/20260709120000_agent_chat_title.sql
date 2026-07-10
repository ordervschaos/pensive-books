-- Name each agent chat from its opening message. The history rail listed chats by timestamp alone
-- ("Jul 6, 6:28 PM · 1 message"), which is hard to sort through once a book has dozens. A short title
-- generated once from the FIRST message (cheap: one short message in, ~a dozen tokens out) lets the
-- author scan the list. Naming from the first message (not the whole archived conversation) keeps it
-- one small model call at chat start rather than a batch digest of everything at archive time.
--
-- title lives on the live thread (book_agent_runs) so it's generated once and carried; on "New chat"
-- the thread archives into a book_agent_sessions row and the title rides along. Both nullable — old
-- rows and not-yet-named threads fall back to a client-derived title (the first message, trimmed).
ALTER TABLE public.book_agent_runs     ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.book_agent_sessions ADD COLUMN IF NOT EXISTS title text;
