-- Morning Digest — schema (see doc_1785565352472.md for the full design).
--
-- STANCE: a digest is COMPILED from grounded sources, not GENERATED from a seed. That is the inverse of
-- the DNA pipeline, so this shares NO tables with books/pages/book_nodes. It shares only the Supabase
-- project: auth.users (so digest.pensive.me rides the same .pensive.me session cookie) and, later, the
-- already-approved Mailgun sender + user_data.kindle_email.
--
-- Three tables, each with one job:
--   digests            — the ARTIFACT the user owns and edits. Its `sections` jsonb is policy-as-data:
--                        adding a source kind is a new adapter in the app, not a schema change.
--   digest_issues      — one row per (digest, local date). The row IS the durable task AND the
--                        idempotency key: unique(digest_id, issue_date) means a retry resumes the same
--                        issue instead of sending a second one.
--   digest_items_seen  — content-addressed memory of what has already been delivered, so "daily" never
--                        means "yesterday's news again". Keyed by a hash of the CANONICALIZED url.
--
-- All three are owner-scoped by RLS. The build pipeline runs with the service role (which bypasses RLS)
-- because it acts on behalf of a user who is asleep at 6am — there is no user JWT at that moment.

-- ---------------------------------------------------------------------------------------------------
-- digests — the artifact
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.digests (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default 'Morning Digest',

  -- Scheduling. deliver_at is WALL-CLOCK TIME IN `timezone` (an IANA name like 'Asia/Kolkata'), not UTC —
  -- "morning" is only meaningful locally, and it must survive DST without the user re-editing it.
  timezone    text not null default 'UTC',
  deliver_at  time not null default '06:00',
  active      boolean not null default true,

  -- Tier-2 of the instruction stack: the user's standing editorial voice ("I build an AI writing tool;
  -- skip funding rounds; be blunt"). Tier 1 (the constitution: source everything, never pad) lives in
  -- code as a prompt constant — it is product policy, not a knob. Tier 3 is per-section, in `sections`.
  voice       text,

  -- [{ id, kind, title, enabled, max_items, instructions, ...kind-specific config }]
  -- kind ∈ search | feed | serial | prompt  (see apps/digest adapters)
  sections    jsonb not null default '[]'::jsonb,

  -- { kindle_email?, format? }  — kindle_email falls back to user_data.kindle_email (already OTP-verified
  -- against Amazon's approved-sender list by the main app's send-kindle-verification flow).
  delivery    jsonb not null default '{}'::jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  CONSTRAINT digests_sections_is_array CHECK (jsonb_typeof(sections) = 'array')
);

CREATE INDEX IF NOT EXISTS digests_owner_idx ON public.digests (owner_id);
-- Partial index: the scheduler only ever scans active digests.
CREATE INDEX IF NOT EXISTS digests_active_idx ON public.digests (active) WHERE active;

COMMENT ON TABLE  public.digests IS 'Morning Digest config — the artifact. Each daily issue is a render of this (digest_issues).';
COMMENT ON COLUMN public.digests.timezone IS 'IANA tz name. deliver_at is wall-clock time in THIS zone, so "6am" stays 6am across DST.';
COMMENT ON COLUMN public.digests.sections IS 'Policy-as-data: [{id, kind, title, enabled, max_items, instructions, ...}]. kind ∈ search|feed|serial|prompt.';
COMMENT ON COLUMN public.digests.voice IS 'Tier-2 instruction: the user standing editorial voice. Tier 1 (constitution) is a code constant; tier 3 is per-section.';

-- ---------------------------------------------------------------------------------------------------
-- digest_issues — one render, and the durable task row that produced it
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.digest_issues (
  id           bigint generated always as identity primary key,
  digest_id    bigint not null references public.digests(id) on delete cascade,

  -- The LOCAL date in the digest's timezone. Together with digest_id this is the idempotency key.
  issue_date   date not null,

  status       text not null default 'queued'
                 check (status in ('queued','building','rendering','sending','sent','failed','skipped')),

  -- The assembled render: { intro, sections: [{ id, title, markdown, items: [{title,url,source}] }] }.
  -- Kept as structured data (not just html) so the app can render its own reader and so a 👍/👎 in that
  -- reader can map back to the concrete source item that produced a block.
  content      jsonb not null default '{}'::jsonb,

  -- The delivered body. Kept so "what exactly did we send?" is answerable, and so a resend is byte-identical.
  html         text,

  item_count   integer not null default 0,
  attempts     integer not null default 0,   -- incremented per build attempt; caps watchdog retries
  error        text,

  started_at   timestamptz,
  delivered_at timestamptz,                  -- set ONLY after a 2xx from Mailgun (see items_seen note below)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  CONSTRAINT digest_issues_unique_day UNIQUE (digest_id, issue_date)
);

CREATE INDEX IF NOT EXISTS digest_issues_digest_idx ON public.digest_issues (digest_id, issue_date desc);
-- Partial index for the watchdog: find issues stuck mid-flight without scanning delivered history.
CREATE INDEX IF NOT EXISTS digest_issues_inflight_idx ON public.digest_issues (updated_at)
  WHERE status in ('queued','building','rendering','sending');

COMMENT ON TABLE public.digest_issues IS 'One issue per (digest, local date). The row is both the render and the durable task; the unique constraint is the idempotency key.';

-- ---------------------------------------------------------------------------------------------------
-- digest_items_seen — the digest's memory
-- ---------------------------------------------------------------------------------------------------
-- Written ONLY after a successful send. Ordering matters and the choice is deliberate:
--   mark-then-send  → a delivery failure permanently burns that news.            (unacceptable)
--   send-then-mark  → a crash between the two repeats one issue.                 (chosen)
-- Losing content is worse than repeating it, so this is at-least-once by design.
CREATE TABLE IF NOT EXISTS public.digest_items_seen (
  digest_id     bigint not null references public.digests(id) on delete cascade,
  url_hash      text   not null,             -- sha256 of the CANONICALIZED url (utm_* stripped, no fragment)
  url           text,                        -- kept for debugging "why was this dropped?"
  title         text,
  first_seen_at timestamptz not null default now(),
  PRIMARY KEY (digest_id, url_hash)
);

-- Retention scan support: prune anything older than the dedupe horizon (~90d).
CREATE INDEX IF NOT EXISTS digest_items_seen_age_idx ON public.digest_items_seen (first_seen_at);

COMMENT ON TABLE public.digest_items_seen IS 'Content-addressed dedupe memory. Written only after a successful send (send-then-mark: repeat beats losing news).';

-- ---------------------------------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.digest_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS digests_touch_updated_at ON public.digests;
CREATE TRIGGER digests_touch_updated_at
  BEFORE UPDATE ON public.digests
  FOR EACH ROW EXECUTE FUNCTION public.digest_touch_updated_at();

DROP TRIGGER IF EXISTS digest_issues_touch_updated_at ON public.digest_issues;
CREATE TRIGGER digest_issues_touch_updated_at
  BEFORE UPDATE ON public.digest_issues
  FOR EACH ROW EXECUTE FUNCTION public.digest_touch_updated_at();

-- ---------------------------------------------------------------------------------------------------
-- RLS — owner-only. The build pipeline uses the service role, which bypasses all of this.
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.digests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digest_issues     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digest_items_seen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners manage their digests" ON public.digests;
CREATE POLICY "owners manage their digests"
  ON public.digests FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Issues are READ-only to the user: they are produced by the pipeline, never hand-written. (Re-running an
-- issue is an app action that goes through the service role, not a client UPDATE.)
DROP POLICY IF EXISTS "owners read their issues" ON public.digest_issues;
CREATE POLICY "owners read their issues"
  ON public.digest_issues FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()));

-- Seen-items are read-only too, but users may DELETE to "let this story back in" (a useful escape hatch
-- when dedupe is too aggressive). No INSERT/UPDATE: only the pipeline records what it delivered.
DROP POLICY IF EXISTS "owners read their seen items" ON public.digest_items_seen;
CREATE POLICY "owners read their seen items"
  ON public.digest_items_seen FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()));

DROP POLICY IF EXISTS "owners forget their seen items" ON public.digest_items_seen;
CREATE POLICY "owners forget their seen items"
  ON public.digest_items_seen FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------------------------------
-- Which digests should have been delivered by now, and for which local date?
--
-- `p_now at time zone d.timezone` converts the instant to WALL-CLOCK time in the digest's zone, which is
-- what makes "6am" mean 6am in Kolkata and 6am in Lisbon from one scan.
--
-- The p_window guard is why this is a window and not just `>= deliver_at`: without it, creating a digest
-- at 3pm with deliver_at 06:00 would fire immediately, and a scheduler outage would backfill a burst of
-- stale issues. Past the window, the day is simply skipped — a digest is worthless late.
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
    );
$$;

COMMENT ON FUNCTION public.due_digests IS 'Timezone-local scheduler scan: active digests whose local deliver_at just passed (within p_window) and that have no issue for their local date yet.';

-- Atomically claim (digest, date). The INSERT ... ON CONFLICT DO NOTHING is the lock: two concurrent
-- scheduler ticks race, exactly one gets a row back, the loser sees NULL and does nothing. This is why
-- the scheduler needs no advisory locks and why a watchdog retry can never fan out into duplicate issues.
CREATE OR REPLACE FUNCTION public.claim_digest_issue(p_digest_id bigint, p_issue_date date)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.digest_issues (digest_id, issue_date, status, started_at)
  VALUES (p_digest_id, p_issue_date, 'queued', now())
  ON CONFLICT (digest_id, issue_date) DO NOTHING
  RETURNING id;
$$;

COMMENT ON FUNCTION public.claim_digest_issue IS 'Atomic claim of one (digest, local date). Returns the new issue id, or NULL if it was already claimed.';

-- Only the service role schedules; no authenticated grants on these two.
REVOKE ALL ON FUNCTION public.due_digests(timestamptz, interval)        FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_digest_issue(bigint, date)          FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.due_digests(timestamptz, interval)    TO service_role;
GRANT  EXECUTE ON FUNCTION public.claim_digest_issue(bigint, date)      TO service_role;
