# Picture-book mode — removed (2026-07-03)

> **Why this doc exists:** picture-book mode (`books.mode = "picture"`) was removed from the DNA
> studio. This is not a spec for what existed — it's an inventory for whoever rebuilds the concept
> later as **pictures = a child node type under a scene**, so they know what to reuse, what to
> discard, and what's still sitting in the DB. Cross-reference with `git log` around this commit for
> exact diffs.

## The old model (what's gone)

A book-level toggle (`books.mode: "prose" | "picture"`) that switched the Draft rung's unit from
*written prose* to *one illustration + a short caption per scene*. Prose and picture were mutually
exclusive, book-wide — never both, never per-scene.

- **Scene content**: `image_url` (the pinned illustration), `caption: {text, words}` (page text under
  the image), `art_note` (per-scene art direction on top of the book's house look).
- **Character content**: `portraits: string[]` (pinned reference images for likeness).
- **Authoring**: `illus_src_hash` — the staleness hash for the illustration (mirrors `prose_src_hash`).
- **Book-level "house look"**: `books.foundations.art_direction` / `art_theme` / `image_model` — one
  visual style folded into every illustration/portrait prompt. Author-set via a theme picker
  (`ART_THEMES` in `apps/web/src/lib/foundations.ts` — **kept**, see below) or free text.
- **Generation flow** (two-phase, so the author could review before spending an image call):
  1. `composeSceneIllustration` — write the caption via `dna-expand` (`target: "caption"`), stamp
     `illus_src_hash`, ensure every character present in the scene has a reference portrait
     (`ensurePortraitFor`), then *compose* (not render) the image prompt.
  2. `renderSceneIllustration` — render the composed prompt and pin the result onto
     `scene.content.image_url`.
- **Journey**: the Draft stage's sub-step was `illustrate` instead of `prose`; `dnaJourney.ts`'s
  `sceneDrafted()` checked `image_url` instead of `prose.text`.

## Removed files

| File | Was |
|---|---|
| `apps/web/src/features/dna/components/DnaLookPanel.tsx` | Book-wide house-look picker (theme presets + image-model choice) |
| `apps/web/src/features/dna/components/DnaCharacterLook.tsx` | Character reference-portrait pin/unpin panel |
| `apps/web/src/features/dna/components/SceneIllustrationDialog.tsx` | View-fullscreen / delete dialog for a scene's pinned illustration |
| `apps/web/src/features/dna/lib/characterPortraits.ts` | Client for `generate-dna-character-portrait` (compose/render/pin portraits) |
| `apps/web/src/features/dna/lib/nodeSceneImages.ts` | Client for the `node_scene_images` gallery table + `generate-dna-scene-image` |
| `apps/web/src/hooks/useBookLook.ts` | Hook reading/patching `books.foundations` art fields |
| `apps/web/src/components/book/shared/BookLookControls.tsx` | The theme-preset + image-model UI (used only by `DnaLookPanel`) |
| `supabase/functions/generate-dna-character-portrait/` | Edge fn: node-native portrait generator (deleted from prod too) |
| `supabase/functions/generate-dna-scene-image/` | Edge fn: node-native scene illustrator (deleted from prod too) |
| `docs/picture-book-mode.md` | The original feature spec |

`ImageLightbox` (full-screen viewer) was pruned from `apps/web/src/components/book/shared/studioUi.tsx`
— it had no other caller once `SceneIllustrationDialog` went away.

## Surgically stripped (files kept, mode-branching removed)

- **`apps/web/src/features/dna/lib/novelDna.ts`** (+ edge twin `supabase/functions/_shared/novel-dna.ts`,
  which is byte-parity-locked to the web copy by `novelDna.parity.test.ts`):
  - `SceneContent.caption` / `.image_url` / `.art_note`, `CharacterContent.portraits` — deleted.
  - `Authoring.illus_src_hash` — deleted.
  - `presentCharacters()` — deleted (resolved which characters a scene depicts, for portrait
    consistency; had zero callers left once the illustrate flow was gone).
  - `isIllusStale()` / `stampIllus()` — deleted (mirrors of `isProseStale`/`stampProse`).
  - `renderPages(nodes, mode)` → `renderPages(nodes)` — dropped the `"picture"` branch that emitted
    `kind: "image"` pages; `RenderedPage` no longer has `imageUrl`/`caption`.
  - `BookSettings.mode` — deleted. `renderBlockers()` no longer branches on picture vs prose.
- **`apps/web/src/features/dna/lib/dnaJourney.ts`** (+ edge twin `_shared/dna-journey.ts`): every
  function (`stageComplete`, `buildJourney`, `stageSubsteps`, `nextDraftTarget`, `currentObjective`,
  `stageProgress`, `dnaHealth`) dropped its `mode` parameter. `STEP_RECIPE.illustrate` (the agent's
  "you have no illustration tool, hand off to the author" instruction) deleted.
- **`apps/web/src/features/dna/lib/dnaExpand.ts`**: `composeSceneIllustration` / `renderSceneIllustration`
  deleted (the two-phase flow above — already dead, zero UI callers before this removal even started).
- **`apps/web/src/features/dna/lib/novelDnaRender.ts`**: stopped reading `books.mode`; always renders prose.
- **`apps/web/src/features/dna/lib/migrateToDna.ts`**: dropped the `portraits` carry-over when migrating
  a legacy book's cast into DNA character nodes (kept the `tag`/`appearance` carry-over — unrelated).
- **`apps/web/src/lib/inlineMarkdown.ts`**: `buildImageDoc()` and the `ImageNode` type deleted (built
  the picture-mode page doc: an image node + caption paragraphs).
- **Tree UI** (`DnaTreePage.tsx`, `DnaOverview.tsx`, `TreeOverviewTab.tsx`, `AgentRail.tsx`,
  `DnaStoryMap.tsx`): every `picture` / `settings.mode` branch removed — output-mode toggle, the
  illustration/portrait sub-rows under scene/character nodes, "Illustrate" vs "Write" button copy, the
  "Picture book complete" hero text, the `image_url`-vs-`prose.text` "drafted" tally.
- **Edge**: `book-agent/index.ts` stopped reading `books.mode`; `dna-expand/index.ts` dropped the
  `target === "caption"` branch (and its now-orphaned `buildPrevProseBlock` helper); `scripts/eval-bridge.mjs`
  mirrors both.

## Deliberately kept — don't re-delete these

- **`books.mode` column + `node_scene_images` table** — schema and data left in place, no destructive
  migration. At removal time: **2 books** had `mode='picture'`, **20 rows** in `node_scene_images`,
  **7 scenes** with a pinned `image_url`, **3 characters** with pinned `portraits`. That data is
  dormant (nothing reads it now) but intact — possibly reusable raw material for the rebuild.
- **`apps/web/src/lib/foundations.ts` / `supabase/functions/_shared/foundations-core.ts`** — kept
  `art_direction`/`art_theme`/`image_model`/`ART_THEMES`/`IMAGE_MODEL_OPTIONS`/`portraits` in full.
  These are still read by the **legacy, pre-DNA** page-based image feature (see below) — not dead.
- **The legacy, pre-DNA "design the look" feature** — `supabase/functions/generate-character-portrait`,
  `supabase/functions/generate-scene-image`, `_shared/characterPortraitPrompts.ts`,
  `_shared/sceneImagePrompts.ts`, `_shared/image.ts`, the `page_scene_images` table/migrations. Operates
  on `pages`/`books.foundations.cast`, not `book_nodes`/DNA. Out of scope for this removal (the user
  asked to remove *DNA's* picture mode specifically). Note: at inventory time this legacy feature
  appeared to have **no web caller** — possibly already-orphaned code worth a separate look.

## Tests updated

`novelDna.test.ts` — removed the picture-mode `renderPages` case and the `isIllusStale`/`stampIllus`
staleness tests, and the whole `presentCharacters` describe block.
`novelDna.parity.test.ts` — dropped the `mode` fixture loop (was `for (const mode of ["prose",
"picture"])`), now runs each `dna-journey` parity case once.

## If you rebuild "pictures as a scene child node"

Things from this removal that are probably still the right shape to reuse:
- The **house-look concept** (`art_direction`/`art_theme`) — book-wide style folding into every
  generated image prompt. Still alive in `foundations.ts`, just not wired to DNA.
- `_shared/sceneImagePrompts.ts` / `_shared/characterPortraitPrompts.ts` — the actual prompt-craft
  (focal staging, labelled-line contract) is reusable; only the context-gathering (page vs DNA node)
  needs rewriting for a node-child shape.
- `node_scene_images` (still in the DB) as a candidate-gallery table pattern — was node-keyed already,
  which fits a child-node model better than the legacy page-keyed one.

Things that were an awkward fit and probably shouldn't come back as-is:
- The **book-wide mode toggle** — mutually-exclusive prose-vs-picture at the book level doesn't fit
  "pictures as a child of some scenes." A per-scene or per-node presence check is the better primitive.
- The **two-phase compose/render split** (`composeSceneIllustration`/`renderSceneIllustration`) was
  already dead code with zero UI callers before this removal — the UI never actually wired up the
  review step it was designed for. Worth designing fresh rather than resurrecting.
