# learning: beats bulk generation moved to chat

Task: remove the in-center generate-book bulk pipeline from BeatsStep and replace the cold-start empty state with a `GenerateInChat` CTA that triggers the rail chat.

## Concepts encountered

- **Chat-first studio** — architectural pattern where ALL AI generation lives in a right-rail chat (ReviseChat); the center Stage is a near-manual editor. Pioneered by Cursor IDE. Appeared as the governing design doc (`docs/chat-first-studio.md`) that directed this task.

- **Durable task row** (`useLatestTaskRow`) — a React hook that polls/subscribes a `book_generations` DB row to surface a long-running server-side job's status/progress. Appeared as the `buildRow`/`buildProgress`/`buildActive` block in BeatsStep — removed because bulk generation no longer lives in the center.

- **Pauseable pipeline** (`pauseAfterBeats`) — a generate-book invocation flag that pauses after the beats phase, producing a `"beats_done"` checkpoint before prose starts. Appeared in `runBulkBeats` / `buildPaused` / the `DoneStrip` "write all prose →" branch — all removed.

- **`GenerateInChat`** (studioUi atom) — a button that calls `triggerGenerate(bookId, layer)`, sending a generate message to the right-rail chat. The chat then thinks and produces a reviewable proposal. Used here as the cold-start CTA for the beats layer.

- **Empty-state pointer** — UX pattern: when a center has no content, show a calm text line + a `GenerateInChat` button that directs the author into the chat rail instead of running generation inline. Mirrored from `SpineStep.tsx`.

- **Always-on manual editor** — `BeatSheet` is always rendered (when `total > 0`), even in the empty state; it shows editable beat fields even when all beats are "gap". This lets a manual author type beats without touching the chat.

- **`discardAllBeats` / `discardIds`** — manual deletion affordance that cascades: removes beats + prose back to objectives-only. Kept intact; the guard `buildActive` was removed since there's no bulk run to protect against anymore.

- **`buildRunning` guard removal** — the original `discardAllBeats` blocked on `buildActive`; now that the bulk pipeline is gone the guard is dropped (only `discarding` state guard remains).

- **Typecheck gate** (`tsc --build`) — run after every structural change to verify no broken imports or type mismatches. Passed clean on first run after the rewrite.
