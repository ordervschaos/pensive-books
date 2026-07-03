# Plan: One-Studio Consolidation — deprecate the vanilla `/dna` studio, the tree is the studio

> **For the executing agent.** Self-contained; read this + the two context docs, then execute
> phase by phase. Decision was ratified by the author 2026-07-03: the vanilla DNA studio
> (`DnaStudio.tsx` shell + its per-layer Foundations/Structure/Scenes editors) is deprecated.
> `/dna/tree` (`DnaTreePage`) becomes the ONE studio surface. Only the **Overview** and the
> sidebar's *job* survive, ported into the tree. **Visuals rehome as scene/character children
> in the tree** (author's explicit instruction), not as a separate mode.

**Context reading (before touching code):**
- `apps/web/src/features/dna/FEATURE.md` — the feature manifest (update it in Phase 4).
- `docs/NORTH_STAR.md` §4 + §6 — one clear job per screen; live projection; nothing speculative.
- Working style: minimum code, touch only what you must, verify end-to-end before done.

**Key files (line counts at plan time):**

| File | Lines | Fate |
|---|---|---|
| `features/dna/components/DnaStudio.tsx` | 981 | DELETE (shell + stage editors) |
| `features/dna/pages/DnaStudioPage.tsx` | 72 | DELETE; its route becomes a redirect |
| `features/dna/components/DnaVisuals.tsx` | 199 | DELETE after contents rehomed |
| `features/dna/components/DnaOverview.tsx` | 265 | KEEP — ported into tree as `overview` tab |
| `DnaStoryMap` / `DnaAnalysis` / `DnaStageDiagram` | 166/155/412 | KEEP — Overview's children (`DnaFullDiagram` is the export Overview uses; the stage-specific `DnaStageDiagram` component loses its only caller — prune if orphaned) |
| `DnaCharacterLook.tsx` (82) / `DnaLookPanel.tsx` (25) / `SceneIllustrationDialog.tsx` (90) | | KEEP — rehomed (Phase 2) |
| `ImagePromptPreview.tsx` | 120 | appears to have NO importers — verify with grep, delete if dead |
| `features/dna/pages/DnaTreePage.tsx` | 2855 | the surviving studio — grows a tab + sub-rows; keep new UI in separate component files, do NOT inflate this file |

---

## Phase 1 — Port Overview into the tree as a third tab

The tree already has a splat-routed tab pair — `tab: "tree" | "taste"` derived from
`location.pathname` in `DnaTreePage` (search `endsWith("/taste")`), with the tab pills rendered
from the array `[["tree","tree",treePath],["taste","voice & feel",...]]`. Extend, don't invent:

1. Add `overview` to the union and pill array → route `/books/:bookSlug/dna/tree/overview`.
   `/dna/tree` (bare) stays the TREE tab — don't change tree muscle memory.
2. When `tab === "overview"`, render `<DnaOverview …/>` as the tab body (same slot as
   `VoiceFeelPanel … asPage`).
3. Wiring `DnaOverview`'s props from what `DnaTreePage` already has (`nodes`, `settings`, `brief`):
   - `stages`/`nowKey`: compute exactly as `DnaStudio.tsx` does today —
     `const { stages, nowIndex } = buildJourney(nodes, mode)`; `nowKey = stages[nowIndex]?.key ?? "premise"`
     (`buildJourney` is in `features/dna/lib/dnaJourney.ts`).
   - `onOpen(stageKey, focusId?)`: navigate to the TREE tab; if `focusId`, call the existing
     `jumpTo(focusId)` (see `goToNode` around the tab logic for the pattern). Without `focusId`,
     jump to the first node whose kind is in `STAGE_KINDS[stageKey]` (exported from `dnaJourney.ts`).
     This replaces the dead "open the vanilla stage editor" behavior.
   - `onChanged`: the tree live-subscribes to `book_nodes` (Realtime, refresh = no-op standard),
     so a no-op is *almost* right — but Overview actions also touch the `books` row. Either add a
     `books` UPDATE subscription mirroring the one deleted with `DnaStudioPage`, or pass a manual
     re-load. Prefer the subscription (live-projection standard).
   - `settings`: `DnaTreePage` already builds `BookSettings` including `mode` — same shape
     Overview reads (`settings.mode === "picture"`).
4. Styling: Overview is built on `studioUi` primitives with the app's light-theme CSS vars; the
   tree overrides theme vars for the AgentRail (see the comment "studio components read theme CSS
   vars" in `DnaTreePage`). Wrap the overview tab body in the same var-override treatment so it
   doesn't render a light island in the dark tree page. Keep this as a new small component file
   (e.g. `features/dna/components/TreeOverviewTab.tsx`), not inline in `DnaTreePage`.

## Phase 2 — Rehome Visuals as node children in the tree

Author's instruction: visuals live **as a scene's children**, not as a separate section/mode.
`DnaVisuals.tsx` currently holds four concerns; each gets a new home:

1. **Scene illustration → a child row of each scene node** (picture mode only,
   `settings.mode === "picture"`). Follow the existing *prose sub-row* pattern — scenes already
   have an expandable prose child (`proseOpenSet` / `toggleProse` in `DnaTreePage`); add an
   `illustration` sub-row the same way:
   - thumbnail from `(scene.content as SceneContent).image_url`; "no image" placeholder otherwise;
   - stale badge via `isIllusStale(scene)` (from `lib/novelDna.ts` — staleness = `illus_src_hash`
     no longer matches the scene plan);
   - caption preview from `content.caption?.text`;
   - click → open the existing `SceneIllustrationDialog` (reuse unchanged: `{node, open, onOpenChange, onChanged}`).
   Port the tile/stale/caption JSX from `DnaVisuals.tsx` lines ~133–184 rather than redesigning.
2. **Character portraits → a child row of each character node** (picture mode only): mount the
   existing `DnaCharacterLook` (`{node, bookId, onChanged}`) as an expandable sub-row under
   `kind === "character"` nodes, same child-row mechanism as (1).
3. **Book-wide house look (`DnaLookPanel`) + output-mode toggle (prose/picture)** — these are
   book-level, not per-scene, so they go on the **Overview tab** (Phase 1) as a small panel:
   port the "output mode" toggle (writes `books.mode`, see `DnaVisuals.tsx` `setMode`) and mount
   `DnaLookPanel` (only in picture mode). Overview already branches on `picture`.
4. Then DELETE `DnaVisuals.tsx`. Note: it imports `type DnaSettings` from `DnaStudio.tsx`; the
   only users of `DnaSettings` are the three doomed files, so the type dies with them — verify
   with `grep -rn "DnaSettings"` before assuming.

## Phase 3 — Sidebar's job + redirect (kill the entry points)

1. The vanilla sidebar's three action links: `edit brief →` already just navigates to the tree
   (the tree edits the brief inline — nothing to port). Port the other two into the tree's top
   bar, next to the existing `json → / studio → / fork →` link cluster (search `studio →` in
   `DnaTreePage`, ~line 2774):
   - `render pages →` = `reconcileDna(bookId)` (from `lib/novelDnaRender.ts`) with the toast
     summary — copy the `render` handler from `DnaStudio.tsx` (~line 168);
   - `read →` = `reconcileDna` then navigate to `/books/${bookSlug}` (the `renderAndRead`
     handler, ~line 171).
2. Replace the route: in `apps/web/src/App.tsx` change
   `<Route path="/books/:bookSlug/dna" element={<DnaStudioPage />} />` to a redirect to
   `/books/:bookSlug/dna/tree/overview` (keep the URL working — it is the studio entry from the
   book editor). Remove the `DnaStudioPage` lazy import.
3. **Permission gate — do not lose it.** `DnaStudioPage` was the surface that enforced
   `useBookPermissions` (`canEdit`, redirect to `/books/:slug` otherwise). `DnaTreePage` has NO
   such gate today (grep confirms). Add the same `useBookPermissions` guard to `DnaTreePage`
   (RLS protects the data, but the page should bounce non-editors like the old studio did).
4. Remove the now-circular `studio →` link in the tree header (it points at the deleted vanilla
   studio). Grep the whole app for other links to `/dna` (non-tree): `grep -rn '"/dna"' apps/web/src`
   and `grep -rn "dna\`" apps/web/src` — fix any button/nav that targeted the vanilla studio
   (e.g. the book editor's Studio entry) to land on the redirect or the tree directly.

## Phase 4 — Cut and document

1. DELETE `DnaStudio.tsx`, `DnaStudioPage.tsx`, `DnaVisuals.tsx` (+ `ImagePromptPreview.tsx` if
   the importer grep confirms it's dead). After deleting, `grep -rn "DnaStudio\|DnaVisuals"` must
   return nothing under `apps/web/src`.
2. If the stage-specific `DnaStageDiagram` component (not `DnaFullDiagram`) is now orphaned,
   prune it from `DnaStageDiagram.tsx`; keep `DnaFullDiagram` (Overview uses it).
3. Update `features/dna/FEATURE.md`: component list (remove deleted, note the tree's three tabs
   overview/tree/taste), routes table (`/books/:slug/dna` = redirect).
4. Do NOT touch edge functions, `lib/` engines, or the AgentRail.

## Acceptance criteria (verify before declaring done)

1. `npx tsc --noEmit` (or the repo's typecheck/build script) passes; no dangling imports.
2. Drive it in the browser (dev server, a real book):
   - `/books/<slug>/dna` redirects to `/books/<slug>/dna/tree/overview`; Overview renders (shape
     panel, story map, next-step card) in the tree's dark chrome, and its links jump into the
     TREE tab at the right node.
   - `render pages →` and `read →` work from the tree top bar.
   - On a **picture-mode** book: scene nodes show an illustration child row (thumbnail/stale/
     caption, dialog opens); character nodes show the portrait row; Overview shows look panel +
     mode toggle. On a **prose** book: none of that renders, tree unchanged.
   - Non-editor account gets bounced from `/dna/tree` (permission gate).
   - Live projection: edit a node in a second tab → Overview/tree update without refresh.
3. Nothing in `apps/web/src` references the deleted files; `/dna/meters`, `/dna/ledger`,
   `/dna.json` routes untouched and still working.

## Commit

Small commits per phase (port → rehome → redirect → cut), message style matching the repo log
(`dna: …`). Do not commit `learning_*.md` or `scripts/.dna-*.json` (gitignored; standing rule).
