# Learning — structure-as-render (outline decoupled from pages)

Named concepts encountered, where they showed up.

- **Virtual DOM / reconciliation** — "virtual DOM" = an in-memory tree you edit cheaply; "reconcile" = diff it against the real tree and apply only the differences.
  - `books.outline` (cheap JSON) is the virtual DOM; `pages` rows are the real DOM; `reconcile()` is the diff. This is the whole architecture.
- **Materialized copy / read model** — keep a derived duplicate of data where readers already look, so they don't have to change.
  - `pages.metadata.objective` stays a *copy* of the node's objective → the entire render pipeline (`planGraph`, beat/prose) reads pages unchanged. Kept the blast radius tiny.
- **Single source of truth** — exactly one authoritative home for a fact.
  - The outline node owns the objective; the page's copy is derived, never hand-authored as authority.
- **Projection** — a one-way function from a source model to a view/render.
  - `reconcile` projects outline → pages. Pagination (`page_index`) is a projection-time decision, not a planning one.
- **Lazy vs eager evaluation** — compute on demand vs immediately.
  - Outline edits are *lazy*: they rewrite JSON only; pages re-render on a deliberate "render pages" action (gated by `rev > compiled_rev`). The old flow was *eager* (every edit churned pages).
- **Stable identity (surrogate id)** — a key that survives reorder, unlike an array index.
  - Nodes get `n_…` ids; thread/tentpole anchors point at node ids, so reordering is free. The old scaffold anchored by array index and needed `remap()`.
- **Content hash / dirty graph** — hash a parent's text; a child is "stale" when the recorded hash ≠ the parent's current hash.
  - `cyrb53`/`metaHash` + `stampEdge(spine_objective)`: changing a node's objective on reconcile re-stamps the edge → that page's beat/prose correctly light up stale.
- **Incremental computation / change detection** — only do work for what changed.
  - reconcile compares a `metaSig` per page and skips unchanged rows, so eager-reconcile-after-edit touches one row.
- **Idempotent upsert** — apply the same operation repeatedly with the same result, keyed on a stable id.
  - Threads reconcile by `plan_thread_id`; tentpoles re-point `placed_page_id`. Re-running reconcile is safe.
- **Optimistic concurrency via read-modify-write** — read fresh, apply, write, so two near-simultaneous edits don't clobber.
  - `mutateOutline(bookId, fn)` reads the current outline before patching, instead of writing a stale snapshot.
- **Soft delete (tombstone)** — mark removed, don't destroy.
  - reconcile *archives* pages whose node left the outline (`archived: true`), never hard-deletes prose.
- **Monotonic revision counter** — an ever-increasing version number.
  - `outline.rev` bumps on every save; `compiled_rev` records the last reconcile → `outlineAhead` = "pages need a render".
- **Adapter / translation layer** — convert one contract into another at a boundary.
  - `applyOutlinePlan` translates the chat's page-id-keyed `RevisionPlan` into node ops, so Phase B needed **no** edge/bridge change.
- **Fiction-outlining methods** (research): corkboard/index cards (Scrivener), beat sheets (Save the Cat / Hero's Journey), Snowflake (progressive expansion), grid/spreadsheet outline — all treat the **scene/beat** as the unit and **pagination as downstream**. Directly validated decoupling the planning unit (node) from the physical unit (page).
- **Gradual rollout / strangler boundary** — new path coexists with the old; cut over per-entity.
  - A book becomes outline-native only once `books.outline` is written; legacy page-native books keep `build-revision` untouched.
