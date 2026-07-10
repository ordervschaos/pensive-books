-- Fix: deleting a node in /dna/tree doesn't reflect on screen until a manual refresh. Root cause is the
-- Supabase Realtime DELETE gotcha: the live subscription filters on `book_id=eq.<id>`, but with the
-- default REPLICA IDENTITY Postgres only writes the PRIMARY KEY (id) into the WAL old-tuple on DELETE.
-- The deleted row's book_id is therefore absent from the Realtime payload, so the book_id filter can
-- never match a DELETE event and the client's refetch (soon()) never fires. INSERT/UPDATE work because
-- their new-tuple carries every column. (parent_id ON DELETE CASCADE means subtree deletes hit this too.)
--
-- REPLICA IDENTITY FULL puts the COMPLETE old row in the WAL, so DELETE payloads carry book_id and the
-- filter matches. (Costs a bit more WAL; fine for this low-volume table — same fix as book_agent_runs.)

ALTER TABLE public.book_nodes REPLICA IDENTITY FULL;
