# Admin → full owner view of books

## Goal
In the admin context, opening any book should render the **full owner workspace**
(editable brief, AI tabs, edit/publish actions, page editing, collaborator
management) instead of the stripped-down reader view admins got before.

## Decision
Chose **"Full owner powers"** — admins can actually act as the owner (edit pages,
reorder, manage collaborators), not just see the owner layout.

## Root cause
`check_book_access` (migration `20260602140000`) returned
`can_edit: false, is_owner: false` for admins. The entire owner workspace in
`BookDetails.tsx` / `PageView.tsx` is gated on `canEdit` (from the
`useBookPermissions` hook → this RPC), so admins fell through to the reader view.
Admins also lacked RLS write access to `pages` and `book_access`.

## Change — single new migration
`supabase/migrations/20260603000000_admin_full_owner_view.sql`

1. **`check_book_access`** — admin branch now returns
   `can_edit: true, is_owner: true` (owner-equivalent; also bypasses the
   mature-content gate, which keys off `is_owner`).
2. **`admins_can_write_any_page`** — `FOR ALL` RLS policy on `public.pages`
   (INSERT/UPDATE/DELETE) gated on `admin_users`.
3. **`admins_can_manage_any_book_access`** — `FOR ALL` RLS policy on
   `public.book_access` so admins can manage any book's collaborators.

Policies are permissive (OR'd with existing owner/collaborator policies) and
follow the pattern from `20260520000001_admin_read_access.sql`. Idempotent via
`DROP POLICY IF EXISTS` + `CREATE OR REPLACE FUNCTION`.

## Client
No client changes. The flags propagate through the existing
`useBookPermissions` hook; `BookDetails.tsx` and `PageView.tsx` already gate the
full editor purely on `canEdit` / `isOwner` / `hasAccess`.

## Status
- Migration pushed to remote (`supabase db push` ✅). The two
  `policy ... does not exist, skipping` NOTICEs are the expected idempotent
  DROP no-ops on first apply.

## Verify
Sign in as an admin, open another user's book from `/admin` → should land on the
full owner workspace, be able to edit/save a page, and manage collaborators.
