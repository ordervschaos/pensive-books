# Build Studio — context for any session

The **Build Studio** is the AI-tools build surface of a book: the "AI" tab in `BookDetails`. It's
where an author drives a book from a brief through to a published draft, step by step. This doc is
the fast on-ramp — what it is, how the pieces fit, and where to touch things.

> Replaces the old "step rail bolted above a dense graph" (`JourneyStudio` + `ResolutionMap`, both
> still in the tree but **no longer rendered** — safe to delete). Spec: `docs/ai-build-flow-redesign-brief.md`,
> `-handoff.md`. Prototype palette lived in `apps/web/new_design/`; the shipped version re-themes onto
> the Paper design-system tokens.

## The shape: two panes

One `<section>` split into two columns (stacks vertically on mobile):

```
┌─────────────────────┬───────────────────────────────────────┐
│  StudioNavigator    │  StudioStage                          │
│  (left, 320px)      │  (right, fills)                       │
│                     │                                       │
│  Build · step N/9   │   ┌ StageHead (eyebrow/title/caption)│
│   1 Brief      ✓    │   │                                   │
│   2 Foundations now │   │  <the selected step's tool>       │
│   3 Spine    locked │   │    or                             │
│   …                 │   │  <a page's resolution ladder>     │
│   ─────────         │   │                                   │
│   7 Read            │   └ Gate ("Approve & continue")       │
│   8 Revise          │                                       │
│   9 Publish         │                                       │
│                     │                                       │
│  The book · map     │                                       │
│   I · Movement      │                                       │
│     • page  ◷◷◷     │                                       │
│     • page  ●●●     │                                       │
└─────────────────────┴───────────────────────────────────────┘
```

- **Navigator** (`StudioNavigator.tsx`) = the **sequence** (the step ladder) + the **whole-book map**
  (movements → pages, with obj·beat·prose pips). Click a step → Stage shows that step's tool. Click a
  page → Stage shows that page's resolution ladder.
- **Stage** (`StudioStage.tsx`) = the **depth**. Routes on the current selection. Each step is dressed
  in the same editorial chrome (StageHead + Gate) so the nine steps read as one progression.

Both panes read from **one derived model** (`studioModel.ts`). The sequence and the depth are one
truth, not two products.

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
- **POST_STEPS** (both, unlocked once prose exists, not strictly ordered): `read → revise → publish`

### Step lifecycle (`StepStatus`)

`locked → active → awaiting → done` (+ `available` for post-steps).

- `active` = it's the current step but its artifact doesn't exist yet ("now" badge, accent).
- `awaiting` = artifact exists, ready for the "Approve & continue" gate ("ready" badge).
- `done` = `journey[step]` is stamped.
- `locked` = a prior step isn't approved yet (build steps), or precondition unmet (post-steps).

`ready[step]` (artifact-exists predicate) drives active-vs-awaiting:
`brief=briefSet, foundations=foundationsComplete(), spine=text exists, outline=hasScaffold,
voice=hasVoice, beats=all beats present, draft=all prose present`.

`current` = first build step that's active/awaiting; else `read` (if written & unread); else
`publish`; else `draft`. The Navigator's "step N/9" and the default selection come from this.

`dotOf` collapses status into 4 glyphs for the Navigator dot: `done / active / ready / locked`.

### Other derived bits

- `movements` — pages grouped under section headers (Roman-numeral'd); text pages before any section
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
- Read → `BookEvaluationSection` + the "Address the notes · two ways" zone:
  `EditorAgent` (collaborative — asks the author, proposes a reviewable plan) **and** `AutoRevise`
  (unattended one-pass fix of critical/major issues). The agent's plan lands on the Revise step.
- Revise → `ReviseWithAI` (consumes the `revisionPrefill` set by per-note "Revise this" clicks on Read)
- Publish → `AIActionRow` (publish / unpublish, defers to host `onPublish`)

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
