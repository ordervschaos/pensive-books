# Learning — route generate-book through the dev bridge

## Concepts encountered

- **Bridge (dev proxy)** — literally a span connecting two sides. A localhost Node server (`scripts/eval-bridge.mjs`) that stands in for the paid Supabase edge functions during local dev, running Claude Code instead. Here: it had routes for every AI op *except* the bulk `generate-book` job, so that one always leaked to the paid edge. We added a `/generate-book` route.

- **Chokepoint (single entry point)** — one narrow passage all traffic must go through. New file `apps/web/src/lib/generateBook.ts` exports `invokeGenerateBook(body)`; every "build the draft" surface now calls it instead of `supabase.functions.invoke("generate-book")`. One place decides bridge-vs-edge, so the rule "use the bridge when the bridge URL is set" can't be forgotten at a call site.

- **Self-chaining function** — a function that re-invokes itself to do the next unit of work. The edge `generate-book` does this (one beat-batch or one prose page per invocation) to stay under the worker's ~150s wall-clock cap, with a `pg_cron` watchdog reviving a dead chain. Here: the bridge has *no* wall-clock cap, so it skips chaining entirely and runs the whole cascade in one async pass — same `book_generations` row, simpler control flow.

- **Fire-and-forget (background task)** — start async work, return the HTTP response immediately, let the work finish after. The bridge route inserts the running row, returns `{ generation: row }`, then drives beats→prose in the background, patching `progress` as it goes. Mirrors the edge's `202 + EdgeRuntime.waitUntil`.

- **Two-stage cascade (beats → pause → prose)** — the build runs in stages with an optional author checkpoint. Stage 1 plans a beat for every objective-bearing page; if `pauseAfterBeats`, the row goes `ready`/phase `beats_done` and waits for a `{ resume: true }` call; stage 2 writes prose for every empty page. Ported faithfully to the bridge.

- **Provenance stamping / dirty graph** — recording *which source* an artifact was derived from (via a stable hash) so downstream artifacts can be marked stale when the source changes. `stampBeat` (objective→beat edge) and `stampProse` (beat→prose edge, or legacy `prose_src_hash`). The single-page bridge routes let the *client* stamp; the bulk route has no client in the loop, so the bridge stamps itself. `metaHash` (cyrb53) must be byte-for-byte identical across Deno/browser/Node so the same text hashes the same everywhere.

- **Clobber-safe (idempotent skip)** — re-reading each page fresh right before writing and skipping any that already has prose, so a re-run or overlapping run never overwrites finished work (except in explicit `rerender` mode).

- **Poison-page guard** — edge-only: a per-head-page attempt counter so a page that keeps killing the worker mid-call isn't retried forever. Irrelevant on the bridge (no wall-clock kill), so it was dropped from the port.

## Deliberate parity gaps in the bridge port (dev-only, non-load-bearing)
- No best-of-3 beat judging (single sample) — the edge samples 3 + judges; cents/page quality nicety.
- No character-ledger extraction — `extract-character-states` writes `pages.metadata.character_states`, but the bridge's own `runUnit` doesn't *read* the ledger, so extracting it in dev would write data nothing consumes.

## Bug found along the way
The old dev path (`runViaBridge`/`rerenderViaBridge` in WriteAllPages/StalePanel) POSTed to `/unit` — a bridge route that **doesn't exist** → every page 404'd into the failure counter → silently empty pages. Deleted; superseded by the real `/generate-book` route.
