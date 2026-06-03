# Central admin = owner-equivalent access

## Trigger
Admin (full owner view) couldn't see a book's evaluation on
`/books/1117-...`. Root cause: `book_evaluations` RLS is gated on
`user_can_edit_book(book_id)` (owner OR accepted editor) — admins weren't
included. The first "full owner powers" migration only covered `pages` and
`book_access`, so every other book-scoped feature table was still blocked.

## Fix — one central lever
`user_can_edit_book(_book_id)` is the shared RLS predicate behind all the
book-scoped feature tables. Folding the admin check into it grants admins
owner-equivalent CRUD across all of them at once (and any future table that
reuses the helper).

`supabase/migrations/20260603003000_admin_central_edit_predicate.sql` (pushed ✅):
- `user_can_edit_book` now returns true for: owner OR accepted editor OR admin.
- Drops the now-redundant per-table `admins_can_access_any_evaluation` policy
  (added in `20260603002000`, superseded by the central change).

### Tables now covered via the helper
`book_evaluations`, `book_revisions`, `book_threads`, `book_thread_scans`.

### Tables covered separately (inline predicates, not the helper)
- `pages`, `book_access` — explicit admin policies (`20260603000000`).
- `books` — `admins_can_update_any_book` / `admins_can_read_any_book`.
- `check_book_access` RPC — client UI gate, already admin-aware.

## Still owner-only (NOT covered — flagged for decision)
Older Jan/Feb feature tables that inline their own owner predicate and don't use
`user_can_edit_book`: `flashcards`, `book_chats` (Chat with Book), and
`page_audio_blocks`. Admins still can't access these. They're secondary
reader/study features, not the core editing workspace — left as-is pending a
call on whether admins need them.

## Verify
Reload `/books/1117-...` as admin → the evaluation result renders. Revise-with-AI
and Threads tabs also load/save.
