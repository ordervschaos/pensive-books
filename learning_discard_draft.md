# Learning — Discard whole draft & re-generate

Concepts touched while adding "discard the whole prose (and beats) and re-draft" to the Build Studio's Draft step.

## Data model
- **Resolution ladder** — the per-page chain `spine → objective → beat → prose`. Literally a ladder of increasing detail; each rung is generated from the one above. Here: discard wipes the bottom two rungs (beat + prose), keeps objective.
- **Provenance hash / dirty-graph** — store a hash of the source text a child was generated from; child is "stale" when the hash no longer matches. Lives in `pages.metadata.sync` (per-edge `{p,c}` snapshots) + legacy `prose_src_hash`. Discard deletes these so nothing is left pointing at wiped content.
- **Delta (planned vs extracted)** — a page's *change* to narrative state. `planned_delta` authored at Beats; `extracted_delta` distilled from prose. Both cleared on discard (they belong to the beat/prose rungs).
- **Character ledger** — full character state snapshot stamped onto each page after prose is written (`metadata.character_states`). Prose-derived → cleared on discard.
- **TipTap JSON doc** — page body is a JSON document (`{type:"doc", content:[heading, ...paragraphs]}`). "Empty page" = title-only doc; `buildDoc(title, "")` produces it. `bodyText()` reading empty → studioModel sees the page as prose-gap again.

## Architecture / patterns
- **Read-model (derived state)** — `studioModel` computes the whole studio (step ladder + per-page pips) purely from artifacts (books + pages + journey). Discard just changes artifacts; the model re-derives, so no view needs manual sync.
- **Approval ledger (`books.journey`)** — author sign-off per step, stored as timestamps. `statusOf` returns "done" from the ledger *regardless* of artifacts → wiping artifacts without clearing the ledger leaves stale green dots. Fix: discard also `delete journey.beats/draft`.
- **Durable self-chaining task** — `generate-book` writes one unit (a beat batch or one prose page) per invocation, persists progress, then re-invokes itself (`EdgeRuntime.waitUntil`) to dodge the ~150s worker cap. Regeneration after discard reuses this unchanged.
- **Fill mode vs re-render mode** — `generate-book` skips pages that already have prose (fill, clobber-safe) unless given explicit `pageIds` (re-render, overwrites). We chose discard-then-fill over re-render so the author can adjust between.
- **Idempotent / clobber-safe** — re-reading the row before each write so a refresh or second tab can't double-run. The discard confirm (`window.confirm`) is the existing destructive-action pattern (see ScaffoldGenerator).

## This task specifically
- **Two discards, cut at different ladder depths, one button per step.** Because prose is generated from the beat, you can't keep prose whose beat is gone — so the two options are **beats + prose** (Beats step) and **prose only** (Draft step); there is no "beats only."
- New `lib/discardLadder.ts` exports two functions over a shared `patchPages` helper (fetch title+metadata fresh → return a content/metadata patch per row → `Promise.all`, reject on first failure) + `revertJourney`:
  - `discardBeatsAndProse(bookId, pageIds)` — resets body to title-only `buildDoc(title, "")` and strips EVERY metadata field below the objective (`beat`, both deltas, `delta_sync`, `summary`, `character_states`, all `sync`, `prose_src_hash`, `lint_flags`). Reverts `journey.beats` + `journey.draft`. Wired into **BeatsStep** (all-beats-planned strip + a faint footer in the by-hand section); `discardIds` = pages where `beat !== "gap" || prose !== "gap"`.
  - `discardProse(bookId, pageIds)` — title-only body + drops only prose-derived metadata (`summary`, `character_states`, `extracted_delta`, `delta_sync`, `prose_src_hash`, `lint_flags`, `sync.beat_prose`); keeps the beat. Reverts `journey.draft`. Wired into **DraftStep**; `discardIds` = pages where `prose !== "gap"`.
- `onChanged()` re-derives `studioModel` after each discard so the matching "generate all beats / write all prose" path reappears.
- **Known gap (skipped v1)**: `book_threads` open/closed statuses are flipped by prose generation and not reverted on discard — they re-settle on the next draft.
