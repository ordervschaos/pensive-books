# Multi-resolution outline & the plan↔prose dirty-graph

**Status:** design / build artifact. Phase 1 not yet started.
**Why:** Authors asked to *change the outline* and got a full **prose rebuild** (one screenshot: "9 retargeted, 19 revised, 28 changes · rebuilds prose"). The model has a cheap plan plane and an expensive prose plane but **no wall between them** — one AI operation (`replan-from-notes`, the book-doctor) couples objective edits to prose rewrites. This doc rethinks the outline/objective model so the plan can be reworked cheaply and prose is regenerated only on purpose.

Grounded in `knowledgebase/creation/` — Snowflake ("iterate the cheap layers freely; update the outline rather than forcing prose to obey a stale plan"), Outlining ("errors are caught in the plan, where they're cheap to fix"), Reverse-outlining ("the outline is an x-ray of the prose — two views of one content"), Hybrid drafting ("a deliberate gear change" between planning and writing).

---

## 1. The model: a resolution ladder

A page is a **stack of representations** at increasing resolution; the book is the same idea one level up. Each level is a cheap draft of the one below.

```
BOOK     premise (books.brief) ──▶ act objectives (section pages)
              │                              │
PAGE          └──────────────▶ objective (1 sentence)        L0  cheap · plan
                                     │  generate ▼   ▲ reverse-outline
                                     beat (1 paragraph)        L1  NEW · plan
                                     │  generate ▼   ▲
                                     prose (pages.content)     L2  expensive · draft
                                          │  distill ▼
                                     summary (continuity)      —  existing, prose-derived
```

What already exists in the schema (do **not** rebuild):
- `books.brief` — premise. `books.bible` — established facts.
- `pages.metadata.objective` — one column covers both section (act) and text (page) objectives.
- Paragraph-level objectives — already stored as node attributes **inside `pages.content`**, stripped at serialization.
- `pages.metadata.summary` — already a *downstream* "story so far" auto-summary (prose → summary, continuity for later pages). **Taken; not an authoring layer.**
- `book_threads` — cross-cutting setup→payoff promises spanning pages.

What's new:
- **L1 "beat"** — a one-paragraph expansion of the objective (Snowflake's scene-prototype; Outlining's "paragraph per scene"). A **visible, editable** artifact, not an invisible AI scratchpad.
- **Dirty-tracking provenance** on every derived level. The objective migration explicitly reserved `metadata` headroom for "status/dirty/hash" — so this needs **no schema migration** for L0–L2.

### Three rules (the whole behavior)

1. **Down-flow is on-demand.** `Lk` is generated from `L(k-1)` only when the author presses the button. Editing the plan never spends tokens on prose.
2. **Edits are non-destructive — they mark children stale, not rebuilt.** Change an objective → the beat and prose below carry a "plan moved ahead" badge but keep their content until the author regenerates.
3. **Up-flow exists (reverse-outline).** After hand-editing prose, the author can re-distill objective/beat *from* the prose to re-sync the plan.

---

## 2. The dirty mechanism: content hashes

Each derived level stores `src_hash` = a short stable hash of the **source text it was built from**. A level is **stale** iff `hash(parent_now) ≠ child.src_hash`.

- Editing any level changes its own content → its hash changes → all children become stale automatically. No version counters to bump; robust to concurrent edits.
- Regenerating a level (down-flow): write new content, set `child.src_hash = hash(parent_now)`, stale clears.
- Hand-editing a level: just write content. Its children are now stale (their `src_hash` no longer matches). The level itself is **not** stale relative to its parent unless the parent also moved — i.e. a hand-edited prose page is "ahead", which reverse-outline resolves by re-distilling the plan from it.

This is a **build system / reactive spreadsheet**: a dependency graph where editing a node dirties everything downstream and recompute is on demand.

### Storage shape (`pages.metadata`, JSONB — no migration)

Keep `objective` as a plain string (back-compat). Add sibling provenance + the beat layer:

```jsonc
{
  "objective": "Show a character who believes he IS his labels...",   // L0 (existing)
  "objective_hash": "a91f",          // hash of objective text, recomputed on save

  "beat": "He recites his CV to a stranger on a train...",            // L1 (new, visible/editable)
  "beat_src_hash": "a91f",           // objective_hash the beat was built from → stale if ≠ objective_hash

  "prose_src_hash": "7c2e",          // hash(beat) [or hash(objective) if no beat] prose was built from
                                     //   → prose stale if ≠ current upstream hash
  "summary": "..."                   // L2→ continuity summary (existing, untouched)
}
```

Book→page edge (Phase 3): a `books`-level `brief_hash`; each page records the `brief_hash` its objective was planned under. Out of scope for Phase 1.

> Reader safety: `metadata` is already author-only and omitted from reader SELECTs (RLS gates the row, app omits the column). The new keys inherit that — no reader exposure.

---

## 3. Operations, split by plane

| Operation | Plane | Reads | Writes | Prose? |
|---|---|---|---|---|
| **Revise the outline** (new) | plan (L0) | brief, objectives, threads | objectives, order, add/del | **never** |
| Generate beat (Phase 2) | plan (L1) | objective + context | `metadata.beat` | no |
| Write / render page | prose (L2) | beat ?? objective + context | `pages.content` | yes |
| Revise the draft (book-doctor, existing) | prose (L2) | prose + notes | `pages.content` | yes |
| Reverse-outline (Phase 3) | up-flow | prose | objective/beat | no |

The key fix: **"Revise the outline" is a plan-only operation that cannot emit a prose rewrite.** Today it's routed into the book-doctor; that's the bug.

---

## 4. UI surfaces (decided)

- **Book-level stale panel** — the manage-the-graph surface. "N pages are out of sync with the plan" + a list (which level is stale: beat / prose) + a scoped **"Re-render stale"** action that reuses the hardened cascade machinery but only over dirty pages. This is the home of the plan↔prose relationship.
- **Visible beat layer** — the beat is shown and editable per page (in `PageWorkshop` and/or the outline review), so authors can plan at paragraph resolution before paying for prose. Full Snowflake value.
- **Per-page stale badge** — a quiet "plan moved — prose may be stale" marker on the page, with inline "re-render".

---

## 5. Phasing

Each phase ships independently; later phases add nodes/edges to the same dirty-graph — they don't rework it.

### Phase 1 — Split the planes + dirty-tracking (the shippable fix) — **NO migration**
1. **Provenance plumbing.** On objective save, compute `objective_hash`. On prose write (per-page `generate-page`, the incremental driver, and the bulk cascade `generate-book`), stamp `prose_src_hash = objective_hash`. Helper `metaHash(text)` shared client+edge.
2. **Plan-only "Revise the outline".** A mode of `replan-from-notes` constrained to emit only `retarget | add | delete | reorder | keep` — **no `revise`/prose items**. Its apply path edits objectives + structure and bumps `objective_hash`; pages whose objective changed and that already have prose become stale (their `prose_src_hash` no longer matches). It must **not** call `build-revision`'s prose rebuild.
3. **Staleness read model.** A page is `prose_stale` iff it has prose and `prose_src_hash ≠ objective_hash`. Compute in one place (shared util).
4. **Book-level stale panel** at the outline/write step: count + list + "Re-render stale" (scoped cascade) + dismiss.
5. **Per-page badge** + inline re-render in `PageWorkshop` and the incremental driver.

Phase 1 alone makes "change the outline" return a plan-only diff with zero forced rebuilds — the reported bug is gone.

### Phase 2 — The visible beat layer
- `generate-beat` step (objective → one paragraph); `metadata.beat` + `beat_src_hash`.
- Prose generation reads `beat ?? objective`; `prose_src_hash` now hashes the beat when present.
- Beat shown/edited in `PageWorkshop`; beat carried in the outline review dialog so the plan is paragraph-resolution.
- Stale graph extends: objective→beat→prose (two dirty edges).

### Phase 3 — Full ladder + reverse flow
- Book premise → act (section) → page cascade with `brief_hash` staleness.
- Reverse-outline op: prose → objective/beat to re-sync after hand-edits.
- Threads woven into the dirty-graph (a retarget/delete that orphans a setup→payoff flags the thread).

---

## 6. Risks & notes
- **Hashing must be stable** (trim/normalize whitespace) or pages flap between stale/fresh. Centralize `metaHash`.
- **Back-compat:** existing pages have no `*_hash`. Treat "missing `prose_src_hash`" as **not stale** (don't badge every legacy page); stamp on next write. A one-time backfill is optional, not required.
- **Reuse, don't fork:** the scoped "re-render stale" cascade is the existing `generate-book` path filtered to dirty page ids — not a new engine.
- **The book-doctor stays.** Prose-plane revise (step 6) is unchanged; this work is about giving the plan plane its own, prose-free operations.
