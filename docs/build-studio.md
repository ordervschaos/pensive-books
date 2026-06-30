# Build Studio — context for any session

The **Build Studio** is the AI-tools build surface of a book: the "AI" tab in `BookDetails`. It's
where an author drives a book from a brief through to a published draft, step by step. This doc is
the fast on-ramp — what it is, how the pieces fit, and where to touch things.

> Replaces the old "step rail bolted above a dense graph" (`JourneyStudio` + `ResolutionMap`, both
> still in the tree but **no longer rendered** — safe to delete). Spec: `docs/ai-build-flow-redesign-brief.md`,
> `-handoff.md`. Prototype palette lived in `apps/web/new_design/`; the shipped version re-themes onto
> the Paper design-system tokens.

## The shape: three panes

One `<section>` split into columns (stacks vertically on mobile). The third column — the **editor
rail** — appears on the four editor steps (foundations / spine / beats / **draft**), and only once that
step has something settled to revise. Every other step keeps the two-column full-width center:

```
┌─────────────────────┬─────────────────────────────┬──────────────────────┐
│  StudioNavigator    │  StudioStage                │  StudioEditorRail    │
│  (left, 320px)      │  (center, fills)            │  (right, ~380px)     │
│                     │                             │  — editor steps only │
│  Build · step N/8   │   ┌ StageHead              │                      │
│   1 Brief      ✓    │   │                         │  ✦ Foundations /     │
│   2 Foundations now │   │  <the step's CONTENT>   │    Spine / Beat       │
│   3 Spine    locked │   │   foundations fields /  │    editor (ReviseChat)│
│   …                 │   │   spine text / beats    │   — OR —             │
│   6 Draft           │   │   carousel / the        │  ✦ Draft → Prose     │
│   ─────────         │   │   manuscript pages      │    editor            │
│   7 Read            │   │                         │   (ProseEditor =     │
│   8 Publish         │   │  ← Phase 2: pending     │    revise-agent)     │
│  The book · map     │   │    diff lands HERE,     │                      │
│   I · Act      │   │    accept/reject here   │  conversation +      │
│     • page  ◷◷◷     │   └ Gate ("Approve…")      │  (Phase 1) diff/plan │
└─────────────────────┴─────────────────────────────┴──────────────────────┘
```

(The standalone **Revise** step was retired — see below. The ladder is 8 steps: Brief → Draft, Read, Publish.)

- **Navigator** (`StudioNavigator.tsx`) = the **sequence** (the step ladder) + the **whole-book map**
  (acts → pages, with obj·beat·prose pips). Click a step → Stage shows that step's tool. Click a
  page → Stage shows that page's resolution ladder.
- **Stage** (`StudioStage.tsx`) = the **depth** / the **content**. Routes on the current selection. Each
  step is dressed in the same editorial chrome (StageHead + Gate) so the eight steps read as one
  progression.
- **Editor rail** (`StudioEditorRail.tsx`) = the **agent**, docked on the right so it works from the
  side while the content holds the center. Two kinds:
  - **planning layers** (foundations / spine / beats) → the unified `ReviseChat` (one model call; the
    whole layer fits in context). The inline editors were pulled out of those step bodies.
  - **Draft** → `ProseEditor` — prose is too large for one shot, so it's the durable **revise-agent**
    (a `book_agent_runs` tool-loop that reads pages on demand): a free-text instruction (or the latest
    editor's read) → reads → may ask the author → proposes a `book_revisions` plan → **Apply** runs
    `build-revision` into the drafts. This subsumes the old standalone Revise step (`ReviseWithAI`) and
    the Read step's inline `EditorAgent` into one place.

  `BuildStudio` gates visibility (an editor step with settled content; draft needs `model.hasWritten`)
  and feeds it `foundations` / `spine.text` / `model`. **Why the side:** it clears the center so a
  pending diff can later land there for accept/reject (Phase 2); for now it renders inside the rail.

All three panes read from **one derived model** (`studioModel.ts`). The sequence, the depth, and the
agent are one truth, not three products.

> **Spine reload note.** The Spine step holds its chosen-spine in local state, so when the rail applies
> a spine revision, `BuildStudio` bumps `editorEpoch` (= `infoKey`) → `StudioStage` → `SpineStep`
> re-reads (skipping while the author is mid-edit). Foundations syncs from its prop automatically; beats
> re-projects through the model.

## The orchestrator: `BuildStudio.tsx`

Mounted in `apps/web/src/pages/books/show/BookDetails.tsx` (AI tab). Owns:

1. **Selection** — `{kind:"step", step}` or `{kind:"page", pageId}`. `null` = follow the model's
   derived `current`. Persisted per-book in `localStorage` (`studio-sel:<bookId>`) so a refresh
   reopens where you were (refresh = no-op principle). Stale selections (archived page, now-locked
   step) get dropped, guarded on data-readiness so a mid-load wipe can't happen.
2. **The derived model** — `useMemo(buildStudioModel, …)`.
3. **The one non-derivable write** — `approve(step)`: stamps `books.journey[step] = now()` and
   advances the selection to the next step. This is the author's deliberate sign-off; the step gates
   are the only place journey is written.

### What the host passes vs. what the studio fetches

The host (`BookDetails`) passes `brief / pages / journey / isPublic` (already in its state). The
studio itself fetches the **three existence flags that can't be cheaply derived from `pages`**, plus
two flow inputs — in one effect keyed on `bookId` + an `infoKey` bump:

| fetched | from | used for |
|---|---|---|
| `spine` {text, stale} | `books.spine` (+ brief-hash compare) | Spine dot, staleness |
| `hasVoice` | `books.bible.voice_sample` | Voice dot |
| `hasRead` | `book_evaluations` status=done | Read dot |
| `foundations` | `books.foundations` | **the flow flag** (see below) |
| `canonParent` | `books.canon.parent_title` | sequel banner |
| `threads` | `book_threads` (+ anchor roles) | new-flow lints |

`foundations === undefined` means "still loading" → the studio renders an empty shell so the rail
doesn't flash old→new. `refresh()` wraps the host's `onChanged` and bumps `infoKey` so any change
anywhere re-reads these flags. Leaf tools also push status up directly via `onVoiceStatus` /
`onReadStatus` / `onSpineStatus` callbacks.

## The model: `studioModel.ts`

`buildStudioModel(input)` is **pure** — host fetches, this computes. It reuses `buildMap`
(`@/lib/planGraph`) for the per-page pip states and the old JourneyStudio gating rules for step
gating.

### Two rails (old vs. new flow)

`newFlow = foundations != null`. The flag is **the presence of any `books.foundations` value** (even
`{}`):

- **OLD** (`BUILD_STEPS`): `brief → spine → outline → voice → beats → draft`
- **NEW** (`NEW_BUILD_STEPS`, `docs/pinned_method.md §1`): `brief → foundations → spine → outline → beats → draft`
  — **Voice is absorbed into Foundations** (sub-step 5).
- **POST_STEPS** (both, unlocked once prose exists, not strictly ordered): `read → publish`
  (the standalone `revise` step was retired — post-draft prose revision lives in the Draft step's
  prose-editor rail; see "three panes").

### Step lifecycle (`StepStatus`)

`locked → active → awaiting → done` (+ `available` for post-steps).

- `active` = it's the current step but its artifact doesn't exist yet ("now" badge, accent).
- `awaiting` = artifact exists, ready for the "Approve & continue" gate ("ready" badge).
- `done` = `journey[step]` is stamped.
- `locked` = a prior step isn't approved yet (build steps), or precondition unmet (post-steps).

`ready[step]` (artifact-exists predicate) drives active-vs-awaiting:
`brief=briefSet, foundations=foundationsComplete(), spine=text exists, outline=hasScaffold,
voice=hasVoice, beats=all beats present, draft=all prose present`.

### Step staleness (upstream drift)

`done` is not forever. A book-level root above a step can change *after* you signed off — and the
step's content no longer reflects it. `staleOf(step)` flags this (a flag, **never a block**): the
Navigator shows an amber dot + "review", the Stage shows a banner + a "Re-approve" gate, and `current`
/ "step N" point at the topmost stale step (`firstStale`) so attention lands where it's needed.

The mechanism generalizes the old `spine.brief_hash` trick to the whole ladder, reusing `metaHash`:

- **Approval stamps a fingerprint, not just a timestamp.** A `journey[step]` entry is now
  `{ at, bHash, fHash, sHash }` (`JourneyStamp`) — the hashes of the three roots (Brief context,
  `foundationsFingerprint`, spine text) at approval time. `rootFingerprints()` computes them
  identically in `BuildStudio.approve` (stamp) and `buildStudioModel` (compare). Legacy bare-string
  entries carry no fingerprint → never stale until re-approved.
- **All-at-once.** Each downstream step depends on a set of roots (`ROOT_DEPS`): foundations←brief;
  spine←brief+foundations; outline/beats/draft←brief+foundations+spine. So a **foundations edit flags
  spine + outline + beats + draft together** (they all carry an `fHash`).
- **Clearing walks top-down.** Re-approving a stale step re-stamps the live roots and clears *its* flag;
  approve advances the selection to the next step, which is the next thing still stale.
- **Foundations itself never flags on its own edits** (its only root is the brief) — matching "the
  foundations changed, but I'm fine with them; it's the stages below that need a look."

Page-level drift (objective→beat→prose) is *not* this — that stays per-page via the edge hashes in
`planProvenance` (the map pips). Staleness here is only the three book-level roots.

`current` = first build step that's active/awaiting; else `read` (if written & unread); else
`publish`; else `draft`. The Navigator's "step N/8" and the default selection come from this.

`dotOf` collapses status into 4 glyphs for the Navigator dot: `done / active / ready / locked`.

### Other derived bits

- `acts` — pages grouped under section headers (Roman-numeral'd); text pages before any section
  go in an implicit "Pages" lead group.
- `counts` {objective, written, beats}, `beatsRemaining`, `proseRemaining`, `hasScaffold`, `hasWritten`.
- `sync` {pct, gaps} — `pct` from map fill; `gaps` = **error-severity lints** on the new flow,
  empty-cells on the old.
- `lints` (`@/lib/lints`, new flow only), `tentpolePageIds` (◆ markers).
- `pageById`, `textIndexOf` (prev/next nav).

## The Stage: per-step routing (`StudioStage.tsx`)

`StepView` switches on the step key. Two integration styles (per the redesign memo):

**Bespoke** step bodies (re-skinned wiring around the real leaf tools), in `studio/steps/`:

| step | file | what it wraps |
|---|---|---|
| Foundations | `FoundationsStep.tsx` | the pin editor (argument/ending/cast/tentpoles/voice). Cast members also get "design the look" (`CastLook`): an appearance line + a **set of portraits** (different angles, via the shared `ImageGenStudio`) reused for scene-image coherence |
| Spine | `SpineStep.tsx` | old: single durable gen; new: 2–3 route cards (`spine_routes`) |
| Outline | `OutlineStep.tsx` | objective scaffolding |
| Beats | `BeatsStep.tsx` | prominent bulk "generate all beats" + a single-beat, revise-in-place page-by-page flow |
| Draft | `DraftStep.tsx` | pilot → continue → all (`write_all`) |
| Voice | `VoiceStep.tsx` | voice sample picker (old flow only — absorbed into Foundations in new) |

**Embedded** (existing components dropped into the new chrome, already DS-consistent):

- Brief → `BookBriefSection`
- Read → `BookEvaluationSection` + a single handoff (`AIActionRow`) that opens the **Draft prose
  editor** with this read. (The old inline `EditorAgent` zone and the standalone Revise step are
  retired — `EditorAgent.tsx` is orphaned; `ReviseWithAI.tsx` survives only because `PageWorkshop`
  still uses it.)
- Publish → `AIActionRow` (publish / unpublish, defers to host `onPublish`)
- Draft's editor rail → `ProseEditor` (the generalized `revise-agent`; see "three panes").

Locked steps show a reason. `awaiting` steps render a `Gate` ("Approve & continue") that calls
`onApprove`.

## The Stage in page mode: `PageReview.tsx`

When a page is selected, the Stage shows that page's **resolution ladder**: Objective → Beat →
**Scene** → Prose, each level readable, editable (autosave on blur), and regenerable in place. Reuses
the same persistence as the map's node sheet (`@/lib/ladder` — `readNode/readProse/saveObjective/saveBeat`,
`ProseNodePanel`, `DurableOptions`, `DurableReviser`). Prose is locked until a beat exists. Has a
muted disclosure for the `CharacterLedgerGraph` (the state axis across pages) and prev/next page nav.

### Scene images (the Scene level — between Beat and Prose)

`SceneLevel` (in `PageReview.tsx`) illustrates the page's scene **with coherent characters**: a
gallery (many images per page). Locked until a beat exists. Click any image for a **full-screen
lightbox** (`ImageLightbox` in `studioUi.tsx` — Esc / click-outside closes). Live-projected over
Realtime (`page_scene_images`, channel per page) so a generation from anywhere lands without a refresh.

**Everything image-shaped is prompt-first and goes through `ImageGenStudio.tsx`** — one shared
component both the Scene level and the portrait step compose:

1. (optional) type **art direction** → it steers the compose,
2. a TEXT model **composes an editable prompt** (`claude.ts` chokepoint, active tier `low`),
3. (optional) attach your own **reference images** (`uploadReferenceImage` → `scene-images/uploads/…`),
4. **generate**, then commit — or skip AI entirely and **upload an image directly**.

`multiSelect` is the only axis of difference: portraits keep a **set** (generate variants / different
angles, add the ones you like, panel stays open); a scene commits **one** image and closes. Hosts pass
the surface-specific `compose` / `render` / `onAdd` / `uploadDirect` and own persistence.

**Scene composition** uses the present cast's descriptions + the recent beats — the **two preceding
beats** (continuity, not depicted) and the **current beat** (the moment to depict). At render,
`generate-scene-image` finds the cast members **named in the beat** and feeds their portraits (up to 2
angles each) + any author references as input images, holding faces consistent.

**Coherence is the manual-portrait model.** Each cast member holds a **set of portraits**
(`books.foundations.cast[].portraits: string[]` — different angles/views, AI-generated or uploaded),
designed in Foundations (`CastSub` → `CastLook`). The **client owns `foundations`** (single writer);
portrait edge calls only produce+store images and return URLs.

**Wiring** (mirrors the `generate-page-audio` media pattern, *not* the durable-task machinery —
synchronous):

| piece | where | does |
|---|---|---|
| `page_scene_images` | migration `20260614120000` | many rows/page; public read, auth write; in `supabase_realtime` |
| `scene-images` bucket | same migration | public; `scenes/<pageId>/…`, `portraits/<bookId>/…`, `uploads/…` |
| `_shared/image.ts` | edge | image chokepoint — `generateImage` / `generateImages` (Gemini 2.5 Flash Image / "nano-banana", accepts ref images) + `uploadDataUrl`. **Provider is OpenRouter today; MuleRouter switch pending** |
| `generate-scene-image` | edge fn | `mode:"prompt"` → composed prompt; `mode:"image"` → render (cast portraits + author refs) + insert row |
| `generate-character-portrait` | edge fn | `mode:"prompt"` → composed portrait prompt; `mode:"image"` → N variant URLs (not pinned) |
| `ImageGenStudio.tsx` | client | the shared prompt-first generator (compose · refs · variants · direct upload) |
| `@/lib/sceneImages.ts` | client | `composeScenePrompt` / `renderSceneImage` / `uploadSceneImage` / `deleteSceneImage` / `composePortraitPrompt` / `renderPortraitVariants` / `uploadReferenceImage` |

## Live run badge: `useActiveStep.ts`

Watches four task tables over Realtime (`useLatestTaskRow`): `book_generations` (mapped by `kind` via
`GEN_STEP`), `book_revisions`, `book_agent_runs`, `book_evaluations`. Returns the `StepKey` of the
newest actively-working run, or `null`. The Navigator marks it "● running". **It does not
auto-navigate** — deliberately a badge, not a view jump; the step row is already clickable.

## Shared UI primitives: `studioUi.tsx`

`Pip` / `Pip3` (cell-state dots), `StepDot`, `StageHead` (eyebrow/title/caption), `Hero` (loud empty
state CTA), `Gate` (the approve button), `RunningCard`, `ProgressMeter`, `DoneStrip`. `studioModel.ts`
also exports `tone` (token bridge: prototype palette → `hsl(var(--pv-…))`) and labels (`STEP_LABEL`,
`STEP_CAPTION`, `STATE_LABEL`).

## Mental model in one paragraph

State is **derived from artifacts**, not stored. The book's pages + a handful of flags flow into one
pure model; the Navigator renders the sequence from it and the Stage renders the depth from it. The
author's *approvals* (`journey`) and the *flow choice* (`foundations` present?) are the only inputs
that aren't computed from the manuscript itself. Every AI action underneath is a durable, resumable
server task (see `docs` + the durable-tasks memory) — the studio is just the chrome around them.

## Author "steer" per step

Each generation step (Foundations, Spine, Outline, Beats, Prose) has a **steer** — a free-text
guidance prompt the author types *before* generating, that shapes that step's output. It is **sticky
per book+step**: saved to `books.steers` (a small jsonb keyed by step), pre-filled on return, reused
for re-generations until changed.

Design (the cheap part): because the steer is DB-backed and every generation path loads the book row
through a shared core, **nothing rides in the generation params** — each core just reads
`books.steers[step]` and appends it to its prompt. One edit per shared core covers serial + bulk +
workshop paths:
- `_shared/steer.ts` — `readSteer(steers, step)` + `steerBlock(guidance)` (the appended prompt block).
- Cores: `spine-core` (spine), `foundations-core` (`foundationsOptions`=foundations, `spineRoutes`=spine),
  `beat-core` `prepareBeat` (beats — covers serial/bulk/objective-to-beat), `generate-unit-core`
  (prose, **write mode only**), `spine-to-objectives` (outline).
- The steer is a strong instruction but **subordinate** to the brief/spine/pins (wording-enforced;
  pin enforcement stays structural).

Client: `@/lib/steer.ts` (`useSteer` hook + `readSteer`/`saveSteer`) and
`studio/SteerField.tsx` (the collapsible input). Each step calls `steer.save()` right before kicking a
run so the background worker reads the fresh value. Wired into `FoundationsStep` (one steer for all
five sub-steps, via a `beforeGen` prop into the subs), `SpineStep`, `ScaffoldGenerator`, `BeatsStep`,
`DraftStep` (bulk prose), and `ProseNodePanel` (single prose, write case). Migration:
`20260613000000_book_steers.sql`.

## Related docs / memory

- `docs/pinned_method.md` — the new pin-driven flow (foundations, routes, lints, gates)
- `docs/sota-story-generation.md` — the master roadmap
- `docs/multiresolution-outline.md` — the plan↔prose resolution ladder
- memory: `project_build_studio_redesign`, `project_pinned_flow`, `project_durable_ai_tasks`,
  `project_sota_roadmap`, `project_multiresolution_outline`, `feedback_refresh_is_noop`
</content>
</invoke>
