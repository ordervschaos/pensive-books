-- admin/ai-calls polled ai_calls + ai_call_evals every 4s on a fixed timer, regardless of whether
-- anything changed. Publish both tables so the client can subscribe over Realtime instead and treat
-- each event as a signal to refetch (see useLatestTaskRow's established pattern) rather than reading
-- the broadcast payload directly — ai_calls carries large system/input/output blobs we don't want to
-- rely on the wire format for.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ai_calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_calls;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ai_call_evals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_call_evals;
  END IF;
END $$;
