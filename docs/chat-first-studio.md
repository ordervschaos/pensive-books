# Chat-first Studio — implementation plan

> **Supersedes `docs/unify-proposal-pattern.md`** (the center "proposal-tray" approach). That earlier
> direction put generation/options UI in the center Stage; we've pivoted: generation lives in the
> right-rail chat, the center is a near-manual editor. The proposal-tray exploration is preserved on a
> branch but its code is **not** the baseline for this plan.

## 1. The model (Cursor, for a book)

Three panes, with sharpened roles:

```
┌──────────────┬──────────────────────────────┬──────────────────────────┐
│ Navigator    │  STAGE = the editor           │  RAIL = the agent (chat) │
│ (steps+map)  │  near-manual: create/edit/    │  ReviseChat — generates, │
│              │  delete the one true field(s) │  revises, SHOWS OPTIONS  │
│              │  • foundations fields         │  inline. Always on.      │
│              │  • spine text                 │                          │
│              │  • outline: pages/chapters    │  proposal → diff →       │
│              │  • beat sheet                 │  Apply (existing paths)  │
│              │  (later: diff vs last-saved)  │                          │
│              │  empty → a button that points │                          │
│              │  into the chat ──────────────▶│                          │
└──────────────┴──────────────────────────────┴──────────────────────────┘
```

- **Rail (`ReviseChat`) = the agent.** Like Cursor's chat. You converse to generate and revise the
  center content; **options surface in the chat**, you pick there. One chat per (book, layer). Always
  visible for the editor steps — you can start from an empty center.
- **Center (Stage) = a near-manual editor.** Shows the one true field(s) and makes **almost
  everything editable by hand** — create / edit / delete (delete only where there are N items). A
  manual writer never has to touch the chat. At most a button or two that point into the chat. **No
  generation controls, no options cards, no steer field** in the center.
- **Diff vs last-saved (later).** The center will show what changed since the last saved version, so
  agent edits are legible and revertible. Phase 2 — see §4F.

This is the unification: **one AI surface (the chat) across foundations / spine / beats / outline**,
and every center is the same kind of thing — a plain editor.

## 2. What already exists (build on it)

- **`ReviseChat.tsx`** — the chat-first surface, today scoped to *revision*. Has: the `revision_chats`
  thread (one row per book+layer, edge fn `revise-chat` is sole writer), a layer-tagged
  `pending_proposal` envelope, per-layer **diff views** (`SpineDiff`, `FoundationsDiff` incl.
  cast/tentpole, `BeatDiff`), quick-action chips, and `Apply` → `applyProposal`.
- **`lib/revisionChat.ts`** — `RevisionLayer = "foundations" | "spine" | "beats"`, `RevisionProposal`
  envelope, `sendRevisionMessage`, `applyProposal` (routes to each layer's existing write path so
  provenance/staleness stamping is unchanged), `clearPendingProposal`.
- **`StudioEditorRail.tsx`** — routes foundations/spine/beats → `ReviseChat`, draft → `ProseEditor`.
- **`BuildStudio.tsx`** — owns rail **gating** (`showRail = railStep && railReady`, where `railReady`
  needs settled content), the 3-pane resizable layout, `approve()` (journey + root fingerprints), and
  the per-book selection.
- **Edge:** `supabase/functions/revise-chat/` + `_shared/revision-chat.ts` (the chat model + the
  proposal envelope; mirror of `lib/revisionChat.ts`).
- **Steer (to be removed):** `lib/steer.ts` (`useSteer`, `books.steers`), `studio/SteerField.tsx`,
  and edge cores reading `books.steers[step]` via `_shared/steer.ts`.

So the chat-first machinery is ~80% there for *revision*. The net-new is **generation in the chat**,
**options in the chat**, **outline as a layer**, and the **center-as-editor** rework + **steer removal**.

## 3. Target pane responsibilities (per step)

| Step | Center (manual editor) | Rail (ReviseChat layer) |
|---|---|---|
| Foundations | edit argument/ending/voice text; cast: add/edit/delete members + want/wound/lie + portraits (`CastLook`); tentpoles: add/edit/delete | `foundations` — generate from empty, revise, options |
| Spine | one editable spine textarea | `spine` |
| Outline | add/delete pages & chapters, edit chapter names, page titles, objectives; "open page →" to PageReview | `outline` (NEW) |
| Beats | the beat sheet: edit each beat in place (the existing accordion editor) | `beats` |
| Draft | (unchanged) prose pages | `ProseEditor` (unchanged) |

Brief / Read / Publish: unchanged.

## 4. Workstreams

### A. Rail always-on
`BuildStudio.tsx`: drop the `railReady` settled-content gate for the editor steps; the rail shows
whenever the selected step is foundations/spine/beats/outline/draft. Keep the resizable 3-pane layout.
Add `outline` to `railStep`. (Draft keeps `ProseEditor`.) The empty center + live chat is now the
intended first-run state.

### B. `ReviseChat`: generation-from-empty + options-in-chat
1. **Generate from empty.** When the layer has no content, the chat's purpose is to *create* it. The
   `pending_proposal` envelope already represents a full-content patch (foundations: all fields; spine:
   text; beats: a `RevisionPlan` of adds), so the **client needs little change** — the work is in the
   edge `revise-chat` prompt: detect an empty/near-empty layer and generate a complete first draft
   instead of a diff-style revision. Empty-state **chips** change from "Summarize/Pressure-test" to
   "Generate the foundations" / "Draft the spine" / etc. (drive off whether the layer has content).
2. **Options in the chat.** Extend the envelope to optionally carry **several** candidates:
   `pending_options?: RevisionProposal[]` (or `pending_proposal.options`). Render them inline in the
   chat as pickable cards (reuse the per-layer diff components for each). Picking one promotes it to
   the single `pending_proposal` (then the existing diff + Apply path runs). v1 may keep it simple:
   the assistant lists 2–3 directions as text and the author replies to pick — **confirm richness in
   §8**. Either way "options show up in the chat," never the center.
3. Touch: `ReviseChat.tsx`, `lib/revisionChat.ts`, `supabase/functions/revise-chat/*`,
   `_shared/revision-chat.ts`. Keep the client/edge type mirror in sync.

### C. Outline as a chat layer
- `lib/revisionChat.ts`: add `"outline"` to `RevisionLayer`; add an outline patch. **Reuse the beats
  `RevisionPlan`** (it already models add/delete/retarget/reorder of pages + chapters) but scoped to
  **objectives** (no `beat` field) — i.e. the outline chat plans the page/chapter structure +
  objectives; `applyProposal` routes it through the scaffold/objective write paths
  (`saveObjective`, the scaffold create/delete). Reuse `BeatDiff`'s add/delete/retarget/move rendering.
- `ReviseChat.tsx`: add an `outline` entry to `LAYER_UI` (title "Outline editor", generate/structure
  chips).
- `StudioEditorRail.tsx`: route `outline` → `ReviseChat layer="outline"`.
- Edge `revise-chat`: handle the `outline` layer (generate/revise the scaffold + objectives). This is
  the bulk of the net-new edge work; reuse `spine-to-objectives` / scaffold logic.

### D. Centers → manual editors (strip generation; make editable)
For each, **remove**: `ProposeRow`/options/skip/hero-generate, `DurableOptions`, `DurableReviser`
(revision now lives in the chat), the `steer`/`beforeGen` props, and the agent's center proposal-tray
code. **Keep/Add**: plain inline editing with autosave-on-blur, and add/delete affordances.

- **`FoundationsStep.tsx`** — argument/ending/voice as editable textareas (save → `pinNode` + write);
  cast: editable rows with add/delete + keep `CastLook` (portraits); tentpoles: editable list with
  add/delete. Drop the sub-step "options/skip" generation entirely. The Foundations sub-step progress
  strip can stay as navigation.
- **`SpineStep.tsx`** — a single editable spine textarea (save on blur). Empty → a chat-pointer
  button. (Remove the proposal tray / `pendingProposal` / routes-picker.)
- **`OutlineStep.tsx`** — the page/chapter list, fully editable: add page, add chapter (section
  header), delete page/chapter, edit chapter name, page title, objective inline. Keep "open page →"
  (PageReview) and the lints banner. Remove `ScaffoldGenerator`-as-the-only-path and per-page
  `DurableOptions`/`DurableReviser` (generation → chat).
- **`BeatsStep.tsx` / `BeatSheet.tsx`** — keep the whole-sheet accordion **edit** of each beat; remove
  the bulk "generate all beats" Hero+steer and the page-by-page propose flow from the center
  (generation → chat). (The bulk generate-book pipeline itself stays available, but it's not a center
  control here — confirm in §8 whether bulk generate stays as a button or moves entirely to chat.)
- **Empty-state pointers:** when a center has no content, show a calm line + a button like
  *"Generate in the editor →"* that focuses the rail chat (and optionally pre-sends a generate
  message). Add a tiny mechanism for the center to nudge the rail (e.g. a `focusRail()`/`prompt`
  callback threaded from `BuildStudio`).

### E. Remove steer
- **Client (do first; self-contained):** delete `studio/SteerField.tsx` and `lib/steer.ts`; remove
  `useSteer`, the `steer`/`beforeGen` props, and every `beforeGen()`/`steer.save()` call from
  `StudioStage`, `FoundationsStep`, `SpineStep`, `OutlineStep`/`ScaffoldGenerator`, `BeatsStep`,
  `ProseNodePanel`, `DraftStep`. (Generation guidance now happens by talking to the chat.)
- **Edge (phase, low-risk):** the cores reading `books.steers[step]` via `_shared/steer.ts` become
  no-ops once nothing writes the column — safe to leave initially. Follow-up: strip `_shared/steer.ts`
  usage from `spine-core` / `foundations-core` / `beat-core` / `generate-unit-core` /
  `spine-to-objectives`, then drop the `books.steers` column in a migration. **Don't block the client
  work on the edge cleanup.**

### F. Diff vs last-saved in the center (PHASE 2 — later)
The center shows what changed since the last *saved version*, so agent edits (applied from the chat)
are legible and revertible by a manual writer. Two candidate sources to reconcile:
- the chat **Apply already "saves a version first"** (see `ReviseChat` applyNote) — find where that
  versioning lives (likely `book_revisions` / a versions row) and surface it; **or**
- a client snapshot history.

Decide the source when we get here. **Out of scope for phase 1** beyond not painting ourselves into a
corner (keep `applyProposal`'s existing version-on-apply behavior intact).

### G. Cleanup (the obsoleted proposal-tray work)
Revert/remove the center proposal-tray artifacts from the superseded plan:
- delete `studio/proposals.tsx` and (if unused after) `lib/proposals.ts`;
- drop the `proposals` sidecars added to `FNode` / `SpineNode` / `PageMeta`
  (`*_proposals`) and the `lib/ladder.ts` tray helpers — **options live in the chat, not on the node**;
- `DurableOptions.tsx` / `DurableReviser.tsx`: remove from studio centers; delete `DurableOptions` if
  no callers remain (check `PageWorkshop`); `DurableReviser` may survive only in non-studio callers.

> The node keeps just its **canonical** value (+ whatever versioning §4F lands on). The context
> firewall becomes trivial: there's no tray to leak.

## 5. Sequencing
1. **Spine first** (smallest center): rail always-on for spine → chat generates spine from empty →
   center becomes a plain spine editor → remove spine steer. Prove the whole loop end-to-end.
2. **Foundations** (richest center editor + options-in-chat).
3. **Beats** (center = sheet editor; chat already does beats).
4. **Outline** (net-new layer — most edge work).
5. **Steer removal** (client) can land alongside step 1; edge cleanup as a follow-up.
6. **Cleanup (§G)** as each center is reworked.
7. **Diff-vs-saved (§F)** last, separately.

Run `cd apps/web && pnpm run typecheck` after each step; keep it green. Don't commit/push unless asked.

## 6. Success criteria
1. For foundations/spine/beats/outline: the rail chat is always visible; you can **generate the
   content from an empty center** by talking to it; **options appear in the chat**; Apply writes
   through the existing layer paths (staleness/journey unchanged).
2. Every center is hand-editable: create/edit, and delete where there are N items (cast, tentpoles,
   outline pages/chapters). A manual writer can build a book without opening the chat.
3. No steer field anywhere; no center "propose/options/skip" UI; no proposal-tray code.
4. Typecheck + lint clean; the eight-step ladder, approve gates, lints, and the map still work.
5. (Phase 2) the center shows a diff vs the last saved version.

## 7. Now vs delegated
- **Committed now (clear):** this plan.
- **Delegated to Sonnet (possible now):** workstreams A, D, E-client, and G for **spine first** (the
  proving slice), then foundations/beats. The edge-heavy parts (B generation/options, C outline layer)
  may need a tighter spec / iteration — sequence them after the spine loop is proven.

## 8. Open decisions
1. **Options-in-chat richness:** structured pickable option cards in the chat (envelope carries an
   array) vs. conversational "here are 3, which?" for v1. Recommendation: start conversational + a
   single pending proposal; add structured option cards as a fast-follow.
2. **Bulk "generate all beats / write all prose":** keep as a center button, or move entirely into the
   chat? Recommendation: keep the bulk build pipeline reachable (it's a different gesture than
   per-layer chat), but not as a "propose" control — a plain "build the draft" action.
3. **Steer edge removal timing:** leave cores reading an empty `books.steers` (no-op) for phase 1, or
   strip immediately? Recommendation: leave for phase 1.
4. **Diff-vs-saved source (§4F):** existing apply-time versioning vs client snapshots. Decide at phase 2.
