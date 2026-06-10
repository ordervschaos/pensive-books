# Learning: Character Ledger (the state axis, ledger 1)

Built Milestone-2 piece 1 — the original "state axis" ask. Causality + promise/payoff ledgers
landed in Milestone 1 (`learning_sota_milestone1_build.md`); this is the character ledger.

- **Character state object / ledger**
  - What it is: each character carries a structured state — `want`/`wound` (stable arc poles) + `knows`/`feels`/`has`/`believes` (mutable). The arc IS the diff between first and last state.
  - Here: `CharacterState` in `generate-unit-core.ts`, stamped onto `pages.metadata.character_states`.

- **Stable poles vs mutable state**
  - Literal: want = external goal; wound = the internal flaw the arc heals.
  - What it is: separate what never changes (want/wound) from what changes per page (knows/feels/has/believes) so the model carries one forward verbatim and only revises the other.
  - Here: the extraction prompt is told to keep want/wound stable once set.

- **Snapshot carry-forward (event-sourcing-lite)**
  - What it is: instead of storing deltas, each page stores a FULL snapshot of every character; "current state before page N" = the most recent prior snapshot. Latest-wins, no replay.
  - Here: `priorCharacterStates()` finds the last prior page with a snapshot; `buildUnitContext` injects it; the new page writes its own full snapshot.

- **Sequential cascade as the state conveyor**
  - What it is: because prose pages are written one-per-invocation in order, the freshest snapshot is always already in the DB when the next page runs — no orchestrator plumbing needed to pass state between pages.
  - Here: `generate-book`'s prose stage gets character flow "for free"; same for attended `WriteNextPage`.

- **Two-pass extraction (LLM as structured-state extractor)**
  - What it is: keep the prose call's `{text}` contract untouched; a SECOND cheap Haiku call reads the prose and emits structured JSON state. Decouples generation from bookkeeping.
  - Here: `extractCharacterStates()` (Haiku, JSON-only) runs after the prose write, beside the existing summary call.

- **Best-effort side-effect**
  - What it is: post-write enrichment that must never fail the primary write — wrapped in try/catch, a parse miss just skips the update.
  - Here: `maybeExtractCharacterStates` mirrors `maybeSummarize`; both are fire-and-forget-ish, awaited but swallowed.

- **Schemaless JSONB extension**
  - What it is: add a new field to an existing JSONB column with zero migration; the column is a bag.
  - Here: `pages.metadata.character_states` needed no DB change — same trick the promise ledger reused on `book_threads`.

- **Cache split discipline (recap, applied again)**
  - The ledger went into the per-page `variablePart` (it changes every page), NOT the cached `stablePrefix` (book/brief/voice/bible/outline) — preserves prompt-cache hits.
