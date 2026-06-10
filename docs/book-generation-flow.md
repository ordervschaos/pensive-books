# How a book gets generated — flow, flaws, concerns

A trace of the end-to-end path that turns a brief into a written book, and the problems found
along the way. Grounded in the actual code (June 2026). Companion to
`docs/multiresolution-outline.md` (the ladder model) and `learning_resolution_graph_surface.md`
(the graph surface).

---

## 1. The ladder (what the layers are)

```
brief        books.brief            author-owned, structured (genre/audience/premise/tone/scope)
  │  brief-to-spine            (down only)
spine        books.spine = {text, brief_hash}      one throughline paragraph
  │  spine-to-objectives       (the ONE 1→N transform — mints the page units)
objective    pages.metadata.objective              per text page, one sentence
  │  objective-to-beat
beat         pages.metadata.beat                   per page, one-paragraph plan  ← OPTIONAL in practice
  │  beat-to-prose
prose        pages.content (TipTap doc)            the page body
```

Provenance hashes (`pages.metadata.sync.<edge> = {p,c}`, plus the legacy `prose_src_hash`) are
meant to mark an edge "stale" when either endpoint changes. See `lib/planProvenance.ts`.

## 2. The happy path (who does what, sync vs async, durable vs not)

| # | Stage | Trigger (UI) | Function | Sync? | Durable row? | Reviewed before commit? |
|---|-------|--------------|----------|-------|--------------|--------------------------|
| 1 | Brief | Brief tab (`BookBriefSection`) | — (form) | — | — | n/a (author types it) |
| 2 | Spine | graph spine node / `GraphActions` | `brief-to-spine` (sonnet-4-6, **hardcoded**) | yes | no | yes — diff in node sheet |
| 3 | Outline | "Generate outline" (`ScaffoldGenerator`) | `spine-to-objectives` (high model) | **no** | `book_generations kind=scaffold` | **yes** — review/edit dialog, then client creates pages via `create_next_page` RPC |
| 4a | Write (incremental) | "Write next page" (`WriteNextPage`) | `beat-to-prose` (high) | yes | **no** | **no** — writes the page, then "read it" |
| 4b | Write (bulk) | "Write all" (`WriteAllPages`, admin) | `generate-book` self-chaining (high) | no | `kind=write_all` | no (bulk, by design) |
| 4c | Write (one node) | graph prose node (`ProseNodePanel`) | `generate-page` (high) | no | `kind=page_write` | **yes** — draft/diff before "Add to page" |
| 5 | Beat | graph beat node only | `objective-to-beat` (sonnet) | yes | no | yes |
| 6 | Re-sync stale prose | `StalePanel` | `generate-book` re-render mode | no | `kind=rerender_stale` | no |
| 7 | Editor's read | `GraphActions` | `evaluate-book` | no | `book_evaluations` | n/a (read-only report) |
| 8 | Revise | `GraphActions` / nodes | `build-revision` / `revise-*` | no | `book_revisions` / `book_generations` | yes |

**Continuity context** (`buildUnitContext` in `_shared/generate-unit-core.ts`): each page write is fed
the full **outline** (titles+objectives), a **"story so far"** built from earlier pages' one-line
`summary` fields, and the **full prose of the previous 2 text pages**. After each write a cheap haiku
**summary** is persisted (best-effort) for later pages to lean on.

**Robustness of the bulk cascade** (`generate-book`): one page per invocation (under the ~150s worker
cap), self-chains to the next, `pg_cron` watchdog revives a dead chain, 3 retries/page, a
**poison-page guard** (skip after 3 stalled head-attempts), billing-error fast-fail. This part is
genuinely solid.

---

## 3. Flaws & concerns

Ordered by how much they bite. ⬛ correctness/coherence · 🟧 UX · 🟦 cost/scale.

### ⬛ C1 — The spine→objective edge is never stamped (dead drift detection at the top)
Nothing writes `metadata.sync.spine_objective` — confirmed by grep; `spine-to-objectives` creates
pages with only `{ objective }`. So `isEdgeStale(spine, objective, undefined)` is always **false**
(the "don't badge what we didn't generate" rule). **Editing the spine never flags the objectives
below it**, even though the whole point of the spine is to be the parent they derive from. The graph
will show the objective column green while it's actually out of sync. The top of the ladder is
decorative for the dirty-graph.

### ⬛ C2 — The beat layer is bypassed by every bulk/default write
`beatToProse` uses `beat ?? objective`. Nothing in the main flow generates beats: scaffold makes
objectives, `WriteNextPage`/`generate-book` go straight objective→prose. Beats only exist if the
author hand-makes them per node in the graph. Result: a book is normally written **objective→prose**,
skipping the middle resolution the ladder is built around — and a book can end up with beats on some
pages and not others, so "how this prose was derived" is inconsistent page to page. There is no
"generate all beats" step and no prompt to make one.

### ⬛ C3 — The spine is optional and half-wired
`spine-to-objectives` falls back to the brief when no spine is set, and `brief-to-spine` even feeds
the *current outline* back in "for consistency" (child → parent). So you can scaffold a whole book
with an empty spine node (graph shows it as a gap, generation doesn't care), and the spine that does
exist is never enforced or reconciled downward (see C1). The spine is presented as a first-class
book-level objective but functions as an optional hint.

### ⬛ C4 — Out-of-order writing silently degrades continuity
Continuity leans on *earlier* pages already having prose + summaries. `WriteNextPage` enforces
in-order (always the first empty page) and `generate-book` writes in `page_index` order — but the new
graph prose node (`ProseNodePanel`) and the page workshop let you write **any** page first. Write
page 20 before 1–19 and it gets an empty "story so far" and no preceding prose, with no warning. The
graph invites exactly this (click any node), so the regression is now easy to hit.

### 🟧 C5 — Two different "write a page" commit semantics
`WriteNextPage` writes the page **immediately**, then says "read it." `ProseNodePanel` / `PageWorkshop`
**propose a draft/diff** and wait for "Add to page." Same conceptual action, two trust models, on the
same surface (`GraphActions` mounts `WriteNextPage`; the graph above it mounts the propose-first one).
Confusing, and the un-reviewed one is the more prominent CTA.

### 🟧 C6 — Failed pages are invisible on the graph
A page the cascade gave up on (poison-page skip, or a hard failure) ends as **empty prose** = a "gap"
node, indistinguishable from "never attempted." `generate-book` tracks `failures` and the toast says
"X of Y filled (Z failed)," but the graph (the surface we just made primary) shows no error state on
the node, and the failure count isn't surfaced there at all. The author has no durable signal of
*which* pages failed.

### ⬛ C7 — Planned threads drift from the outline
Threads are minted at scaffold time, anchored to pages by `createdIds[index]`. That mapping is correct
only at creation. Add/remove/reorder pages afterward (Manuscript tab, hand edits, a second scaffold)
and the `setup_page_id`/`payoff_page_id` anchors don't move — a thread can point at the wrong page or
a deleted one. Re-scaffolding also **stacks** threads (and pages); the only guard is a `window.confirm`
when the book already has >5 pages.

### 🟦 C8 — No batching; cost and latency scale linearly with pages
Every page = 1 high-model prose call + 1 haiku summary call; beats and re-renders add more. A 50-page
book is ~100 calls, strictly sequential in the cascade (one page per invocation for continuity). No
map-reduce, no parallel fan-out, no cheaper first-draft pass. Fine for a short story, expensive and
slow for a novel (and the ~150s worker cap means a genuinely long page can't be written at all — it
gets poison-skipped).

### 🟧 C9 — Model selection is inconsistent
`brief-to-spine` hardcodes `claude-sonnet-4-6`; everything else routes through `getActiveModels()`
(scaffold/prose = `high`, summary = haiku). So the spine — a structurally load-bearing artifact — is
pinned to a model that can't be tuned with the rest, and silently diverges if the active models change.

### ⬛ C10 — Metadata is edited by several independent read-modify-write paths
`stampProse`, `persistSummary`, beat persistence, and objective saves each do their own
`select metadata → spread → update`. Within the sequential cascade this is safe, but concurrent
actors (a summary finishing while the author edits the objective in the graph; two tabs) can clobber
each other's `metadata` keys. The earlier objective-clobber bug (now fixed) was exactly this class.
There's no single owner or atomic JSON-merge for `pages.metadata`.

---

## 4. The shortest list worth acting on

1. **Stamp `spine_objective` at scaffold time** (C1) — even a one-line change in `spine-to-objectives`
   to record `sync.spine_objective` per created page would make the top edge's drift real. Without it
   the graph's green is a lie above the prose layer.
2. **Decide the beat's role** (C2/C3): either make beats a real step in the write path (generate beats
   before prose, or drop the layer from the default flow and treat it as opt-in depth) — right now the
   ladder's middle is a dead rung.
3. **Warn on out-of-order writes** (C4) and **show failed/never-written distinctly on the graph** (C6)
   — both are small surface signals, now that the graph is the primary surface.
4. **Unify the write-a-page commit** (C5) so one action doesn't sometimes auto-write and sometimes
   propose.

C7 (thread anchors), C8 (batching/cost), C9 (model config), C10 (metadata writes) are real but lower
on the daily-pain axis.
