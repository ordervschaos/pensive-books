-- "New chat" in one round trip.
--
-- The client used to archive a thread with three DEPENDENT statements — SELECT the live row, INSERT
-- the archive, UPDATE the thread empty — so the author paid three network round trips (~2s on a
-- hosted project) for an outcome that was never in doubt. Worse, the three were not atomic: a crash
-- or a dropped connection between the INSERT and the UPDATE left the chat archived AND still live,
-- i.e. a duplicated conversation. This collapses them into one call inside one transaction.
--
-- SECURITY INVOKER (the default) on purpose: the caller's RLS policies on book_agent_runs and
-- book_agent_sessions ("editors …" / user_can_edit_book) still apply, so this grants no new reach —
-- it only saves round trips. Same reason snapshot_book_tree is invoker-rights.
CREATE OR REPLACE FUNCTION public.start_new_agent_session(p_thread_id bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_run public.book_agent_runs%ROWTYPE;
  v_session_id bigint;
BEGIN
  -- FOR UPDATE closes the check-then-act race the client version had: it read the status, then wrote
  -- with nothing holding the row, so a turn starting in between would be archived out from under the
  -- edge function. The lock makes "is it idle?" and "empty it" one indivisible step.
  SELECT * INTO v_run FROM public.book_agent_runs WHERE id = p_thread_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such agent thread.';
  END IF;

  -- Mid-turn the edge function owns steps/transcript/proposals; archiving would race it. Message kept
  -- verbatim from the old client-side guard so the rail's toast reads the same.
  IF v_run.status IN ('running', 'awaiting_input') THEN
    RAISE EXCEPTION 'The agent is mid-turn — wait for it to finish, then start a new chat.';
  END IF;

  -- Nothing to archive — an empty thread is already a new chat.
  IF jsonb_array_length(coalesce(v_run.steps, '[]'::jsonb)) = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.book_agent_sessions (thread_id, book_id, steps, transcript, proposals, title, ended_at)
  VALUES (p_thread_id, v_run.book_id, v_run.steps, coalesce(v_run.transcript, '[]'::jsonb),
          coalesce(v_run.proposals, '[]'::jsonb), v_run.title, now())
  RETURNING id INTO v_session_id;

  -- Title resets too: the next chat's first message names it afresh, and a stale title would mislabel it.
  UPDATE public.book_agent_runs
     SET steps = '[]'::jsonb, transcript = '[]'::jsonb, proposals = '[]'::jsonb,
         pending = NULL, status = 'idle', title = NULL
   WHERE id = p_thread_id;

  RETURN v_session_id;
END;
$$;

ALTER FUNCTION public.start_new_agent_session(bigint) OWNER TO postgres;

GRANT ALL ON FUNCTION public.start_new_agent_session(bigint) TO anon;
GRANT ALL ON FUNCTION public.start_new_agent_session(bigint) TO authenticated;
GRANT ALL ON FUNCTION public.start_new_agent_session(bigint) TO service_role;
