-- Add plan_only to book_revisions: an outline-only revision changes objectives + structure and
-- writes NO prose. Pages whose objective changes are left flagged "out of sync" (their prose's
-- prose_src_hash stops matching the new objective) for the author to re-render on their terms.
--
-- It's a column (not just a flag inside `plan`) because planning is resumable: a tab refreshed
-- mid-planning re-drives the architect off the persisted row, so the mode has to survive there.

ALTER TABLE public.book_revisions
  ADD COLUMN IF NOT EXISTS plan_only boolean not null default false;
