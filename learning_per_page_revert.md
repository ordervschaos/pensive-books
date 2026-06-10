# Learning: Per-Page Revert

## Concepts encountered

- **Soft delete (archiving)**
  - Literal: marking a row as deleted without removing it
  - What it is: setting `archived = true` instead of running `DELETE`; the row stays in the DB, invisible to most queries
  - In this task: "added" pages with no committed snapshot are reverted by archiving, not hard-deleting; this keeps the data recoverable and avoids foreign-key cascade issues

- **ON DELETE SET NULL (referential action)**
  - Literal: when the referenced row is deleted, set the FK column to NULL
  - What it is: a PostgreSQL referential integrity option that nullifies foreign key references instead of blocking or cascading deletes
  - In this task: `page_versions.page_id` uses this so page_versions survive if a page is hard-deleted; the draft-changes query filters `page_id IS NOT NULL` to ignore orphaned snapshots

- **FULL OUTER JOIN for diffing**
  - Literal: returns all rows from both tables, matching where possible, NULL-filling where not
  - What it is: a join strategy that surfaces additions (no left row), deletions (no right row), and modifications (both rows but differing)
  - In this task: `get_draft_changes` joins `cur` (current pages) and `ver` (committed page_versions) with a FULL OUTER JOIN, then filters to only rows where something differs

- **SECURITY DEFINER function**
  - Literal: the function runs as the user who defined it (usually the DB owner), not the caller
  - What it is: a Postgres function attribute that bypasses RLS on tables the function touches; the function does its own permission check explicitly
  - In this task: `revert_page` is SECURITY DEFINER so it can UPDATE `pages` regardless of the caller's RLS role, but it guards with an ownership check first

- **Optimistic query invalidation**
  - Literal: invalidating a cached query result immediately after a mutation, before confirming the new server state
  - What it is: calling `queryClient.invalidateQueries` after the mutation so React Query refetches the stale list automatically
  - In this task: after `revertPage` resolves, both `draft-changes` and `uncommitted-changes` queries are invalidated so the sidebar count and file list update without a page reload

- **AlertDialog (destructive confirmation pattern)**
  - Literal: a modal dialog that requires explicit user confirmation before a destructive action
  - What it is: a UI pattern (shadcn `AlertDialog`) that blocks the action behind a two-step confirm; the first click opens the dialog, the second executes
  - In this task: the RotateCcw button opens the dialog, which shows the page name and a red "Discard changes" button to prevent accidental reverts

- **group-hover (Tailwind)**
  - Literal: apply a style to a child only when its parent is hovered
  - What it is: Tailwind's `group` + `group-hover:*` utility pattern; the parent gets `group`, the child uses `group-hover:opacity-100`
  - In this task: the revert button is hidden (`opacity-0`) until the row is hovered, keeping the sidebar uncluttered

- **e.stopPropagation()**
  - Literal: stop the event from bubbling up to parent handlers
  - What it is: prevents a click on the revert button from also triggering the row's `onClick` (which would expand the diff viewer)
  - In this task: without it, clicking the revert icon would both open the confirmation dialog AND select the file for diffing
