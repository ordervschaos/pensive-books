# learning — applied spine not reflecting without refresh

## The bug
Applying a spine proposal in the rail wrote `books.spine` (server state changed) but the left "Spine" panel still showed "No spine yet" until a manual page refresh.

## Concepts
- **Live projection (vs. fetch-once)** — "the UI continuously mirrors server state instead of reading it once." The codebase's standing rule ("Refresh = no-op"). The panel violated it: spine was read once into React state, gated on an internal counter.
- **Realtime / postgres_changes (Supabase)** — DB row changes are streamed to subscribed clients over a websocket channel. `supabase.channel(...).on("postgres_changes", {event,table,filter}, cb)`. Here: subscribe to `books` UPDATE → re-read.
- **Prop-drilled callback chain ("epoch counter")** — `onChanged → railOnChanged → refresh → setInfoKey(k+1)`; `infoKey` (passed down as `editorEpoch`/`reloadKey`) gates the re-fetch. In-process and best-effort: a missed/raced callback leaves the panel stale. This was the fragile link.
- **Debounce** — coalesce a burst of events (e.g. a build writing many rows) into one re-read; `setTimeout(...,300)` cleared on each event.
- **Idempotent re-read** — the Realtime handler bumps a counter that triggers a SELECT (no write), so it can't loop back into another Realtime event.

## The system
- **Writer:** rail apply → `applyProposal` → `saveSpine` → `books.spine` UPDATE.
- **Two readers of `books`:** `StudioPage` (already live via Realtime, but only re-fetches `book`+`pages` props) and `BuildStudio` (read spine/foundations/canon SEPARATELY in a `[bookId, infoKey]` effect — never re-fired by Realtime). The separate reader was the stale one.
- **Fix:** added a `books` UPDATE Realtime subscription in `BuildStudio` that bumps `infoKey`. Because `editorEpoch={infoKey}` also feeds `SpineStep.reloadKey`, one subscription makes both the Navigator dots and the Spine panel live. `SpineStep`'s `dirty` guard still prevents clobbering an in-progress author edit.

## Files
`apps/web/src/components/book/studio/BuildStudio.tsx` — one `useEffect` (channel `studio_build_<bookId>`).
