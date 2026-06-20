# Structure as the artifact, pages as the render

**Status:** design + build. Supersedes the page-materialization half of `multiresolution-outline.md`
(that doc's resolution ladder + dirty-graph still hold; what changes is *where the outline lives*).

**Hypothesis.** A good story is **good structure rendered with prose.** So the structure must be a
first-class, accurate, cheaply-operable artifact — not something we smear across page rows the moment
it's proposed. Pages are a *render* of the structure, produced (and re-produced) on demand.

---

## 1. The problem this fixes

Today `spine-to-objectives` produces structured JSON (`{ structure, pages[], threads[],
tentpolePlacements[] }`) and parks it in a `book_generations` task row — cheap, revisable JSON. Good.
Then on author confirm, `ScaffoldGenerator` **eagerly materializes** it into the database: one `pages`
row per node, `book_threads` + `book_thread_anchors` anchored to those page ids, tentpoles stamped
with `placed_page_id`, edge hashes in each page's metadata. From that instant **the outline *is* the
pages**: order = `page_index`, objective = `pages.metadata.objective`, identity = page id.

Consequences:
- **Revising the outline = page CRUD + reindex + re-anchor.** The "9 retargeted, 19 revised, 28
  changes · rebuilds prose" screenshot. Heavy DB ops to edit what is conceptually a plan.
- **Identity is positional.** Even the pre-commit scaffold anchors threads/tentpoles by *array index*,
  so a single reorder needs `remap()` over every anchor.
- **You commit to page boundaries before a word exists.** Pagination is a planning-time decision, which
  is exactly backwards — every real outlining method (corkboard cards, beat sheets, Snowflake,
  grid/spreadsheet) treats the **scene/beat** as the unit and pagination as a downstream projection.

## 2. The model

```
spine ──► books.outline (JSON, stable node ids)      ← THE editing + AI-revise surface
                  │   reorder / insert / cut / retarget = rewrite JSON → one column write. Zero page churn.
                  │
                  ▼  reconcile()  (the "compile" / projection — a DIFF, applied on author confirm)
            pages rows  ──► beats ──► prose            ← the RENDER. Still the read surface for the pipeline.
```

The outline is the **virtual DOM**; `reconcile()` is React's diffing; pages are the **real DOM**.
We build the virtual DOM as a standalone artifact instead of eagerly committing it.

**The key to keeping the blast radius small:** `pages.metadata.objective` stays as a *materialized
copy* of the node's objective. Everything below the outline (beat-core, beat-to-prose, lints,
planGraph, the dev bridge) keeps reading `pages.metadata` **unchanged**. Only the *authoring surface*
for structure moves up to `books.outline`. Reconcile copies node.objective → page and re-stamps the
`spine_objective` edge, so changing an objective in the outline correctly marks that page's beat/prose
stale — the existing dirty-graph does the rest.

## 3. Schema

### `books.outline` jsonb (new column, nullable — null = legacy/page-native book)

```jsonc
{
  "structure": "Save the Cat",
  "nodes": [
    { "id": "n_a1b2", "type": "section" | "scene",
      "title": "Chapter 1 — ...",
      "objective": "",            // scene only; what this unit must achieve, one sentence
      "delta": [ ... ],           // scene only, optional (pin-driven flow Delta[])
      "tentpoleId": "..." }       // scene only, optional: the tentpole this scene realizes
  ],
  "threads": [
    { "id": "t_x9", "name": "...", "description": "...",
      "setupNodeId": "n_a1b2" | null, "payoffNodeId": "n_..." | null,
      "targetDistance": 4200 | null }
  ],
  "spine_hash": "<metaHash(spine) the outline was built from>",   // outline stale if spine moves
  "rev": 7,            // monotonic; bump every save (display + cheap optimistic check)
  "compiled_rev": 5    // the rev last reconciled into pages → "outline ahead of pages" badge
}
```

`type` is `section` (chapter/part divider) or `scene` (a unit of prose — what used to be a "text"
page). One node can later render to *more than one page* if we want; v1 is 1:1.

### `pages.metadata.node_id` (string, no migration — jsonb)

Links a materialized page back to its outline node. Reconcile is keyed on this. A page with **no**
`node_id` is author-created-outside-the-outline (or legacy) and reconcile never touches it.

### `book_threads`: `setup_node_id`, `payoff_node_id`, `plan_thread_id` (new text columns)

The node id is the **durable** thread anchor; `setup_page_id`/`payoff_page_id` become *derived* (set
on reconcile via the node→page map). `plan_thread_id` = the outline thread's `id`, for idempotent
upsert. Reorders no longer touch thread anchoring at all. `author_locked` rows are still left alone.

## 4. `reconcile(bookId)` — the projection

Pure diff. Input: `books.outline.nodes` (desired) + the book's `pages` (current, some carrying
`metadata.node_id`). Output: the minimum page CRUD to make the render match the structure.

```
nodeMap = { page.metadata.node_id -> page }   for pages that have one
for each node in outline.nodes (in order, i):
  page = nodeMap[node.id]
  if !page:  page = create_next_page(); stamp metadata.node_id = node.id
  patch:
    title, page_type
    metadata.objective = node.objective         (re-stamp spine_objective edge vs current spine
                                                  → beat/prose go stale iff the objective changed)
    metadata.planned_delta = node.delta
  desired page_index[page] = i
reindex the touched pages to the node order (only the moved rows write)
for each page with a node_id NOT in outline.nodes:
  ARCHIVE (soft — never hard-delete prose the author may want)
threads: upsert book_threads from outline.threads by plan_thread_id; re-anchor setup/payoff_page_id
         via nodeMap; skip author_locked rows
tentpoles: foundations.tentpoles[].placed_page_id = nodeMap[node with that tentpoleId]
set books.outline.compiled_rev = rev
```

Only changed rows write — that's the (b) promise kept for the **whole life of the book**, not just
the first generation. Restructuring a fully-drafted book = edit JSON → reconcile diff, not a rebuild.

Lives client-side in `apps/web/src/lib/outline.ts` (reuses RLS + the live-projection pattern, same as
ScaffoldGenerator today). Types are mirrored into `_shared` for the dev bridge.

## 5. Phases (shipped)

1. **Schema.** `books.outline` jsonb + `book_threads.{setup_node_id,payoff_node_id,plan_thread_id}`
   (migration `20260620120000`, pushed). `pages.metadata.node_id` (jsonb, no migration). ✅
2. **Core primitive.** `lib/outline.ts`: `Outline`/`OutlineNode` types (stable ids),
   `buildOutlineFromProposal`, the pure edits (`withNodePatch/Added/Removed/Moved`, `mutateOutline`),
   and **incremental `reconcile()`** (skips unchanged rows → eager render is one write). ✅
3. **Read-model.** `buildStudioModel` exposes `outline`, `pageByNodeId`, `outlineAhead`; `BuildStudio`
   threads `books.outline` through (live via the existing `books` subscription). `planGraph` is
   unchanged — it reads the *render*, which reconcile keeps faithful. ✅
4. **Editor.** `OutlineStep` is outline-native when `books.outline` exists: inline title/objective edits
   + add/remove chapter/page rewrite the JSON (cheap, no page churn); a "render pages" banner
   (`rev` > `compiled_rev`) runs `reconcile()`. Legacy page-native books fall back to the old render. ✅
5. **AI path (no edge change).** The outline-layer chat (`revise-chat`) still emits a page-id-keyed
   `RevisionPlan`; the **client** `applyProposal` translates it into outline node ops + reconcile
   (`applyOutlinePlan`) for structure-first books and cold starts (no pages yet), so a chat-drafted
   outline is *born* in `books.outline`. Legacy in-progress books (pages, no outline) keep
   `build-revision`, undisturbed. No `_shared`/edge/bridge change → no 4th-mirror work. ✅

### Rollout boundary
A book becomes outline-native the first time something writes `books.outline` — i.e. a chat-drafted
outline on a *fresh* book (no pages). Existing page-native books keep working unchanged until migrated.
`ScaffoldGenerator` (dead in the studio) was also pointed at the outline path as a reference producer.

### Not yet
- Reorder UI in `OutlineStep` (the `withNodeMoved` primitive exists; no drag handle wired).
- Feeding `books.outline` (not the rendered pages) into the outline lens, so the chat sees unrendered
  edits when `outlineAhead`.
- Converging the page-keyed `revise-outline`/`RevisionPlan` book-doctor onto the same node ops.

## 6. Invariants

- **Objective's source of truth is the outline node.** `pages.metadata.objective` is a derived copy;
  never hand-edit it as the authority once a book is outline-native (edit the node, reconcile).
- **Reconcile is non-destructive.** It archives, never hard-deletes; prose survives a restructure.
- **A page with no `node_id` is sovereign.** Reconcile ignores it (legacy books, manual inserts).
- **Pagination is a render decision.** Node order is the only ordering truth; `page_index` is derived.
