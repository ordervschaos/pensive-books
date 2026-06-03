# Admin access — book_chats only

## Decision trail
The three remaining tables were `page_audio_blocks`, `flashcards`, `book_chats`.
User chose to ignore `page_audio_blocks` and `flashcards` — give admin access to
`book_chats` only.

## Migrations
- `20260603004000_admin_remaining_tables_access.sql` (pushed) — initially added
  admin policies to all three.
- `20260603004500_admin_book_chats_only.sql` (pushed) — corrective: drops the
  `page_audio_blocks` and `flashcards` admin policies, leaving only
  `admins_can_read_any_book_chat`.

## Net effect
- `book_chats`: admins get `FOR SELECT` cross-user read (inspection); owners/
  users still limited to their own rows.
- `page_audio_blocks`, `flashcards`: unchanged from original gating — admins have
  no special access.

## Full admin coverage now
- Central helper `user_can_edit_book` (owner|editor|admin): book_evaluations,
  book_revisions, book_threads, book_thread_scans.
- Explicit admin policies: pages, book_access, books, book_chats (read-only).
- Client UI gate: check_book_access (via_admin flag + AdminViewBanner).
