-- Fixes resume_agent_session (20260728130000), which silently did nothing.
--
-- ROOT CAUSE: PostgreSQL applies the *UPDATE* row-security policies to a `SELECT … FOR UPDATE`
-- locking clause, not just the SELECT ones — locking a row is treated as intent to write it.
-- book_agent_sessions has policies for SELECT, INSERT and DELETE but **no UPDATE policy**, so
-- `SELECT … FROM book_agent_sessions … FOR UPDATE` matched zero rows for an ordinary authenticated
-- caller. The function then took its "target session no longer exists" branch and returned NULL
-- without restoring anything. (book_agent_runs has an "editors update agent runs" policy, which is
-- why the identical lock on the thread row — and start_new_agent_session — works fine.)
--
-- FIX: don't lock the session row. The thread row lock taken above it already serialises every
-- archive/resume on this thread, so a second caller racing for the same session finds it deleted and
-- no-ops. Locking the session bought nothing that the thread lock didn't already provide.
--
-- Also changes the return to a boolean so this failure mode can never be silent again: NULL used to
-- mean both "nothing to archive" (success) and "target gone" (no-op), which is what let the bug
-- masquerade as a working call. The caller now knows whether the restore actually happened.
DROP FUNCTION IF EXISTS public.resume_agent_session(bigint, bigint);

CREATE FUNCTION public.resume_agent_session(p_thread_id bigint, p_session_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_run public.book_agent_runs%ROWTYPE;
  v_target public.book_agent_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.book_agent_runs WHERE id = p_thread_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such agent thread.';
  END IF;

  IF v_run.status IN ('running', 'awaiting_input') THEN
    RAISE EXCEPTION 'The agent is mid-turn — wait for it to finish, then continue that chat.';
  END IF;

  -- Scoped to this thread on purpose: the pre-RPC client looked the session up by id ALONE, so a
  -- stale id could graft one book's conversation onto another thread the caller can edit. RLS never
  -- caught that — both rows pass user_can_edit_book. No FOR UPDATE here; see the header.
  SELECT * INTO v_target FROM public.book_agent_sessions
   WHERE id = p_session_id AND thread_id = p_thread_id;

  IF NOT FOUND THEN
    RETURN false; -- already resumed or deleted elsewhere
  END IF;

  -- Archive the outgoing chat first — unless it's empty, which is not worth a row.
  IF jsonb_array_length(coalesce(v_run.steps, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.book_agent_sessions (thread_id, book_id, steps, transcript, proposals, title, ended_at)
    VALUES (p_thread_id, v_run.book_id, v_run.steps, coalesce(v_run.transcript, '[]'::jsonb),
            coalesce(v_run.proposals, '[]'::jsonb), v_run.title, now());
  END IF;

  DELETE FROM public.book_agent_sessions WHERE id = p_session_id;

  -- The resumed chat brings its own title back onto the live thread, so archiving it again keeps its name.
  UPDATE public.book_agent_runs
     SET steps = v_target.steps, transcript = v_target.transcript, proposals = v_target.proposals,
         pending = NULL, status = 'idle', title = v_target.title
   WHERE id = p_thread_id;

  RETURN true;
END;
$$;

ALTER FUNCTION public.resume_agent_session(bigint, bigint) OWNER TO postgres;

GRANT ALL ON FUNCTION public.resume_agent_session(bigint, bigint) TO anon;
GRANT ALL ON FUNCTION public.resume_agent_session(bigint, bigint) TO authenticated;
GRANT ALL ON FUNCTION public.resume_agent_session(bigint, bigint) TO service_role;
