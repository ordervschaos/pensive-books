-- Allow a new book_generations kind: 'voice'.
--
-- The voice-sample picker (gate 4) drafts three candidate voice exemplars as a durable book_generations
-- task row (kind 'voice'), reviewed like the scaffold proposal. Unlike write_all it does NOT self-chain
-- (it's a single background Claude call that lands 'ready'), so the watchdog needs no change — only the
-- kind CHECK has to admit it.

ALTER TABLE public.book_generations DROP CONSTRAINT IF EXISTS book_generations_kind_chk;
ALTER TABLE public.book_generations
  ADD CONSTRAINT book_generations_kind_chk
  CHECK (kind IN ('page_write', 'page_revise', 'write_all', 'rerender_stale', 'scaffold', 'bible', 'voice'));
