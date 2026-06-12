# Learning — removing the Threads & Bible UI and deleting dead `bible.text`

## Concepts

- **Dead code (orphaned code)** — code with no remaining caller/importer. Here: after deleting the Threads/Bible tabs, `lib/threads.ts`, `scan-threads`, and `generate-bible` had zero references and were removed.
- **Read-orphaned vs write-orphaned field** — a data field still *read* but never *written* (or vice-versa). `bible.text` was write-orphaned: 6 functions still read it, but its only writers (the Bible tab + `generate-bible`) were gone, so it was permanently empty → effectively dead. Drove the decision to delete its reads too.
- **JSONB blob with multiple sub-keys** — one DB column (`books.bible`) holding several independent values (`text`, `voice_sample`). Deleting one sub-key (`text`) ≠ dropping the column; `voice_sample` is load-bearing for the voice flow, so the column stays.
- **Plumbing / parameter threading** — passing a value down through many function signatures. Removing `bible.text` meant deleting a `bible: string | null` param from `bookContext`/`draftScaffold`/`reviseScaffold`/`callClaude`/`buildContext`/`draftVoiceSamples` across 5 edge functions, not just one site.
- **Context block (prompt assembly)** — a labeled section spliced into an LLM prompt (`BOOK BIBLE (established facts…)`). Removing the field meant deleting that block from each prompt builder *and* the system-prompt sentences that referenced "the bible."
- **Presentational component vs data layer** — the UI tab files (`ThreadsSection.tsx`, `BookBibleSection.tsx`) were just views; the *data* (`book_threads` table, `bible` column) is consumed directly by the studio/sequel/scaffold/lint flows. "Remove the UI, keep the data" = delete the former, keep the latter.
- **Discarded destructuring slot** — `[revResult, , pagesResult]` skips the 2nd Promise result. `ReviseWithAI` fetched `bible` into a skipped slot → unused → safe to drop from the `select`.
- **Vestigial read** — a still-wired read of data that can no longer be populated. The honest fix per "no speculative code" is to remove it, not leave a misleading feature surface.

## Net result
- **Deleted:** `ThreadsSection.tsx`, `BookBibleSection.tsx`, `lib/threads.ts`, `supabase/functions/scan-threads`, `supabase/functions/generate-bible`, all `bible.text` reads.
- **Kept (data the studio needs):** `book_threads` table, `books.bible` column (`voice_sample`), `book_thread_scans` table (not deleted — destructive), generation functions.
- **Modified edge fns to redeploy:** `spine-to-objectives`, `revise-outline`, `revise-agent`, `generate-voice`, `revise-scaffold`, plus `_shared/generate-unit-core.ts` (affects its importers).
- **Verification:** `tsc --noEmit` on `apps/web` → exit 0. No deno locally, so edge fns type-checked by inspection only.
