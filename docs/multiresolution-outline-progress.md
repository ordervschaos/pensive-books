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

**Not yet started:** the rest of Phase 1 (the actual user-facing fix), Phase 2, Phase 3.

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

## Phase 2 — Visible beat layer (the middle resolution)
- New `metadata.beat` (string) + `metadata.beat_src_hash` (= `metaHash(objective)` it was built from).
- New `generate-beat` step (objective → one paragraph). Prose generation reads `beat ?? objective`; `prose_src_hash` then hashes the beat when a beat exists (update `stampProse` callers to pass the effective source text, or stamp from beat).
- Beat shown + editable in `PageWorkshop` and carried in the outline review dialog (`ScaffoldGenerator.tsx`) so the plan is paragraph-resolution.
- Dirty graph extends to two edges: objective→beat, beat→prose. Generalize `isProseStale` into a small per-edge check (`isStale(parentText, childSrcHash)`).

## Phase 3 — Full ladder + reverse flow
- Book premise → movement (section pages) → page objective cascade, with a `books`-level `brief_hash`; pages record the brief_hash they were planned under → movement/page objectives go stale when the premise changes.
- Reverse-outline op: prose → objective/beat (re-distill to re-sync after hand-edits to prose). New edge fn or mode.
- Threads woven into the dirty graph (orphaned setup/payoff flagged).

---

## Quick verification of foundations (optional, no API cost)
Write/generate a page, then in SQL/Studio: `select id, metadata->>'prose_src_hash' from pages where book_id = <id>;` — newly written pages should carry a short hex hash; editing the objective afterward should make `isProseStale` true in the UI once Task C lands.
