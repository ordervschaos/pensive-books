# Admin view banner indicator

## Goal
When an admin edits a book they don't own (access via the admin override), show
an unmistakable banner so they know edits land on someone else's book.

## Problem
After "full owner powers", `check_book_access` reports admins as
`is_owner: true` — so the client couldn't distinguish a real owner from an admin.

## Changes

### DB — `supabase/migrations/20260603001000_check_book_access_admin_flag.sql` (pushed ✅)
`check_book_access` now returns:
- `via_admin` (boolean) — true only on the admin-override branch, false for
  owner/collaborator/no-access.
- `owner_label` (admin branch only) — `COALESCE(username, email)` from
  `user_data`, mirroring `get_admin_stats`, so the banner can name the owner.

### Hook — `apps/web/src/hooks/use-book-permissions.ts`
Exposes new `viaAdmin` and `ownerLabel` alongside the existing flags.

### Component — `apps/web/src/components/book/AdminViewBanner.tsx` (new)
Amber Shield banner: "Admin view. You're editing a book owned by {owner}.
Changes are saved to their book."

### Wiring
- `BookDetails.tsx` — renders `{viaAdmin && <AdminViewBanner .../>}` at the top
  of the workspace column.
- `PageView.tsx` — same, at the top of the main content column.

## Verification
- `tsc --noEmit` in `apps/web` → exit 0.
- Manual: as admin, open another user's book/page from `/admin` → amber banner
  naming the owner appears above the editor; the real owner sees no banner.
