-- Add book_thread_scans to the Realtime publication.
--
-- The original table (20260602120000) was never added to supabase_realtime: the old scan-threads
-- returned its result synchronously and the client read the row once, so it never needed live
-- updates. Now the scan runs in the background (insert 'running' → flip 'pending_review'/'error')
-- and the UI watches the row over Realtime — without this, a watching tab never learns the scan
-- finished (it sticks on the loader until a manual reload). Mirrors the publication block the other
-- task tables already carry.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'book_thread_scans'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.book_thread_scans;
  END IF;
END $$;
