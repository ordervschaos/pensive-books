# Thread anchors refactor

## What changed

Threads now model the promise and resolution as **spans across multiple pages**, not single points.

### Migration: `20260603150000_add_thread_anchors.sql`
- New table `book_thread_anchors`: `(thread_id, page_id, role, sequence, note, word_offset)`
- `role` = `'promise' | 'resolution'`
- `sequence` orders anchors within a thread+role (0 = first)
- Existing `setup_page_id`/`payoff_page_id` data migrated to anchor rows (`promise[0]`, `resolution[0]`)
- Old columns dropped from `book_threads`
- RLS mirrors `book_threads` (via `user_can_edit_book`)

### `supabase/functions/scan-threads/index.ts` — complete rewrite
- **Model changed**: Opus → Haiku (`claude-haiku-4-5-20251001`)
- **Architecture**: rolling per-page loop instead of one big call
  - Each page → one Haiku call with page prose + full thread registry
  - Returns: `new_threads[]`, `promise_reinforced[]`, `resolved[]`
  - Thread registry never shrinks — a closed thread stays in context, can receive more resolution anchors
- **Output**: `AnchorEvent[]` (one per anchor) instead of `ThreadChange[]` (diffs)
- Word offsets and sequence numbers computed server-side (never trusted from model)
- Single page failure is non-fatal: logged and skipped, loop continues
- Summary built programmatically from event counts

### `apps/web/src/lib/threads.ts`
- `ThreadAnchor` type added
- `Thread.book_thread_anchors: ThreadAnchor[]` (joined in `fetchThreads` select)
- `ThreadChange` removed → replaced by `AnchorEvent`
- `ThreadScan.changes` → `ThreadScan.events: AnchorEvent[]`
- `firstPromise(t)` / `lastResolution(t)` convenience helpers exported
- `fetchThreads` sorts client-side by first promise word offset
- `fetchPendingScan` detects old-format scan rows (have `action`, not `role`) and discards them gracefully
- `applyThreadScan`: inserts new `book_threads` rows for `isNewThread=true` events, then batch-inserts all anchor rows

### `apps/web/src/components/book/ThreadsSection.tsx`
- `distanceLine` reads from anchors (`firstPromise` → `lastResolution`)
- Thread list: "↪ setup / ↪ payoff" links → "↪ first promise / ↪ last resolution"
- Review panel: events grouped by thread, each anchor is its own checkbox
- Apply button label: "Apply N anchors" (was "Update N threads")
- Scan spinner copy: "Scanning page by page…" with ~1–2s per page estimate

## Verification
`tsc --noEmit -p tsconfig.app.json` → exit 0

## Deploy needed
- `supabase db push` for the migration
- `supabase functions deploy scan-threads`
