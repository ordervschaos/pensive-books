# Picture-book mode

A book-level choice — **prose** or **picture** — that changes only the *last rung* of the
Novel DNA ladder. Everything above the `scene` node (premise, acts, beats, threads, causality,
the whole spine) is mode-agnostic and reused verbatim. In prose mode a scene resolves into ~280
words of prose; in picture mode the *same scene plan* resolves into **one illustrated page**:
a scene image (with character likeness) plus a 1–3 sentence caption.

> Decisions (locked): per-book mode set early in the brief · one image per scene · short caption
> (not full prose, not wordless).

## 1. Why this is mostly reuse

The scene-image system (`lib/sceneSpec.ts`, `lib/sceneImages.ts`,
`generate-scene-image` / `generate-character-portrait`) is already the picture-book primitive:

| Requirement | Existing mechanism |
|---|---|
| Character consistency | `books.foundations.cast[].ref_image_url` portraits, pinned per character |
| Reference portraits → likeness | `renderSceneImage(..., castRefUrls)` conditions the render on them |
| Outfit / appearance per scene | `SceneSubject.{build,clothing,expression,action}` |
| Location per scene | `SceneSpec.setting` |
| Focus per scene | first subject = focal; `SceneSpec.composition` |
| Seeded from the story | `composeSceneSpec(bookId, pageId)` reads beat + cast + house look |
| Durable render → Realtime | `startSceneGeneration`, `page_scene_images` status machine |

So character-once / vary-per-scene is **done**. Picture mode is the wiring that (a) routes the
Draft step into it, (b) adds captions, and (c) renders one image page per scene.

## 2. Schema

- **`books.mode text not null default 'prose'`** — `'prose' | 'picture'`. Chosen in the brief/
  foundations. Gates the Draft step and the render projection.
- **`scene.content.caption?: { text?: string; words?: number }`** — the page's text. The DNA tree
  owns the words (mirrors `scene.content.prose`).
- **`scene.content.image_url?: string | null`** — the *chosen* illustration that renders on the
  page (drives staleness + the projection). The per-scene gallery of candidates lives elsewhere
  (the table below); this is the pick.
- **`node_scene_images` table** — the per-scene **images map**, keyed by `node_id`
  (→ `book_nodes.id`), mirroring `page_scene_images`: `{ id, node_id, book_id, image_url, prompt,
  scene_spec, status('composing'|'generating'|'ready'|'error'), error, created_at }`, Realtime-
  published, `scene-images` bucket. Anchored to the scene's **stable id** — NOT to a page row,
  which `reconcileDna` archives/recreates (a page-keyed image would orphan on every render). One
  scene node → many candidate images; the author/auto-pick writes the winner to
  `scene.content.image_url`.
- **`Authoring.illus_src_hash?: string`** — one hash stamped when the illustrated page (image +
  caption) was generated from the scene plan. Mirrors `prose_src_hash`; drives `isIllusStale`.

`novelDna.ts` gains `isIllusStale(scene)` and `stampIllus(scene)` parallel to the prose pair, and
`renderBlockers` / `isRenderable` branch on `books.mode` (picture mode needs image + caption per
scene; prose mode needs prose, as today).

## 3. Generation — the Draft step in picture mode

`dna-expand` gains a **`caption`** target: like the `prose` target but constrained to 1–3
sentences in the book's voice, seeded from the scene plan (goal/conflict/outcome/value_shift).
**Must be mirrored in `scripts/eval-bridge.mjs`** (the dev bridge) — see [[project_dev_bridge_mirror]].

Per scene, "illustrate" =
1. compose a `SceneSpec` from the **scene node itself** — `present[]` (explicit character ids, no
   name-regex), `loc`, `goal`/`conflict`/`outcome`, value_shift — plus the present cast's pinned
   portraits + house look. (Reuses `sceneSpec` shape + the SPEC_SYSTEM craft; the *context
   gathering* is node-native, not page-native.)
2. render the image into a **`node_scene_images`** row (durable `runInBackground`, conditioned on
   the present characters' portraits for likeness).
3. `dna-expand` target `caption` → the page text.
4. auto-pick the ready image → write `image_url` + `caption` onto the scene node; `stampIllus`.

These are durable background jobs; the studio Draft band shows `illustrated / total`.

### The node-native image path (the seam)

The existing `generate-scene-image` is **page-bound**: it reads `pages.metadata.beat`, walks prior
*pages* for continuity, and regex-matches cast names in the beat text. None of that fits a DNA
scene, which already carries richer, explicit structure (`present[]` ids, loc, the value turn) and
whose *page* is a throwaway projection. So the DNA picture path is **node-native**, not a retrofit:

- a new generation entry (edge fn mode or a sibling fn) takes a **`nodeId`**, gathers context from
  the `book_nodes` tree (the scene + its present characters + prior scenes in reading order for
  continuity), and writes to **`node_scene_images`** (node-keyed) instead of `page_scene_images`.
- the SceneSpec *composer craft* (focal staging, house look, portrait refs) is reused; only the
  input gathering and the target table change.
- `page_scene_images` and the prose/page world are left entirely untouched.

The tree stays the single source of truth: candidates hang off the scene node (the images map),
the chosen one is recorded on `scene.content`, and reconcile reads it (§4).

## 4. Render projection

`renderPages()` branches on `books.mode`:

- **prose** (today): chapter → SECTION page + TEXT page (scenes' prose concatenated).
- **picture**: chapter → SECTION page, then **one IMAGE page per scene** = a TipTap doc with an
  `image` node (`scene.content.image_url`) + a caption paragraph (`scene.content.caption.text`).
  TipTap already supports image nodes (`tiptapHelpers.ts` handles `'image'`; `editorConfig` loads
  the Image extension), so the reader and marketing render need no new page type.

`reconcileDna` is unchanged in shape — it still diff-applies `RenderedPage[]`; only the doc content
per page differs.

## 5. UI

- **The look (style control)**: the picture book's visual style is two dials, both reusing the existing
  image craft (no new render code):
  - **Book-wide house look** — `books.foundations.art_direction` (+ `art_theme` preset + `image_model`),
    set in the studio via `BookLookControls`. Folded into every scene image *and* portrait `STYLE:` line so
    the whole book looks like one book. In the DNA studio it's surfaced by `DnaLookPanel` (picture mode only)
    at the top of **Foundations** (it governs the portraits designed there) and the **Draft** band (before a
    bulk illustrate). Live-projected + saved through the shared `useBookLook` hook (extracted from `SceneTab`).
  - **Per-scene art direction** — `scene.content.art_note`, an "art direction (this scene's look)" field on
    the picture scene card. Rides into *that* scene's image prompt as the author `instruction` (on top of the
    house look) via `illustrateScene` → `startNodeSceneGeneration({ instruction })`. It's an illustration
    INPUT, so it lives inside the illus hash (`isIllusStale`) but is excluded from the prose hash — edit it and
    the scene reads stale → re-illustrate to apply.
- **Brief/foundations**: a prose/picture toggle (`books.mode`).
- **DnaStudio** `EXPAND_TARGETS.scene`: in picture mode the verb is **"illustrate"**
  (`target:"illustrate"`, orchestrating spec→image→caption) instead of "write prose".
- **Scene NodeCard**: in picture mode show the image thumbnail + caption field + a "revise look"
  affordance (the existing scene-spec editor), instead of the prose textarea.
- **Draft band / Overview**: "illustrated N/total"; the staleness badge uses `isIllusStale`.

## 6. Status & follow-ups

**Shipped:** `books.mode` + the engine (`isIllusStale`/`stampIllus`, mode-aware `renderBlockers`,
`renderPages` picture branch) · the `caption` target (edge + bridge) · the node-keyed
`node_scene_images` table + `generate-dna-scene-image` (node-native render, pins `image_url`) ·
`illustrateScene` orchestration · the render projection (image pages) · the studio UI (prose/picture
toggle, per-scene "illustrate" verb + image/caption, "illustrate all scenes", mode-aware
journey/Overview/Draft counts).

**Auto-likeness (shipped):** the consistency anchor no longer depends on the author opening "design the
look". `illustrateScene` reads the LIVE tree, resolves the scene's present cast (`presentCharacters` — the
client mirror of the edge fn's present[]-or-name-match), and `ensurePortraitFor` mints + pins a house-look
portrait for any character that lacks one BEFORE kicking the scene render. The render reads portraits fresh,
so it then feeds them in as `refImages` for likeness. This fixes the "scene 1 anime, scene 2 photoreal" drift:
with no reference image the image model ignores the textual STYLE line and free-renders; with a house-look
portrait ref it both holds identity AND locks the style. A bulk "illustrate all" run reuses a portrait minted
earlier in the (sequential) loop instead of regenerating the character; portrait failure degrades to no-anchor
(returns []) rather than blocking the illustration. NB: nothing ever passes a PRIOR SCENE image as a reference
— `refImages` is strictly the present characters' `portraits[0]`; prior scenes inform only the text continuity beats.

**Consistency layer (shipped):** "design the look" on DNA character nodes —
`generate-dna-character-portrait` (node-native, reuses the shared `characterPortraitPrompts` craft)
renders portrait variants from the character node; the author pins the chosen one(s) onto
`character.content.portraits` via `DnaCharacterLook`. Scene renders feed those in for likeness, and
`generate-dna-scene-image` resolves the present cast from `present[]` or, when empty (AI scenes don't
populate it), by name-matching the cast against the scene plan — so likeness fires either way.
Existing books keep their art: migration now carries `foundations.cast[].portraits` + appearance onto
the character nodes, and `DnaCharacterLook` surfaces a character's legacy portraits (matched by name)
as a one-click "reuse from your book" so books migrated *before* picture mode don't have to re-make them.

**Autopilot picture-awareness (shipped):** `lib/autopilot.ts` reads `books.mode` and switches only the
final rung — picture books run `illustrateScene` (caption + durable node-image render) per scene instead
of writing prose. The loop's draft-rung "done" signal is the **caption** (not `image_url`): `illustrateScene`
writes the caption synchronously then kicks the background render, so the images finish over Realtime after
the loop completes (keying on `image_url` would re-illustrate each scene every tick while it rendered). Mode
is read fresh each driver call, so a mid-build prose↔picture toggle is honored. Works in auto + milestone.

### Out of scope (v1)
- Multiple images / spreads per scene (granularity is one-per-scene; the gallery holds candidates).
- Switching mode mid-book is allowed (the toggle), but a prose↔picture swap re-renders the whole book.
- Per-page hand layout / typography. The image page is image-over-caption.
- Wordless mode (caption is always generated; author can clear it).
