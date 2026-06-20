# Spec: Pin-driven Build flow

**Goal.** Convert the Build pipeline from "AI drafts a document, author approves it" into "AI proposes candidates, author selects/edits, every author touch becomes a pin that constrains all downstream generation." Add narrative state (deltas) so prose generation receives causality, character state, and open loops as context.

**Design language.** Reuse the existing visual system everywhere: the left Build rail, serif headings, card surfaces, `IN SYNC` badges, the sparkle generate-CTA card, the map dots. Nothing here introduces a new visual vocabulary — only new content inside existing patterns.

---

## 0. Concepts (read first)

- **Pin.** A boolean + timestamp on any authorable record (`pinned: bool`, `author_edited_at`). Set to true whenever the author edits, selects, or explicitly keeps a record. Pinned records are immutable to regeneration: every generation endpoint must include pinned content in the prompt as hard constraints and must never overwrite a pinned record. Fluid (unpinned) records are freely regenerable.
- **Delta.** A page-level diff of narrative state: what changes on this page. Replaces nothing — it extends `page.metadata`. The existing `character_ledger` becomes one delta type among four.
- **State-in.** Never stored. Computed by folding deltas of pages `1..n-1` in reading order. Cache per page, invalidate on any upstream delta change.
- **Lint.** A server-side invariant check producing flags. Author attention goes only to flags + taste; the machine checks structure.

---

## 1. Stage changes

The Build rail keeps 9 steps. Voice is absorbed into a new stage 2.

| # | Old | New | Change |
|---|-----|-----|--------|
| 1 | Brief | Brief | + success criteria field |
| 2 | Spine | **Foundations** | NEW — argument, ending, cast, tentpoles, voice |
| 3 | Outline | **Spine** | now multi-route selection |
| 4 | Voice | **Outline** | + planned deltas, + audit rail |
| 5 | Beats | Beats | + per-page deltas, + lints |
| 6 | Draft | Draft | + taste gate, + state context |
| 7–9 | Read / Revise / Publish | unchanged names | Read gains pin/flag gestures (phase 5) |

Migration: books mid-flight on the old flow map -> not needed, we'll focus on new books

---

## 2. Data model

Additions only. Assumes pages already carry a `metadata` jsonb and books carry top-level jsonb config; adapt naming to existing conventions.

```ts
// book.foundations (new jsonb on book)
{
  argument:  { text: string, pinned: bool, author_edited_at?: ts,
               candidates: [{ id, text, implied_ending: string }] },
  ending:    { text: string, pinned: bool,
               candidates: [{ id, text }] },
  cast: [{
    id, name: string,
    want: string, wound: string, lie: string,
    pinned_fields: string[],            // per-field pinning: ["want","lie"]
    role: "protagonist" | "major" | "minor"
  }],
  tentpoles: [{
    id, text: string,                   // 1–3 sentences, a moment the author sees
    source: "author" | "ai",
    status: "pinned" | "fluid" | "killed",
    placed_page_id?: string             // filled at Outline stage
  }],
  voice_exemplar: { text: string, pinned: bool,
                    candidates: [{ id, text, label: string }] }
}

// book.spine (replaces single spine text)
{
  routes: [{ id, summary: string,       // ~250-500 words
             tentpole_order: string[] }],
  selected_route_id: string,
  text: string, pinned: bool            // selected route's editable text
}

// page.metadata additions (keep existing fields incl. summary)
{
  planned_delta:   Delta[],             // authored at Beats stage, editable
  extracted_delta: Delta[] | null,      // produced after prose exists
  delta_sync: "planned_only" | "in_sync" | "drifted" | "stale",
  lint_flags: [{ rule: string, severity: "warn" | "error", message: string }],
  pinned: bool                          // page-level pin (objective+beat edited)
}

type Delta = {
  type: "character" | "thread" | "value" | "world",
  subject: string,                      // character id, thread id, value name
  from?: string, to: string,            // human-readable state change
  note?: string
}

// book.threads (new array; the promise ledger)
[{ id, question: string,                // "who signs his timesheet?"
   opened_page_id: string,
   planned_payoff_page_id?: string,
   closed_page_id?: string,
   status: "open" | "closed" | "abandoned",
   source: "genre_template" | "ai" | "author", pinned: bool }]
```

**Migration of `character_ledger`:** not needed. we'll focus only on new books.

---

## 3. Per-stage UI spec

### Stage 1 — Brief (minor)
On save, if genre is set, seed `book.threads` from a genre template table (e.g. mystery → "central question", "false suspect", "reveal"; romance → "will-they", "the obstacle"). Seeded threads are `source: "genre_template"`, unpinned, deletable.

### Stage 2 — Foundations (new)
A single stage with five sub-steps shown as a horizontal progress strip (small dots/pills, same style as the rail check circles): **Argument → Ending → Cast → Tentpoles → Voice**. Each sub-step is one focused screen; "skip — use AI default" is always available (generates one candidate, auto-selects, leaves it unpinned).

1. **Argument.** Generate 3 candidate cards from the brief. Card = ~2 sentence claim + one italic line "implied ending: …". Tap to select (card gets the approved treatment: filled check + `APPROVED` label, matching the current Spine screen). Inline-editable; editing sets `pinned`.
2. **Ending.** 2–3 candidates consistent with the selected argument. Same card-select-edit pattern.
3. **Cast.** AI drafts protagonist + up to 2 majors as cards with three labeled lines: *want / wound / lie*. Each line independently editable; an edited line is added to `pinned_fields`. "Add character" creates a blank author card (all fields pinned).
4. **Tentpoles.** Two-panel screen. Left: "Moments you already see" — freeform card input, each saved card is `source: author, status: pinned`. Right: "Proposals" — 6 AI candidate moments, each with **keep** (→ pinned) / **kill** (→ killed, retained as negative signal for regeneration prompts) / **edit** (→ pinned, author text). Require ≥3 non-killed tentpoles to proceed (counting AI fluid ones).
5. **Voice.** Render ONE pinned tentpole moment (~120 words) in 3 distinct voices, side by side, labeled with short descriptors. Tap to select; the selected rendering itself is stored as `voice_exemplar.text`. Editable → pinned.

### Stage 3 — Spine (reworked)
Replace the single drafted paragraph with **2–3 route cards**, generated from: brief + argument + ending + cast + non-killed tentpoles. Each card: ~250-500-word summary + a mini strip showing tentpole order (chips with tentpole short-names). Author picks one → it becomes `spine.text`, editable in the existing approved-spine card UI. "Re-route" regenerates unselected candidates only. Killed tentpoles must not appear; pinned ones must all appear in every route (validate server-side, reject and retry generation if violated).

### Stage 4 — Outline (extended)
Existing chapters/pages-with-objectives view stays. Additions:

- Generation now produces, per page: `objective` + `planned_delta` (initial, coarse) and places tentpoles (`tentpoles[].placed_page_id`). Tentpole pages get a small ◆ marker in the map and list.
- **Audit rail** (right side, collapsible): three compact views, all derived data, no new editing surfaces in v1:
  - *Threads*: each thread as a horizontal span across a page axis (opened → payoff). Open-ended spans render red at the right edge.
  - *Arcs*: per major character, a row of small cells (one per page) colored only where a `character` delta touches them; long gray runs are visible flat stretches.
  - *Flags*: lint results list (see §5), each linking to its page.
- The existing "70% · 13 gaps" indicator is redefined: `gaps = count of error-severity lint flags`, not empty fields.

### Stage 5 — Beats (extended)
Per-page editor keeps Objective + Beat cards. Add a third card, **Δ Delta** ("what this page changes"), rendering `planned_delta` rows with type chips (character / thread / value / world — reuse pill styling). Rows are editable and addable; any edit pins the page. Beat generation must consume: objective, state-in fold, pinned deltas, and emit beat + refined `planned_delta` together in one structured response.

### Stage 6 — Draft (extended)
- **Taste gate.** On entering Draft with zero prose, the primary CTA (the existing sparkle card) becomes: "Render a taste page" — picks the earliest tentpole page, renders only it, then shows a fullscreen-ish review: prose + two buttons, "voice is right — render the rest" / "adjust voice" (returns to Foundations sub-step 5 with the rendered sample as context). Only after approval does batch rendering unlock.
- **Page view state.** Above the Objective card: an "Entering page N" chip row (computed state-in: character chips, open-thread chips, "+k dormant" overflow). Below Prose: the Δ card with `delta_sync` badge (`PLANNED · awaiting prose` / `IN SYNC` / `DRIFTED` / `STALE`).
- **Prose context package** (server-side prompt assembly): voice_exemplar + style rules, objective, beat, planned_delta (as the page's contract), state-in fold, previous page's final ~200 words, relevant thread questions with reveal/withhold flags.
- **Extraction.** After prose generation or any prose edit (debounced), run a cheap extraction producing `extracted_delta`; diff against `planned_delta` → set `delta_sync`. Never modify `planned_delta` from extraction.

### Stages 7–9 — defer
Read gains inline "loved it" (pin span) / "off" (flag span) gestures in phase 5; Revise consumes flags + drift; out of scope for this spec's first pass.

---

## 4. Pinning rules (enforce server-side)

1. Any author write to an authorable record sets `pinned = true`, `author_edited_at = now`.
2. Every generation endpoint receives the pin set relevant to its scope and must (a) include pinned texts verbatim as constraints in the prompt, (b) skip writing to pinned records, (c) for structured outputs, validate post-hoc that pinned items survive (e.g. pinned tentpoles present in every spine route) and retry once on violation.
3. Regenerate actions in the UI show a small lock count when pins exist in scope: "regenerate (3 pinned items held)".
4. Unpinning is explicit: a small "unpin" affordance in each card's overflow menu, with confirm.

---

## 5. Lints (run after Outline and Beats generation; store on pages/book)

| rule | severity | check |
|---|---|---|
| `thread_unclosed` | error | thread opened, no payoff page by book end |
| `thread_stale` | warn | open thread untouched for > N pages (N from pacing/genre) |
| `dead_page` | error | page with empty `planned_delta` |
| `flat_arc` | warn | major character: no `character` delta for > M consecutive pages |
| `tentpole_missing` | error | pinned tentpole with no `placed_page_id` |
| `state_contradiction` | error | delta `from` ≠ folded state-in for that subject |
| `value_static` | warn | page's `value` delta has from == to |

Success criteria from the Brief tune N/M thresholds (start with: thriller N=6 M=8; literary N=14 M=5; defaults N=10 M=8).

---

## 6. Phasing for implementation

1. **Phase 1 — data + migration(if needed).** New jsonb shapes, pin enforcement middleware, state-in fold function + cache.
2. **Phase 2 — Foundations stage.** Five sub-steps, candidate generation endpoints, rail rename, voice absorption + legacy mapping.
3. **Phase 3 — Spine routes + Outline deltas.** Route generation/selection, outline generation emitting deltas + tentpole placement, lints v1 (`thread_unclosed`, `dead_page`, `tentpole_missing`), redefine gaps counter.
4. **Phase 4 — Beats Δ card + Draft state.** Delta editing, state-in chips, prose context package, taste gate, extraction + sync badges.
5. **Phase 5 — Audit rail polish + Read gestures.** Thread spans, arc strips, remaining lints, loved/off marking.

Each phase ships independently; the old flow keeps working until phase 2 lands (feature-flag the new rail).

---

## 7. Out of scope (explicitly)

- Multi-route blending UI (pick-one only in v1).
- Auto-derived Threads/Bible tabs from deltas (keep current tabs; revisit after phase 4 when delta data exists).
- Revision AI changes.
- Dynamic vs static Bible split (static Bible stays as-is for now).

---

## 8. Sequels (continue from a finished book)

**Concept — Canon.** Canon is to a sequel what a pin is to a draft: text generation must honor and may never contradict. Where pins are author gestures inside one book, canon is the *settled outcome of the parent book* — computed once at sequel creation, stored on the sequel, read-only afterwards. No new mechanism: canon rides the same conditional-addendum pattern as `FOUNDATIONS_ADDENDUM`.

### 8.1 Entry

"Continue as sequel" in the book Actions menu (editors only). Creates a new book on the new rail, linked to the parent, pre-seeded as below, then navigates to it. The author lands in the normal Brief → Foundations flow — nothing about the rail changes; the stages are just canon-aware.

### 8.2 Data model

```ts
// books.parent_book_id  bigint FK → books(id), null = not a sequel
// books.canon           jsonb, written ONCE by createSequel(), never regenerated
{
  parent_book_id: number, parent_title: string,
  summary?: string,            // parent spine text — the throughline as actually built
  ending?: string,             // parent foundations.ending.text (how book 1 landed)
  final_state?: Record<DeltaType, Record<string, string>>,
                               // foldStateIn over ALL parent pages — the world as book 1 left it
  character_states?: CharacterState[],
                               // last character_states snapshot from the parent's final prose page
  cast?: CastMember[],         // parent cast (want/wound/lie as book 1 left them)
  resolved_threads?: Array<{ name: string; description?: string }>,  // paid promises
  carried_threads?:  Array<{ name: string; description?: string }>,  // open at parent end — sequel hooks
}
```

Every field is optional: old-flow parents lack foundations, delta-less parents lack `final_state` — canon carries whatever the parent actually has (graceful degradation, no migration of parents).

### 8.3 Seeding (`createSequel`, client-side like `seedGenreThreads`)

1. Read parent (book row, pages metadata, threads); compute the canon packet.
2. Insert the sequel row: `parent_book_id`, `canon`, brief prefilled from the parent (genre / audience / tone — premise left to the author), `foundations` seeded with **only** the parent's `voice_exemplar`, pinned (voice continuity is the default; normal unpin/regenerate is the escape hatch).
3. Copy the parent's open threads into the sequel's `book_threads` as `source: 'carryover'`, `status: 'planned'` (CHECK widened).
4. Nothing else is copied. Argument, ending, cast, tentpoles, spine, pages start empty and are generated fresh *under* canon.

### 8.4 Generation rules (canon enforcement)

1. `canonContext(canon)` renders the packet as a CANON block; every generation endpoint appends it when `books.canon` is set: foundations options, spine routes, outline, beats, prose. Shared renderer in `_shared/canon-core.ts`, mirrored in the bridge.
2. Canon is **constraint, not content**: established facts may not be contradicted; the sequel's argument/ending must be *new*, not a restatement of the parent's.
3. **Cast step under canon:** keep parent characters' names/identities; propose *evolved* want/wound/lie — "where they are now," grown from how book 1 left them (a resolved lie doesn't reappear intact; a paid want leaves a vacuum that implies a new one). New characters welcome.
4. `resolved_threads` act as negative signal (don't re-open as if unpaid); `carried_threads` are hooks the structure should honor or consciously abandon.
5. **State seeding:** within a book, state-in for page n = fold of pages 1..n−1; a sequel extends the axis — its page 1 enters with `canon.final_state`. `foldStateIn` takes an optional seed accumulator (both runtimes).

### 8.5 Lints + scope notes

- Carried threads behave as normal threads; `thread_unclosed` firing on a deliberately series-scoped thread is accepted noise in v1 (a thread-level "series-scoped" marker is future work).
- Out of scope v1: series dashboards, retcon detection against parent prose, canon editing UI, multi-parent canon (trilogies chain pairwise: book 3's canon derives from book 2 only).