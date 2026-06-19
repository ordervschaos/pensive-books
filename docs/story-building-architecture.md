# Story Building Architecture

How the studio builds a book — from first intent to finished prose — purely from a story-craft perspective.

---

## The Resolution Ladder

Every page holds three stacked slots. They fill in order; you can't skip a rung.

```
OBJECTIVE  →  BEAT  →  PROSE
"what this page must achieve"  →  "the concrete plan for how"  →  "the actual words"
```

- **Objective** — one sentence of intent. No story mechanics yet.
- **Beat** — one paragraph that plans the *engine moves* for the page: a value flip (trust shifts from + to −), a therefore/but causal link to the previous beat, a subtext gap (what's said ≠ what's meant), and a concrete sensory image. This is where story causality lives.
- **Prose** — the rendered page, written from the beat in the book's voice.

The studio tracks three pip states per page: `gap` (slot empty), `drift` (out of sync with upstream), `synced` (filled and current).

---

## The Build Ladder — 8 Steps

```
BRIEF
  ↓
FOUNDATIONS (5 sub-steps)
  ↓
SPINE
  ↓
OUTLINE
  ↓
BEATS
  ↓
DRAFT
  ↓
READ  (post-draft, parallel)
PUBLISH (post-draft, parallel)
```

Each step is **gated**: it unlocks only when the prior step is approved. Approval stamps fingerprints of the upstream roots (brief hash, foundations hash, spine hash) so the system can detect later when a step has **drifted stale** — you changed foundations after approving beats, for example.

---

## Step 1 — Brief

The author's raw intent: genre, audience, premise, tone. Every downstream prompt receives the brief as its "voice contract." It's the only step that is never regenerated — it's written by the author, not the AI.

---

## Step 2 — Foundations

Five ordered sub-steps. The chat rail generates candidates; the author picks or edits; their explicit gesture **pins** the record (immutable from here down).

```
ARGUMENT → ENDING → CAST → TENTPOLES → VOICE
```

| Sub-step | What it is | Story role |
|---|---|---|
| **Argument** | The claim the story argues (e.g. "loyalty to a dead man costs every living one") | The book's thesis — every event tests it |
| **Ending** | Where the story lands, concretely | Settled now; every route must reach it |
| **Cast** | Protagonist + majors: want / wound / lie | The wound drives the arc; the lie is the false belief the arc breaks |
| **Tentpoles** | 3+ vivid, concrete moments the author can already see | Structural anchors; pinned ones are immutable; killed ones are blacklisted |
| **Voice** | A rendered passage (~120 words) in the chosen voice style | The style exemplar every prose generator is held to |

**Pin semantics**: explicit author gesture (tap-select, edit) → `pinned: true`. AI-auto-selected → fluid (can be revised). Pinned records propagate as hard constraints into every downstream prompt; the AI is told to honor them verbatim.

**Killed tentpoles** are blacklisted: the AI is explicitly told "do NOT propose anything like these" in every downstream call.

---

## Step 3 — Spine

One paragraph (~250 words) — the causal throughline: how the story travels from the opening to the settled ending, through the tentpole moments.

The AI generates **3 candidate routes** (different midpoints, different connective tissue, same ending). Each route must weave every pinned tentpole into its `tentpole_order`. A post-generation validator checks this; if violated, it retries once with an explicit constraint reminder.

The author picks a route or edits freehand. The spine becomes the "throughline contract" every beat reads against.

**Craft knowledge — Tier 1**: Vonnegut's story shapes (Man in Hole, Boy Gets Girl, Cinderella, From Bad to Worse, Which Way Is Up?, Ascending Steps) are shipped as a constant diagnostic frame. The spine reviser uses them to name the emotional trajectory and find where the spine breaks the line it's promising.

---

## Step 4 — Outline

The chapter/page scaffold: sections (movements) and text pages, each with an **objective** (one sentence). No prose, no beats yet.

Generated from: brief + foundations + spine. The `settledContext()` renderer assembles all pinned/selected foundations into a structured constraint block that every outline prompt reads.

The author can manually add, reorder, or edit pages. Section headers group pages into **movements** (labeled I, II, III…).

---

## Step 5 — Beats

One beat per page, planned before any prose is written.

The beat system prompt enforces five rules on every generated beat:
1. **Causality** — connect to the preceding beat with "therefore" or "but" (never "and then")
2. **Value flip** — one thing that matters (safety, trust, hope…) shifts + to − or back
3. **Subtext** — at least one said ≠ meant gap
4. **Concrete image** — one specific sensory anchor (an object, a gesture, a place detail)
5. **Threads** — if a foreshadowing thread is anchored here: SEED it or PAY IT OFF

The beat generator loads the preceding beat from the DB (the nearest prior text page with a beat) so each page's beat is causally grounded in what was actually approved for the page before it.

**Best-of-n**: bulk generation samples 3 beats per page in parallel and uses a judge LLM call (temperature 0) to pick the strongest one. Manual/attended generation returns all candidates for the author to pick.

**Craft knowledge — Tier 1 (beats)**: five structural lenses (Save the Cat!, Story Circle, Hero's Journey, Fichtean Curve, Romancing the Beat). Each lens is a diagnostic frame (skeleton + what failure mode it catches), not a template to force the book into. The reviser uses the author's chosen lens to identify where the beat sheet is sagging or missing a beat.

---

## Step 6 — Draft (Prose)

Renders the prose for each page from its beat, in the book's voice.

Context fed to every prose generation call:
- **Brief** (voice contract)
- **Canon** (if sequel: the previous book's settled facts, never to be retold)
- **Spine** (throughline)
- **2 preceding pages** of full prose (for continuity of voice and detail)
- **Beat** (the concrete plan for this page)
- **Voice exemplar** (the chosen Foundations voice passage)

The page is written as **finished prose**, not a summary or plan.

---

## The Chat Rail — Revision at Every Layer

Every step has a **ReviseChat** right rail. The chat is the primary AI surface; the center editor is for manual work. The author talks; the AI responds in markdown and, only when proposing a change, appends a trailing JSON block.

Each layer has a **Lens**:

```
layer="foundations"  →  generates foundation candidates / patches
layer="spine"        →  rewrites the spine, knows Vonnegut shapes
layer="outline"      →  rewrites objectives, restructures pages
layer="beats"        →  replans beats using a structural lens
```

**Upward editing**: a beats chat can propose changes to foundations or spine if needed. The host validates that the target layer is allowed (`UPSTREAM` table). A patch that touches a pinned record is silently sanitized (the pinned value is restored before writing).

**Craft notes (Tier 2)**: `books.craft_notes[layer]` — the author's house style for this book at this layer (e.g. "always use close third POV", "never flash-forward"). Stacked on top of the system craft constants in every reviser prompt. Author-editable. The system craft is a floor; the craft note wins on taste.

---

## Staleness Tracking

When the author edits upstream after approving downstream steps, those steps are flagged **stale** (not blocked — just flagged).

Three roots are fingerprinted:
- `bHash` — hash of the brief's context string
- `fHash` — hash of the foundations block
- `sHash` — hash of the spine text

Each approval stamps the live root hashes into the journey entry. On read, the system compares current hashes to the stamped ones. A mismatch = stale.

```
foundations drifted → spine + outline + beats + draft all flagged stale
spine drifted       → outline + beats + draft flagged stale
```

The navigator surfaces the topmost stale step so the author walks the chain top-down and re-approves each layer.

---

## Sequel Support

If a book has `books.canon` set (previous-book packet), every prompt in the chain receives a `CANON` block:
- The cast as the previous book left them
- Open/closed foreshadowing threads
- The settled ending of the previous book

Canon is **read-only**: the AI may reference it, never contradict or retell it. Cast proposals in a sequel must include every canon character by their exact name, varying how they've *evolved* (not who they are).

---

## Context Chain — What Each Generation Step Receives

Every AI call in the pipeline builds a prompt from the layers above it. Here's exactly what flows into each step.

---

### Foundations generation (argument / ending / cast / tentpoles / voice)

```
SYSTEM PROMPT  (role: "you are a book architect proposing X")
USER CONTENT:
  - Book name
  - Brief (briefContext)
  - Canon packet (if sequel)
  - Settled foundations so far  (settledContext — all pinned/selected nodes so far)
  - Author's steer for "foundations" step
  - Author's ephemeral direction (optional chip + free text)
```

`settledContext()` renders each already-filled foundation node: argument, ending, cast with pinned fields marked, live tentpoles, killed directions (blacklisted), voice exemplar. Every downstream generation step reads this block.

---

### Spine route generation

```
SYSTEM PROMPT  (role: "you are a book architect proposing ROUTES")
  + STORY SHAPES (Vonnegut — Tier 1 craft, baked into system)
USER CONTENT:
  - Book name
  - Brief
  - Canon packet (if sequel)
  - Settled foundations (settledContext)
  - Existing routes to vary away from (the "avoid" list)
  - Author's steer for "spine" step
  - Author's ephemeral direction
```

Post-generation, pin validation: every pinned tentpole id must appear in every route's `tentpole_order`. Retries once with an explicit constraint reminder on violation.

---

### Outline / objectives generation (spine → objectives)

```
SYSTEM PROMPT
USER CONTENT:
  - Book name
  - Brief
  - Canon packet (if sequel)
  - Settled foundations (settledContext)
  - Spine text
  - Author's steer for "outline" step
```

---

### Beat generation (objective → beat)

```
SYSTEM PROMPT  (rules: causality, value flip, subtext, concrete image, threads)
USER CONTENT:
  - Book name
  - Brief (full scope, voice contract)
  - Canon packet (if sequel)
  - Spine text (throughline contract)
  - Outline context (all pages with objectives, current page marked ◀──)
  - Previous beat (nearest prior text page that has a beat — the causal antecedent)
  - Threads on this page (SEED / PAY OFF instructions from book_thread_anchors)
  - Author's steer for "beats" step
  - Author's ephemeral direction
```

The previous beat is re-read fresh from DB each time, so when an author approves a beat and requests the next page's beat, the new call is grounded in what they actually kept.

---

### Prose generation (beat → prose)

The user message is split into two parts at the prompt level so the stable part can be prompt-cached across a bulk generation run:

```
SYSTEM PROMPT  (rules: only prose, honor brief, beat = plan not voice, no mid-sentence stops)

USER CONTENT (Part 1 — cached across pages):
  - Book name
  - Brief  [scope: "band" mode — genre, audience, premise, tone only]
  - Canon packet (if sequel)
  - Voice sample  (the chosen Foundations voice exemplar)
    + AI-tell blocklist ("a testament to", "little did they know", etc.)
  - Objective map  (all pages with objectives, current page marked ← you are here)

USER CONTENT (Part 2 — per-page, never cached):
  - Story so far  (one-sentence summaries of all pages before the last 2)
  - Preceding prose  (full text of the 2 pages immediately before this one)
  - Character states  (latest ledger snapshot from the most recent prior page — knows/feels/has/believes)
  - Open loops  (thread instructions: SEED / PAY OFF / WITHHOLD for each thread anchored here)
  - Beat  (labeled "STORY PLAN — follow what must happen; do not imitate its prose style")
  - Objective  (what the page must achieve)
  - Author's steer for "prose" step
```

**Beat vs voice split**: the prompt explicitly separates WHAT (the beat = story plan) from HOW (voice sample + brief = style). The model is told the beat tells it what to do but the brief and voice sample tell it how to sound. This prevents the beat's functional prose from contaminating the voice register.

**Prompt caching strategy**: Part 1 (brief, canon, voice sample, outline) is marked `cache_control: ephemeral`. For a bulk generation run of N pages, Part 1 is computed and cached once; only Part 2 changes per page.

---

### Post-prose side effects (per page, best-effort)

After every prose render, two cheap async LLM calls run against the new text:

**1. Summary**
```
MODEL: low-cost model
INPUT: the new prose (truncated to 12,000 chars)
OUTPUT: 1–2 sentences — what happened + new facts a later page needs
STORED: pages[].metadata.summary
```
The next page's "story so far" block concatenates these summaries for all pages except the nearest 2 (which get their full prose).

**2. Character state extraction**
```
MODEL: low-cost model
INPUT: prior character states snapshot + new prose
OUTPUT: full updated roster — name, want, wound, believes, knows[], feels, has[]
STORED: pages[].metadata.character_states
```
The ledger carries forward: unchanged characters are preserved exactly; the page's prose updates whoever it affected. The next page's prompt receives the most recent snapshot. Want and wound are stable once set (they're arc poles); believes/knows/feels/has change as events unfold.

---

### Context accumulation across a full book build

```
Page 1:
  preceding prose = none
  story so far = none
  character states = none
  open loops = seeded threads only

Page 2:
  preceding prose = page 1 full text
  story so far = none
  character states = page 1 extraction
  open loops = threads seeded on page 1 flagged WITHHOLD; new seeds/payoffs

Page N (N > 3):
  preceding prose = pages N-2, N-1 full text
  story so far = page 1 summary, page 2 summary, … page N-3 summary
  character states = latest snapshot from any prior page
  open loops = all in-air threads: WITHHOLD / SEED / PAY OFF depending on anchor positions
```

Each page thus has:
- **Deep context** (summaries going back to page 1) for facts and arc consistency
- **Close context** (last 2 pages verbatim) for voice continuity and not repeating the last sentence
- **Character ledger** (the mutable state axis — not in the prose, in the metadata)
- **Thread ledger** (the promise/payoff axis — tells the page what to plant or deliver)

---

### Steer — the author's persistent instruction per step

`books.steers` is a jsonb column with a key per generation step (`foundations`, `spine`, `outline`, `beats`, `prose`). Every generation core reads it and appends it as a final block in the user message:

```
AUTHOR'S STEER FOR THIS STEP (honor it as a strong instruction shaping THIS output;
it never overrides the brief, the spine, or any PINNED constraint):
<text>
```

The steer is subordinate to pins but stronger than the AI's default judgment. It persists across all calls — bulk generation, chat rail, workshop — because it's read from the DB row, not passed as a per-call parameter.

---

## System Map

```
books.brief           ← Step 1: author writes
books.foundations     ← Step 2: 5 pinned nodes (argument/ending/cast/tentpoles/voice)
books.spine           ← Step 3: 1 route picked from 3 AI candidates
pages[].metadata      ← Step 4: .objective (one sentence per page)
pages[].metadata      ← Step 5: .beat (one paragraph per page)
pages[].content       ← Step 6: .prose (TipTap EditorJSON)
books.journey         ← approval ledger: step → timestamp + fingerprints
books.craft_notes     ← Tier-2 per-layer craft notes
book_threads          ← foreshadowing threads, anchored to pages (promise / resolution)
book_thread_anchors   ← seed/payoff page assignments for beat threading
```

```
Edge functions per step:
  foundations-core.ts  →  foundationsOptions(), spineRoutes()
  beat-core.ts         →  objectiveToBeat(), beatCandidates()
  generate-unit-core.ts → renderProse() (beat → page)
  revision-chat.ts     →  ReviseChat per layer (talk/propose/patch)

Craft constants:
  story-shapes.ts      →  Vonnegut shapes (spine lens Tier 1)
  lens.ts              →  5 beat sheet structures (beats lens Tier 1)
```
