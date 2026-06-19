# Story Architecture — Extensions

Companion to `story-building-architecture.md`. Closes the craft gaps in the current
authoring model: flat characters (no history, no per-character voice), no relational
layer, no pinned world/continuity, no POV/scene structure.

Everything here is grounded in the *actual* schema as of 2026-06-19 (not the doc's
description). Ground-truth references are inline as `file:line`.

---

## Where the gaps live today (verified)

| Gap | Current reality | Source |
|---|---|---|
| Character history | `CastMember` = `id,name,want,wound,lie,role,appearance,portraits`. No history. | `_shared/foundations-core.ts:24` + mirror `apps/web/src/lib/foundations.ts:17` |
| Per-character voice | **One** global voice: `books.bible.voice_sample`. Every character held to it. | `generate-unit-core.ts:427` (stablePrefix) |
| Relationships | `CharacterState` is **solo** (name/want/wound/believes/knows/feels/has). No dyads. | `_shared/page-state.ts:15` |
| Reader-knowledge asymmetry | Only character knowledge tracked; no reader-vs-character ledger. | — |
| Setting / world | No pinned artifact. `DeltaType="world"` tracks *changes*; `SceneSpec` is image-only. | `page-state.ts:33`, `sceneSpec.ts:24` |
| Continuity fact ledger | Prose gets rolling summaries + character states, no hard "do-not-contradict" facts. | `generate-unit-core.ts:519` (summary), `:580` (states) |
| Chronology / time | Absent as a field. "time of day" exists only as an image prompt hint. | — |
| POV / tense | Absent as structured data. Mentioned only as prompt instruction text. | `generate-unit-core.ts:360`, `revise-core.ts:36` |
| Scene as a narrative unit | Rendering unit is the **page**. No scene grouping/goal/conflict/present. | — |

Two latent issues to fix opportunistically:

- **`craft_notes` never reaches prose.** It's read only by the revision-chat path
  (`revision-chat.ts:83`), not `generate-unit-core.ts`. Any POV/voice note an author
  writes today is invisible during drafting.
- **Thread-reading divergence.** `beat-core.ts:117` reads the new `book_thread_anchors`;
  `generate-unit-core.buildOpenLoops` (`:310`) still reads the **deprecated flat columns**
  (`setup_page_id`/`payoff_page_id`) that were dropped from `book_threads`. Open loops in
  prose are effectively broken. Fix while we're in this file for continuity work.

---

## Design principles applied

- **Stable creative decisions → `books.foundations` (jsonb), drift-tracked via `fHash`.**
  Mirrors how cast/voice already work. No new tables for these.
- **Mutable per-page runtime state → `pages.metadata` (`PageState`), extracted post-prose.**
  Mirrors `character_states`.
- **Cross-cutting reference / book-level defaults → `books.bible` (jsonb).** Already the
  home of `voice_sample`.
- **New tables only when the data is a growing, independently-queried list with its own
  lifecycle** (the thread-table pattern). Relationships and facts do *not* need this —
  they fit the cast/page-state model. So: **zero new tables across Phase 1.**
- Each foundation addition must be rendered in `settledContext()` (`foundations-core.ts:63`)
  or it is invisible downstream, and added to `foundationsFingerprint()`
  (`foundations.ts:163`) if it should trigger staleness.

---

## Ladder placement (one picture)

```
BRIEF
  ↓
FOUNDATIONS
  argument → ending → CAST(+history/idiolect/tag, +relationships) → WORLD → tentpoles → voice
  ↓                                    └─ F1 ──────────────────┘   └ F2 ┘   └ F3a ┘
SPINE
  ↓
OUTLINE   ── (Phase 2) scenes group pages here
  ↓
BEATS
  ↓
DRAFT (renderProse)
  Part 1 (cached): brief, canon, voice, + CAST VOICES(F1), + WORLD(F3a), + NARRATION/POV(F4a)
  Part 2 (per-page): story-so-far, preceding prose, character states,
                     + RELATIONSHIP states(F2), + ESTABLISHED FACTS(F3b), + STORY TIME(F3c)
  post-prose extraction: summary, character_states,
                     + relationship_states(F2), + facts/deltas(F3b), + time(F3c)
```

---

## Phasing & priority

**Phase 1 — extend existing slots, no new tables (highest leverage / lowest risk):**

1. **F1 — Per-character voice + history** — fixes samey dialogue + generic interiority.
2. **F2 — Relationship layer** — the actual engine of scene drama.
3. **F3 — Continuity: world node + fact ledger + chronology** — the long-form AI safety net.
4. **F4a — POV/narration as data** — cheap, and unblocks `craft_notes`→prose.

**Phase 2 — structural (deferred; reshapes the ladder):**

5. **F4b — Scene as a narrative unit** — page→scene grouping, scene goal/conflict/present.
6. **F2b — Reader-knowledge ledger** — dramatic-irony axis (sits beside character knowledge).

---

# F1 — Per-character voice + history

**Goal:** each cast member carries `history` (formative backstory), `idiolect` (how they
speak), and `tag` (a trackable physical/gesture marker); and these actually reach prose so
dialogue differentiates and interiority gets specific.

**Schema (no migration):** extend `CastMember`.
- `_shared/foundations-core.ts:24` and mirror `apps/web/src/lib/foundations.ts:17`:
  add `history?: string; idiolect?: string; tag?: string;`

**Generation:**
- Cast step system prompt `foundations-core.ts:119` — ask for `history`, `idiolect`, `tag`
  per member; update the JSON schema in the prompt and the normalizer `:198`.

**Make it visible downstream:**
- `settledContext()` cast block `foundations-core.ts:70` — emit `history`/`idiolect`/`tag`
  (so spine/beats see them).
- **Prose payoff (the load-bearing part):** `generate-unit-core.ts`
  - `loadBook()` `:99` currently selects `…,bible,canon,steers` — add `foundations`.
  - Pass cast into `renderProse` args; render a new **CAST VOICES** block in
    `stablePrefix()` (`:421`, Part 1 cached): per member `name — tag; speaks: idiolect; history`.
  - System prompt `:360` — add: "Render each character's dialogue in their idiolect (see
    CAST VOICES); let the POV character's history color word choice and what they notice."

**Plumbing:**
- `sanitizeFoundations()` `revision-chat.ts:178` — pass new fields through like
  `appearance`/`portraits` (so chat edits don't drop them).
- `foundationsFingerprint()` `foundations.ts:169` — add `history`+`idiolect` to the hash
  (they change prose → should flag drift). Leave `tag` out (cosmetic).
- `FoundationsStep.tsx` CastSub editor — add three fields per member.

**Sonnet task breakdown:**
- **F1-a** Types + sanitize + fingerprint + CastSub editor fields (web + edge mirror).
- **F1-b** Cast generation prompt + normalizer.
- **F1-c** Prose path: `loadBook` select, `renderProse` args, CAST VOICES in `stablePrefix`,
  system-prompt dialogue rule. *(Do F1-c after F1-a; it depends on the type.)*

---

# F2 — Relationship layer

**Goal:** model dyads (who A is to B) and track how the charge shifts, then feed both into
beats and prose. Stable definition mirrors cast; mutable charge mirrors character_states.

**Schema (no migration — deliberately not a table):**
- *Stable:* `books.foundations.relationships?: Relationship[]` where
  `Relationship = { id; a: castId; b: castId; bond: string; pinned?: boolean }`
  (e.g. bond = "estranged brothers; A blames B for the fire").
- *Mutable:* extend `PageState` (`page-state.ts:47`) with
  `relationship_states?: { pair: string; charge: string; note?: string }[]`.

**Generation:**
- Extend the **cast** generation to also propose `relationships` (same call, cheap), or
  author-only first. Recommend AI-proposed in the cast step.
- Extend the **post-prose character-state extractor** (`generate-unit-core.ts:580`) to also
  emit updated relationship charges in the same JSON envelope (one call, not two).

**Make it visible:**
- `settledContext()` — render a RELATIONSHIPS block.
- Prose Part 2: render `relationship_states` next to `formatCharacterStates` (`:285`).
- Beats: `beat-core.ts` user prompt — include current relationship charges so value-flips
  can target a specific bond.

**UI:** relationships panel inside `FoundationsStep` CastSub (below the cast list) — keeps
the foundations ladder at its current sub-step count.

**Sonnet task breakdown:**
- **F2-a** Foundations `Relationship` type (2 mirrors) + `settledContext` render + fingerprint
  + CastSub relationships editor.
- **F2-b** `PageState.relationship_states` type + extend the extractor envelope + prose Part 2
  render + selection-of-latest-snapshot (reuse the `priorCharacterStates` pattern `:274`).
- **F2-c** Beats prompt: surface relationship charges. *(After F2-a.)*

---

# F3 — Continuity: world node + fact ledger + chronology

The long-form-AI safety net. Three separable sub-features.

### F3a — World/Setting foundation node

**Schema (no migration):** `books.foundations.world?: { setting?: string; period?: string;
rules?: string[]; pinned?: boolean }`. A pinned, drift-tracked creative artifact.

**Plugs:** new node type in foundations (2 mirrors) → a **World** sub-step in
`FoundationsStep` (or a section in the existing flow) → generated by a new `world` branch in
`foundationsOptions` → rendered in `settledContext()` → added to `foundationsFingerprint()`
→ rendered into prose `stablePrefix()` as a **WORLD** block (cached).

### F3b — Continuity fact ledger ("do not contradict")

Leverage the **existing delta system** (`planned_delta`/`extracted_delta`, `DeltaType="world"`).

**Schema (no migration):** `books.bible.facts?: { fact: string; page_index: number }[]` —
a rolling, consolidated ledger.

**Pipeline:**
- Post-prose: after extraction, fold this page's `extracted_delta` (world/fact deltas) into
  `books.bible.facts` (dedup/append).
- Prose Part 2: render an **ESTABLISHED FACTS (do not contradict)** block from `bible.facts`
  for facts with `page_index < current`.
- **Also fix `buildOpenLoops`** (`:310`) to read `book_thread_anchors` instead of the dropped
  flat columns while we're here.

### F3c — Chronology

**Schema (no migration):** add to `PageState` `time?: { when?: string; elapsed?: string }`.

**Pipeline:** extend the **summarizer** (`:519`, already runs post-prose) to also emit a
story-time stamp → store in `metadata.time` → render a **STORY TIME** line into prose
Part 2 → optional timeline view in the studio.

**Sonnet task breakdown:**
- **F3a** World node end-to-end (type, generation branch, settledContext, fingerprint,
  prose WORLD block, FoundationsStep sub-step).
- **F3b** `bible.facts` fold + prose ESTABLISHED FACTS block + `buildOpenLoops` anchor fix.
- **F3c** `PageState.time` + summarizer envelope extension + prose STORY TIME line.

---

# F4 — POV / narration (Phase 1a) and Scene unit (Phase 2)

### F4a — POV/narration as data (ship in Phase 1)

**Schema (no migration):**
- Book default: `books.bible.narration?: { person?: "first"|"close-third"|"omniscient";
  tense?: "past"|"present"; distance?: string }`.
- Per-page override: `PageState.pov?: string` (POV character name).

**Plugs:** render a **NARRATION** block in prose `stablePrefix()` from `bible.narration`;
render per-page POV into Part 2; system prompt honors them. **Also wire `craft_notes` into
the prose path here** (currently unread by `generate-unit-core`) — pass the relevant
craft note into the prompt so authored POV/voice guidance finally lands during drafting.

**Sonnet task breakdown:**
- **F4a** `bible.narration` + `PageState.pov` types, prose NARRATION/POV blocks, system-prompt
  honoring, `craft_notes`→prose wiring, small book-settings UI for narration defaults.

### F4b — Scene as a narrative unit (Phase 2, deferred — sketch only)

Reshapes the resolution ladder (page is the unit today). Sketch:
- Group pages under a scene: `pages.metadata.scene_id` + `books.foundations.scenes?` or a
  `book_scenes` table (this one *does* fit the thread-table pattern — a growing, queried list).
- Scene = `{ id; goal; conflict; outcome; present: castId[]; staging }` (Swain
  scene/sequel). Outline generates scenes; pages render within a scene; beats/prose read
  scene context (goal + who's present + staging).
- Requires changes to outline generation, the navigator, and the beat/prose context chain —
  hence Phase 2. Decide table-vs-jsonb when we get here.

### F2b — Reader-knowledge ledger (Phase 2, deferred — sketch only)

A second knowledge axis beside character knowledge: what the *reader* knows vs each
character (the dramatic-irony engine). Likely `PageState.reader_knows?: string[]` +
suspense/irony flags surfaced to beats. Defer until F2 lands.

---

## Net schema impact

- **New tables:** 0 in Phase 1 (1 candidate, `book_scenes`, in Phase 2).
- **`CastMember`** += `history, idiolect, tag` (2 mirrors).
- **`Foundations`** += `relationships`, `world` (2 mirrors).
- **`PageState`** += `relationship_states`, `time`, `pov` (2 mirrors).
- **`books.bible`** += `facts`, `narration` (jsonb, no migration).
- **Cross-cutting:** every new foundation field needs `settledContext` render +
  `foundationsFingerprint` decision; every prose-facing field needs a `renderProse` block.

## Definition of done (per feature)

1. Type added in **both** edge + web mirrors.
2. Generated by AI where applicable, and round-trips through `sanitizeFoundations`.
3. Visible in `settledContext` and/or `renderProse` (verified by reading an actual built
   prompt, not just by inspection).
4. Drift handled in `foundationsFingerprint` where it should flag staleness.
5. Editable in the studio UI.
