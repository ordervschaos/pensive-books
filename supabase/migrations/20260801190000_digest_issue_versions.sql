-- digest_issue_versions — archived snapshots of a regenerated issue.
--
-- digest_issues stays one-row-per-day by design (see 20260801120000): unique(digest_id, issue_date) IS the
-- idempotency key claim_digest_issue and due_digests rely on. Regenerating a sent issue (buildIssue's
-- `force` path) therefore UPDATEs that same row rather than inserting a second one — but overwriting
-- content/html in place would silently destroy the morning that was actually delivered.
--
-- So the previous render is snapshotted here immediately before it's overwritten. The live row in
-- digest_issues is always current; every row here is a superseded version of it — archived, not deleted.
CREATE TABLE IF NOT EXISTS public.digest_issue_versions (
  id           bigint generated always as identity primary key,
  issue_id     bigint not null references public.digest_issues(id) on delete cascade,
  digest_id    bigint not null references public.digests(id) on delete cascade,
  issue_date   date not null,

  content      jsonb not null,
  html         text,
  item_count   integer not null default 0,
  status       text not null,          -- the status this version had when it was superseded (usually 'sent')
  delivered_at timestamptz,

  archived_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS digest_issue_versions_issue_idx
  ON public.digest_issue_versions (issue_id, archived_at DESC);

COMMENT ON TABLE public.digest_issue_versions IS
  'Snapshots of a digest_issues row taken right before a forced regenerate overwrites it. Read-only history; the live row is always current.';

-- RLS: owner-only, read-only. Written only by the pipeline (service role bypasses RLS) at the moment it
-- decides to overwrite a delivered issue.
ALTER TABLE public.digest_issue_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owners read their issue versions" ON public.digest_issue_versions;
CREATE POLICY "owners read their issue versions"
  ON public.digest_issue_versions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.digests d WHERE d.id = digest_id AND d.owner_id = auth.uid()));
