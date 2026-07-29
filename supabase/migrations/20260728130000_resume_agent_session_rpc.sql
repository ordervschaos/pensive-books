-- "Continue this chat" in one round trip — the symmetric twin of start_new_agent_session
-- (20260728120000). Same three problems, one more of each: the client ran five dependent statements
-- (SELECT thread → SELECT target → INSERT archive → DELETE target → UPDATE thread), none of them in a
-- transaction, so a failure part-way could delete an archived chat without restoring it — losing it
-- outright — or archive the outgoing chat twice.
--
-- SECURITY INVOKER (the default): the caller's RLS on book_agent_runs / book_agent_sessions still
-- applies. This buys round trips and atomicity, not reach.
--
-- Returns the id of the archive row created for the OUTGOING chat, or NULL when there was nothing to
-- archive or the target session no longer exists (a no-op, matching the old client behaviour).
CREATE OR REPLACE FUNCTION public.resume_agent_session(p_thread_id bigint, p_session_id bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_run public.book_agent_runs%ROWTYPE;
  v_target public.book_agent_sessions%ROWTYPE;
  v_archived_id bigint;
BEGIN
  -- Lock order is thread-then-session in both RPCs, so they can't deadlock against each other.
  SELECT * INTO v_run FROM public.book_agent_runs WHERE id = p_thread_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such agent thread.';
  END IF;

  IF v_run.status IN ('running', 'awaiting_input') THEN
    RAISE EXCEPTION 'The agent is mid-turn — wait for it to finish, then continue that chat.';
  END IF;

  -- Scoped to this thread on purpose. The client version looked the session up by id ALONE, so a
  -- stale id (or a hand-made request) could graft one book's conversation onto another thread the
  -- caller happens to be able to edit. RLS never caught this — both rows pass user_can_edit_book.
  -- FOR UPDATE also stops two tabs restoring the same session twice.
  SELECT * INTO v_target FROM public.book_agent_sessions
   WHERE id = p_session_id AND thread_id = p_thread_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL; -- already resumed or deleted elsewhere; no-op, as before
  END IF;

  -- Archive the outgoing chat first — unless it's empty, which is not worth a row.
  IF jsonb_array_length(coalesce(v_run.steps, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.book_agent_sessions (thread_id, book_id, steps, transcript, proposals, title, ended_at)
    VALUES (p_thread_id, v_run.book_id, v_run.steps, coalesce(v_run.transcript, '[]'::jsonb),
            coalesce(v_run.proposals, '[]'::jsonb), v_run.title, now())
    RETURNING id INTO v_archived_id;
  END IF;

  DELETE FROM public.book_agent_sessions WHERE id = p_session_id;

  -- The resumed chat brings its own title back onto the live thread, so archiving it again keeps its name.
  UPDATE public.book_agent_runs
     SET steps = v_target.steps, transcript = v_target.transcript, proposals = v_target.proposals,
         pending = NULL, status = 'idle', title = v_target.title
   WHERE id = p_thread_id;

  RETURN v_archived_id;
END;
$$;

ALTER FUNCTION public.resume_agent_session(bigint, bigint) OWNER TO postgres;

GRANT ALL ON FUNCTION public.resume_agent_session(bigint, bigint) TO anon;
GRANT ALL ON FUNCTION public.resume_agent_session(bigint, bigint) TO authenticated;
GRANT ALL ON FUNCTION public.resume_agent_session(bigint, bigint) TO service_role;
