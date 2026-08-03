-- Digest issue watchdog: turn a LOST day into a LATE day.
--
-- The bug this closes. claim_digest_issue() takes the day up-front (INSERT ... ON CONFLICT DO NOTHING
-- is the lock), and due_digests() excluded any date that had ANY issue row at ANY status. So if a
-- build died mid-flight — pg_net hanging up on a slow tick, a function timeout, a deploy — the row
-- sat in 'building' forever, the date read as handled, and that morning was silently lost. No retry
-- could help: the very property that makes the claim safe against DUPLICATES made it unforgiving of
-- CRASHES. Claim-as-lock without a lease.
--
-- The fix is a lease. Three coordinated changes, all of which are needed — any one alone is inert:
--
--   1. expire_stalled_digest_issues()  marks a stalled claim 'failed' (the lease expires)
--   2. due_digests()                   stops treating a retryable failure as "handled"
--   3. claim_digest_issue()            hands back the existing row for a retryable failure,
--                                      instead of NULL
--
-- This mirrors revive_stalled_chains() on the DNA side, which solved the same problem for
-- self-chaining edge workers. Unlike the digest-tick job itself, this one IS a migration: it
-- hardcodes no origin and needs no secret, so it is correct on every database it touches.
--
-- Retries are bounded twice over: digest_issues.attempts < 3 (incremented by buildIssue), and
-- due_digests()'s existing 3-hour delivery window, after which the date stops being due at all.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. The lease expiry.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_stalled_digest_issues(p_after interval DEFAULT interval '20 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- NOTE the statuses deliberately NOT listed: 'sending'.
  --
  -- 'sending' is set immediately BEFORE the Mailgun call and 'sent' immediately after, so a row stuck
  -- at 'sending' is genuinely ambiguous — the mail may or may not have gone out. Reviving it risks a
  -- double delivery, which is the one failure this pipeline was built to prevent. A stuck 'sending'
  -- is therefore left alone for a human, and is exactly what the digest_issues-age alert should catch.
  -- Better a missed morning than two of them.
  UPDATE public.digest_issues
  SET status = 'failed',
      error  = 'stalled at ''' || status || ''': no progress for ' || p_after,
      updated_at = now()
  WHERE status IN ('queued', 'building', 'rendering')
    AND started_at IS NOT NULL
    AND started_at < now() - p_after;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.expire_stalled_digest_issues IS
  'Lease expiry for digest claims: a build that made no progress for p_after is marked failed so the day becomes claimable again. Skips ''sending'' on purpose — that state is ambiguous about whether Mailgun already accepted, and a double send is worse than a missed one.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. A retryable failure no longer counts as "this date is handled".
--    Verbatim re-definition of due_digests with only the NOT EXISTS clause changed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.due_digests(
  p_now    timestamptz default now(),
  p_window interval    default interval '3 hours'
)
RETURNS TABLE (digest_id bigint, issue_date date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, ((p_now AT TIME ZONE d.timezone)::date)
  FROM public.digests d
  WHERE d.active
    AND (p_now AT TIME ZONE d.timezone)::time >= d.deliver_at
    AND (p_now AT TIME ZONE d.timezone)::time <  d.deliver_at + p_window
    AND jsonb_array_length(d.sections) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.digest_issues i
      WHERE i.digest_id = d.id
        AND i.issue_date = (p_now AT TIME ZONE d.timezone)::date
        -- An existing row blocks the date UNLESS it is a failure we are still willing to retry.
        -- 'sent' and 'skipped' are terminal decisions; 'sending' is ambiguous; in-flight states are
        -- covered by the watchdog above, which converts them to 'failed' once their lease expires.
        AND NOT (i.status = 'failed' AND COALESCE(i.attempts, 0) < 3)
    );
$$;

COMMENT ON FUNCTION public.due_digests IS
  'Timezone-local scheduler scan: active digests whose local deliver_at just passed (within p_window) and that have no issue for their local date yet — or whose issue failed and is still under the 3-attempt retry cap.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Let the claim RECLAIM. Without this, step 2 is inert: due_digests would keep offering the date
--    and claim_digest_issue would keep returning NULL ('already_claimed') forever.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.claim_digest_issue(p_digest_id bigint, p_issue_date date)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  -- The common path, unchanged: the INSERT is the lock. Two concurrent ticks race here and exactly
  -- one gets a row back.
  INSERT INTO public.digest_issues (digest_id, issue_date, status, started_at)
  VALUES (p_digest_id, p_issue_date, 'queued', now())
  ON CONFLICT (digest_id, issue_date) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  -- Someone already holds this date. Take it over ONLY if it is a retryable failure. FOR UPDATE SKIP
  -- LOCKED keeps the original guarantee intact: two ticks racing on a RETRY behave exactly like two
  -- ticks racing on a FIRST claim — one winner, one NULL. Note attempts is NOT reset; it only ever
  -- grows (buildIssue increments it), so the cap is a real ceiling and not a treadmill.
  SELECT id INTO v_id
  FROM public.digest_issues
  WHERE digest_id = p_digest_id
    AND issue_date = p_issue_date
    AND status = 'failed'
    AND COALESCE(attempts, 0) < 3
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.digest_issues
  SET status = 'queued', started_at = now(), error = NULL, updated_at = now()
  WHERE id = v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.claim_digest_issue IS
  'Atomic claim of one (digest, local date). Returns the new issue id, or re-claims an issue that failed under the retry cap, or NULL if the date is genuinely already handled.';

-- Grants are re-asserted because CREATE OR REPLACE on a function with a changed language/body keeps
-- the old ACL, but a future DROP+CREATE would not. Cheap and idempotent.
REVOKE ALL ON FUNCTION public.due_digests(timestamptz, interval)              FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_digest_issue(bigint, date)                FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stalled_digest_issues(interval)          FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.due_digests(timestamptz, interval)          TO service_role;
GRANT  EXECUTE ON FUNCTION public.claim_digest_issue(bigint, date)            TO service_role;
GRANT  EXECUTE ON FUNCTION public.expire_stalled_digest_issues(interval)      TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Run the lease expiry every 5 minutes. Same shape as the revive-stalled-chains job.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stalled-digest-issues') THEN
    PERFORM cron.unschedule('expire-stalled-digest-issues');
  END IF;
  PERFORM cron.schedule('expire-stalled-digest-issues', '*/5 * * * *',
                        'select public.expire_stalled_digest_issues();');
END $$;
