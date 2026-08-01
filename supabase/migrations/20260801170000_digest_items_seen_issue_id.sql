-- Which issue recorded each seen-item.
--
-- Needed to make "regenerate today" actually work. Without it, regenerating is a trap: the first build
-- marked its items seen, so the rebuild dedupes every one of them away and produces an EMPTY issue — the
-- dedupe layer doing exactly its job, in the one case where you don't want it to. Attributing each row to
-- the issue that wrote it lets a regenerate forget precisely that issue's memory and nothing else.
--
-- Deliberately NOT `on delete cascade`: an issue row can be deleted while the dedupe memory should survive
-- (that's the point of a 90-day horizon). `on delete set null` keeps the fact that the URL was delivered and
-- only loses the attribution.
alter table public.digest_items_seen
  add column if not exists issue_id bigint references public.digest_issues(id) on delete set null;

-- Regenerate deletes by issue, so index that access path.
create index if not exists digest_items_seen_issue_idx
  on public.digest_items_seen (issue_id)
  where issue_id is not null;

comment on column public.digest_items_seen.issue_id is
  'The issue that delivered this item. Lets "regenerate" forget exactly that issue''s dedupe memory; null for rows whose issue was deleted.';
