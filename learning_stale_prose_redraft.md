# Learning: Stale Prose Re-draft

## Concepts

- **Dirty graph / provenance tracking**
  - What: Each layer in a hierarchy (brief → spine → objective → beat → prose) stamps a hash of its source when content is generated. If the source changes later, the downstream node is "stale."
  - In this task: `metadata.prose_src_hash` stores the hash of the beat at prose-write time; `isProseStale()` compares current beat to that hash and returns true if they diverged.

- **CellState (`"gap" | "drift" | "synced"`)**
  - What: Three-state enum for any node in the resolution ladder.
  - In this task: `MapPage.prose === "drift"` is how the client identifies a page with stale prose.

- **Resolution ladder**
  - What: The book's layered content hierarchy — brief → spine → objective → beat → prose — where each layer is derived from the one above.
  - In this task: `discardProse` cuts the ladder at the prose rung, clearing prose while preserving beats.

- **Partial discard pattern**
  - What: Wiping a subset of pages' data (by filtering page IDs) rather than the whole book.
  - In this task: `staleIds = textPages.filter(p => p.prose === "drift")` targets only out-of-sync pages; `discardProse(bookId, staleIds)` resets just those.

- **Two-phase async action (discard → re-run)**
  - What: Sequencing a destructive cleanup step before firing a background job, with independent error handling for each phase.
  - In this task: `redraftStale` calls `discardProse` (clears stale prose), then `runAll` (kicks off the write-all background job). Each phase has its own error path so a failure in phase 1 never accidentally starts phase 2.

- **Amber drift affordance**
  - What: Using amber color (`border-amber-500/30`, `bg-amber-500/[0.06]`, `text-amber-500`) as the DS-sanctioned "out of sync" visual signal.
  - In this task: The stale notice panel uses amber to match the existing `Pip` component's drift color, keeping visual language consistent.
