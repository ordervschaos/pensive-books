-- Optimistic concurrency for `digests.sections`.
--
-- Sections are one jsonb array, so every section edit is SELECT → modify in JS → UPDATE the whole array.
-- Nothing tied the write back to what the read saw, which makes a writer that commits in between silently
-- disappear — a classic lost update, and silent is the operative word: no error, no conflict, just an
-- earlier edit gone.
--
-- With one human in a form the window is milliseconds and this never fires. An AGENT makes it real: it
-- reads the digest at the start of a turn, thinks for twenty seconds, and writes an array computed from
-- what it saw. Anything the reader did in that window is overwritten.
--
--   you:    read v7 ── edit a section ── write ✓
--   agent:  read v7 ──────── thinks ──────────── write (array from v7)   ← the reader's edit is gone
--
-- So: a counter that every section write must match and then bumps, checked in the same statement
-- (`... where id = $1 and sections_version = $2`). Zero rows updated means someone else got there first.
-- Detection, not locking — the same mechanism as HTTP `ETag` / `If-Match`.
--
-- The response to a conflict is the interesting half and lives in the app (lib/digest/commands.ts): an
-- agent must NOT retry blindly, because a retry re-applies an intent that was computed against a
-- configuration which no longer exists. It re-reads and reconsiders.
--
-- DEFAULT 0, so existing rows need no backfill and the first write of each simply moves it to 1.
alter table public.digests
  add column if not exists sections_version integer not null default 0;

comment on column public.digests.sections_version is
  'Optimistic-concurrency counter for the `sections` array. Every section write must match the version it read and bumps it; a mismatch means a concurrent writer won and the caller must re-read. Scalar settings are NOT covered — a partial patch of different columns cannot clobber.';
