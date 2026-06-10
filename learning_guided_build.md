# Learning: Guided build — the blocked, game-like ladder

Making the AI flow the default post-creation surface, as a level-by-level ladder where each step is
verified (author-approved) before the next unlocks.

- **Gated progression / level lock (the "game" pattern)**
  - What it is: a linear sequence where step N+1 is inaccessible until step N is cleared.
  - Here: brief→spine→outline→voice→beats→draft; `stateOf(k)` returns locked unless the prior step is approved.

- **Verification gate ≠ existence check**
  - What it is: "the artifact exists" and "a human signed off on it" are different states; a deliberate approval is the gate.
  - Here: a step is `awaiting` (Approve lights up) only when the artifact is *ready* (computed from data), and `done` only once the author clicks Approve — two separate conditions.

- **Persisted approval ledger**
  - What it is: the cleared-levels are real state, not ephemeral UI, so a refresh doesn't reset the game.
  - Here: `books.journey` jsonb — each step key → ISO timestamp of approval. Absent = not cleared.

- **Derived-from-data status, augmented by a tiny explicit ledger**
  - What it is: most status is computed (does a spine exist? do all pages have beats?), but "approved" can't be derived, so it gets the smallest possible persisted footprint.
  - Here: readiness is computed every render; only the six approval booleans live in the DB. (Same philosophy as BookJourney's derive-from-data, plus the one thing you can't derive.)

- **Guided-only lock (soft gate)**
  - What it is: the guided path is gated, but the escape hatch (manual editing in the full workspace) is always one click away — you constrain the *default* without trapping the user.
  - Here: "Skip to the full workspace" is always present; the lock blocks the ladder's next step, never the manuscript.

- **Default-surface swap by lifecycle**
  - What it is: which view is "home" depends on the object's stage — early books open into the flow, mature books into the workspace.
  - Here: `showGuided = canEdit && !journey.draft && !guidedExited` chooses GuidedBuild vs the tabbed workspace; a per-book localStorage opt-out + a "Resume guided build" link.

- **Dead-code discovery (the live-path check)**
  - What it is: before extending a component, confirm it's actually rendered — a "kept for reference" file silently swallows changes.
  - Here: `BookJourney.tsx` was unmounted; the live AI surface is `GraphActions`. Milestone-1 Voice and Milestone-2 AutoRevise had landed in the dead file and were invisible until re-surfaced via GuidedBuild + GraphActions.

- **Resume/replace on a durable row (recap)**
  - What it is: a paused self-chaining job is resumed by re-kicking the SAME row, not starting a new one.
  - Here: `DraftProse` checks for a `status='ready', phase='beats_done'` write_all row and sends `{generationId, resume:true}`; else a fresh `{bookId}` build.
