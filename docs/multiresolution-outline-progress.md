# Multi-resolution outline — build progress & resume handoff

**Purpose:** paste this (or point me at it) after a context compaction to resume the build correctly.
Companion to the design spec **`docs/multiresolution-outline.md`** (read that first for the model).
Memory pointer: `project_multiresolution_outline` in the auto-memory.

---

## Where we are

**Shipped — Phase 1 foundations** (commit `d9d2a5a` on `main`, `generate-book` edge fn deployed):
the plan↔prose dirty-graph plumbing, no user-visible behavior change yet.

- `apps/web/src/lib/planProvenance.ts` — `metaHash`, `isProseStale`, `stampProse` (client).
- `supabase/functions/_shared/plan-provenance.ts` — `metaHash`, `stampProse` (edge). **Byte-identical `metaHash` to the client copy — keep them in sync.**
- `stampProse(pageId, objective)` wired at all 3 prose-write sites:
  - `supabase/functions/generate-book/index.ts` (`advance()`, after the content update) — bulk cascade.
  - `apps/web/src/components/book/WriteNextPage.tsx` (`writeNext()`) — incremental driver.
  - `apps/web/src/pages/books/pages/view/components/PageContent.tsx` (`handleAppendProse`, `handleApplyRevision`) — per-page workshop apply.
- Effect: every AI prose write now stamps `pages.metadata.prose_src_hash = metaHash(objective)`.

**Shipped — Phase 1 Task A: plan-only "Revise the outline"** (the bug fix). Outline revisions now
change objectives + structure and write NO prose; changed pages are left flagged out-of-sync.
- `replan-from-notes`: `planOnly` body flag → `SYSTEM_PLAN_ONLY` prompt; `parsePlan` collapses any
  `revise`→`keep`, strips `rebuild`, stamps `plan.planOnly`. (deployed)
- `build-revision`: when `plan.planOnly`, skip the summary-drop on retarget and build an EMPTY prose
  task list → the structural phase runs, then the build finishes with no prose written. (deployed)
- `book_revisions.plan_only` column (migration `20260609000000`) — carries the mode so a refresh
  mid-planning re-drives the architect in the right mode (planning is resumable).
- `ReviseWithAI.tsx`: a visible **Outline only / Rewrite prose** `ModeToggle`; the "Revise the
  outline" entry in `BookJourney` preselects outline-only via `prefill.planOnly`. Review dialog,
  buttons, and copy adapt (no "rebuilds prose" line; "Apply outline changes"). Dev `runBuild` mirrors
  the edge gating. `scripts/eval-bridge.mjs` (`runReplan`/`parsePlan`) mirrors the backend.
- Commit: see git log. Verify hands-on: at the outline step, "Revise the outline with AI →" →
  instruction → plan shows only new/retargeted/deleted/kept (0 revised) → Apply → objectives change,
  written pages keep their prose but now read stale (Task B/C will surface the badge).

**Shipped — Phase 1 Task B: book-level stale panel.** `StalePanel.tsx` (mounted in `BookJourney`
step 4) lists pages where `isProseStale(metadata, hasProse)` and offers **Re-render … from the plan**.
- `generate-book` gained a `pageIds` **re-render mode**: targets the named pages (even ones that
  already have prose), and `advance()` bypasses its clobber-guard when `input.rerender` — overwriting
  the prose then re-stamping `prose_src_hash` so the page is back in sync. (deployed)
- New `kind = 'rerender_stale'` (distinct from `write_all` so the "Write all" watcher ignores it).
  Migration `20260609010000` widens the `kind` CHECK and the `revive_stalled_chains` watchdog to
  cover it. Dev mirrors via `rerenderViaBridge`.

**Shipped — Phase 1 Task C: per-page stale badge + inline re-render.** `PageWorkshop.tsx` fetches the
page's `prose_src_hash`, flags "Plan moved — this prose was written from an earlier objective" when
`isProseStale`, and offers **Re-render from the objective →** — which runs the existing revise flow
with a synthetic note (a reviewable diff). Applying re-stamps provenance (host `handleApplyRevision`
→ `stampProse`), and the badge clears optimistically. No edge changes (reuses `generate-page`).

**Phase 1 is complete.** Plan and prose are now separate planes joined by a visible dirty-graph:
outline edits mark prose stale instead of rewriting it, and re-render is offered at book and page
level. **Not yet started:** Phase 2 (visible beat layer), Phase 3 (full ladder + reverse flow).

---

## Invariants — do not break these

1. **`metaHash` must stay byte-identical** in `apps/web/src/lib/planProvenance.ts` and `supabase/functions/_shared/plan-provenance.ts`. Same digest in browser + Deno. It normalizes whitespace (`trim` + collapse runs) so formatting noise doesn't flap staleness.
2. **No schema migration** for Phases 1–2. Everything lives in `pages.metadata` (JSONB; the objective migration reserved headroom for "status/dirty/hash"). Book→page edge in Phase 3 may add a `books` hash.
3. **Legacy-safe staleness:** missing `prose_src_hash` ⇒ **not** stale. Never badge prose we didn't stamp. (`isProseStale` already enforces this.)
4. **`stampProse` reads metadata fresh before writing** — `generate-unit-core` persists a continuity `summary` server-side around prose time; a stale in-memory merge would clobber it. Keep the read-merge-write.
5. **`metadata.summary` is taken** (prose-derived continuity for later pages). The Phase-2 beat layer needs its OWN key (`metadata.beat`), never `summary`.
6. **Plan edits never auto-rewrite prose.** Down-flow (objective→beat→prose) is always an explicit button. Edits only mark children stale.

## Working agreement (this project)
- Commit + push to `main` (user works off main). Small, verified commits.
- Standing authorization to `supabase db push` + `functions deploy` without asking (redeploy modified fns).
- Typecheck (`cd apps/web && npm run typecheck`) + `npx eslint <files>` before committing. For edge, `supabase functions deploy` type-checks the bundle.
- End each task with a `learning_<task>.md` doc; run `afplay /System/Library/Sounds/Ping.aiff` when idle.
- Don't run browser/API-costing generations to "verify" — the user tests hands-on.

---

## Phase 1 remaining (in build order)

### Task A — Plan-only "Revise the outline"  ⟵ THE bug fix (highest value)
**Problem it fixes:** asking to "change the outline" routes into the prose book-doctor and returns a full prose rebuild ("9 retargeted, 19 revised, 28 changes · rebuilds prose"). Plan edits must stay prose-free.

**Backend** — `supabase/functions/replan-from-notes/index.ts` (already accepts `instruction`; plan shape = keep/revise/retarget/add/delete in final order; applied by `build-revision`):
- Add a **plan-only mode** (e.g. body flag `planOnly: true`, or a distinct op). Constrain the model to emit only `retarget | add | delete | reorder | keep` — **forbid `revise` (prose) items**. Update the system prompt + the plan schema/validation to drop prose-revise.
- The apply path must **edit objectives + structure only** and **must NOT call `build-revision`'s prose rebuild**. For any page whose objective changes and that already has prose, leave the prose and let it go stale (its `prose_src_hash` stops matching). Check `supabase/functions/build-revision/index.ts` to branch/skip the prose step in plan-only mode (or write a lean apply that only writes objectives + page add/delete/reorder).
- Threads: a retarget/delete that orphans a setup→payoff anchor should be handled as today (null the anchor) — see existing thread handling in replan.

**Frontend** — `apps/web/src/components/book/ReviseWithAI.tsx` is the existing free-text instruction → plan → review → apply UI (review dialog shown in the screenshot). Today it's one tool. Make the **outline entry plan-only**:
- The "Revise the outline with AI →" button at the outline step lives in `apps/web/src/components/book/BookJourney.tsx` (calls `onRevisePrefill({})` to scroll+focus ReviseWithAI). Carry a signal (e.g. prefill `{ planOnly: true }`, extend `RevisionPrefill`) so the resulting plan call sets `planOnly`.
- In plan-only mode the review dialog should show NO prose-rewrite rows and the apply button should read like "Apply outline changes" (no "rebuilds prose for changed pages" line).
- The full book-doctor (prose revise) stays as-is at step 6 for reworking written prose.

**Verify:** type an instruction at the outline step → plan returns only objective/order changes, 0 prose rewrites; applying changes objectives and leaves written pages intact but now flagged stale (Task B/C surfaces that).

### Task B — Book-level stale panel
- Read model: query the book's pages (id, title, content, metadata); for each, `isProseStale(metadata, hasBodyProse(content))`. Reuse the body-text check (`bodyText` exists in `WriteNextPage.tsx`/`generate-book`).
- UI: a panel at the outline/write step — "N pages out of sync with the plan" + the list + a **"Re-render stale"** action. Re-render = the existing `generate-book` cascade **scoped to the stale page ids** (not a new engine). Simplest: extend `generate-book` kickoff to accept an optional `pageIds` filter for the remaining set; or a thin variant. Confirm approach against `generate-book`'s target-selection block.
- Decided: this book-level panel is the primary "manage the plan↔prose graph" surface (chosen over per-page-only).

### Task C — Per-page stale badge + inline re-render
- In `PageWorkshop` (`apps/web/src/components/book/PageWorkshop.tsx`) and/or the page view: show "plan moved — prose may be stale" when `isProseStale`, with an inline "re-render from objective" that runs the single-page generate (reuse `generate-unit` path like `WriteNextPage.generateOnePage`, then `stampProse`).

---

## Phase 2 — The full ladder + Resolution Map (LOCKED design)

Supersedes the old "visible beat layer / reverse flow" sketch. The book is a **5-layer resolution
ladder**, every layer co-drafted by human + AI, kept honest by a both-endpoint dirty graph:

```
brief → book spine → page objective → beat → prose
```

**Locked decisions** (author, this session):
1. **Map replaces journey** — the Resolution Map (pages × layers completeness grid) becomes the
   primary build surface. Shipped read-only first (alongside the journey); graduates to primary once
   cells are interactive. The linear journey retires then.
2. **Single book spine** — one book-level objective node (`books.spine` jsonb `{text, brief_hash}`)
   between brief and page objectives. brief→spine is the ONE one-way edge (AI drafts down, never up).
3. **Beats required** — every page needs a beat before prose; prose generates from the beat.
   `metadata.beat`.
4. **Build order: model + read-only Map first**, then wire transforms edge by edge.

**Directionality:** below the brief everything is two-way. On drift the **default repair is downward**
(parent rewrites child); **upward is opt-in** (you rewrote prose → "pull it up" re-distills the
beat/objective). Drift is detected per edge by remembering **both endpoints' hashes** at last
reconcile (generalizes Phase 1's parent-only `prose_src_hash`).

**Transformation functions (one per edge, shared core, separate prompts):**

| Edge | Down (expand) | Up (distill) |
|---|---|---|
| brief → spine | `expand-book-spine` | — (one-way) |
| spine ↔ page-obj | `expand-page-objectives` | `distill-book-spine` |
| page-obj ↔ beat | `expand-beat` | `distill-page-objective` |
| beat ↔ prose | `expand-prose` *(today's generate-unit)* | `distill-beat` *(reverse-outline)* |

**Collaboration (the node cell):** every node has the same contract — type it by hand, **expand from
above**, **distill from below**, or **revise** with an instruction; AI proposes into a diff you accept.

### Phase 2 build steps
- **Step 1 — model + read-only Map. ✅ SHIPPED.** `books.spine` migration; `apps/web/src/lib/planGraph.ts`
  read-model (gap/drift/synced per cell, completeness totals); `ResolutionMap.tsx` read-only grid
  (admin-gated for now — "beats required" makes every existing book read incomplete until backfilled).
  Mounted above `BookJourney` in the `ai` tab of `BookDetails`. No transforms yet: spine/beat read as
  gaps; only the prose↔objective edge has drift (reuses `prose_src_hash`).
- **Step 2 — both-endpoint hash model.** Generalize provenance: store `metadata.sync.<edge> = {p,c}`
  at each reconcile; a small `edgeState(parentText, childText, recorded)` powering planGraph for every
  edge (replaces the prose-only check). Backfill semantics: missing hash = synced (don't badge legacy).
- **Step 3 — transforms, edge by edge.** Build each `expand-*`/`distill-*` as its own edge fn (dual
  backend + bridge parity), each stamping both-endpoint hashes. Start with `beat` (page-obj↔beat↔prose),
  since prose-from-beat is the biggest behavior change; `distill-beat` also backfills beats for existing
  books (clears the universal beat-gap).
- **Step 4 — interactive Map + node cell.** Make cells clickable → the node editor (hand / expand /
  distill / revise). "Sync down from here" cascades; per-node "pull up". Then retire the journey.
- **Threads** fold into the dirty graph later (orphaned setup/payoff flagged) — unchanged from before.

### Open design questions deferred to Step 2+
- Canonical hash text for the **brief** (structured jsonb) so spine drift can be detected.
- Whether section pages get their own objective layer or stay pure dividers (currently: dividers).
- Bulk "sync the whole book down" UX + cost guardrails (reuses the durable `generate-book` machinery).

---

## Quick verification of foundations (optional, no API cost)
Write/generate a page, then in SQL/Studio: `select id, metadata->>'prose_src_hash' from pages where book_id = <id>;` — newly written pages should carry a short hex hash; editing the objective afterward should make `isProseStale` true in the UI once Task C lands.
