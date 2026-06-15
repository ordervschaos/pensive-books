# AI Calls & Context Map

Every AI call in the system, organized by purpose. Three sections:

1. **[The Studio Wizard](#1-the-studio-wizard)** — the step-by-step build flow; each step adds a new layer to the context the next step inherits
2. **[Revision of Units](#2-revision-of-units)** — targeted edits after the initial build (inline, conversational, agentic)
3. **[Automated Triggers & Bookkeeping](#3-automated-triggers--bookkeeping)** — calls that fire automatically, invisible to the author

---

## Preamble

### The Chokepoint: `_shared/claude.ts`

Every text call flows through `callClaude()`. It logs a `running` row to `ai_calls` before the call, routes to the right provider (Anthropic / DeepSeek / Qwen via OpenRouter), converts Anthropic-format bodies to OpenAI format for non-Anthropic tiers, and closes the log with output + tokens + latency. The author never sees this layer.

### Shared Context Blocks

These building blocks are assembled differently per call, but the source is always the same.

| Block | Source | What it contains |
|---|---|---|
| `briefContext()` | `books.brief` | Scope, genre, audience, premise, tone, success criteria |
| `settledContext()` | `books.foundations` | Argument, ending, cast (with pinned fields), live/killed tentpoles, voice exemplar |
| `canonContext()` | `books.canon` | Sequel only: parent title, unresolved threads, character states at end of prior book |
| `outlineContext()` | `pages` | All pages in order: title + objective |
| `precedingBeat()` | `pages.metadata.beat` | The immediately prior page's beat (causal antecedent) |
| `storySoFar` | `pages.metadata.summary` | One-paragraph summaries of all pages before the last 2 |
| `precedingProse` | `pages.content` | Full text of the 2 pages just before the current one |
| `characterStates` | `pages.metadata.character_states` | Latest snapshot: what each character knows/feels/has/believes |
| `openLoops` | `book_threads` + anchors | Threads to SEED, PAY OFF, or WITHHOLD on this page |
| `steerBlock()` | `books.steers[step]` | Author's free-text guidance per step — sticky, re-read on every call |

### Model Tiers

Set via `/admin/settings`. `high` = generation; `low` = cheap background passes.

| Tier | high | low |
|---|---|---|
| opus | claude-opus-4-8 | claude-haiku-4-5 |
| sonnet | claude-sonnet-4-6 | claude-haiku-4-5 |
| deepseek | deepseek-chat | deepseek-chat |
| qwen | qwen/qwen3-235b-a22b | qwen/qwen3-8b |
| image prompt | qwen/qwen3-235b-a22b (always, never Anthropic) | — |
| image render | google/gemini-2.5-flash-image via OpenRouter (always) | — |

---

## 1. The Studio Wizard

**The central pattern: context accumulates as you move down the steps.** Each step's output becomes part of the next step's input. By the time prose is generated, the model knows the argument, ending, cast, tentpoles, spine, every page's objective, the preceding beats, the preceding prose, the character states, and the open loops.

```
Step 1  Brief          → sets the contract (no AI call)
Step 2  Foundations    → argument → ending → cast → tentpoles → voice (settled context grows sub-step to sub-step)
Step 3  Spine          → brief + full foundations → 3 candidate routes
Step 4  Outline        → brief + spine + prefix of objectives (grows page by page)
Step 5  Beats          → brief + spine + outline + previous beat (causal chain builds)
Step 6  Draft          → brief + spine + outline + beats + preceding prose + character states + open loops
Step 7  Read           → brief + full manuscript → multi-dimensional editor's report
```

---

### Step 1 — Brief

No AI call. The brief is the **context contract** the model is judged against in every subsequent call. Every call includes it via `briefContext()`. What you put here shapes all downstream generation more than any single steer.

Fields: scope band, genre, audience, premise, tone, success criteria.

---

### Step 2 — Foundations (new flow)

**`foundationsOptions`** — called once per sub-step. Each sub-step receives the settled results of all previous sub-steps, so context grows as the author moves through them.

```
sub-step 1  argument:   brief + settled (empty)
sub-step 2  ending:     brief + settled (argument)
sub-step 3  cast:       brief + settled (argument + ending) [+ canon if sequel]
sub-step 4  tentpoles:  brief + settled (argument + ending + cast)
sub-step 5  voice:      brief + settled (all) + one tentpole moment to render
```

Full prompt shape (same for all sub-steps):
```
System: role description for this sub-step + JSON output schema
User:   BOOK name
        BRIEF (full)
        CANON (if sequel)
        SETTLED FOUNDATIONS SO FAR
        STEER (books.steers["foundations"])
```

Returns 3 JSON candidates for the author to pick from. Sequel cast gets an addendum: "propose where each character is NOW, not a copy of who they were."

**Author's lever**: One **Steer field** covers all five sub-steps. Pinning a field (argument, ending, cast line, tentpole) marks it as immutable in `settledContext` — every downstream call sees it as a hard constraint.

---

### Step 3 — Spine Routes

**`spineRoutes`** — produces 3 candidate routes (narrative paths) through the book's settled foundations and tentpoles.

```
System: what a route is, tentpole ordering rules, JSON schema
User:   BOOK name
        BRIEF (full)
        CANON (if sequel)
        SETTLED FOUNDATIONS (full: argument + ending + cast + tentpoles + voice)
        EXISTING ROUTES to vary away from (on re-generate)
        STEER (books.steers["spine"])
```

**Hard constraint**: Every pinned tentpole must appear in every route's `tentpole_order`. Killed tentpoles must not appear. If violated, one retry with an explicit constraint reminder appended. Throws if still violated after the retry.

**Author's lever**: Spine steer + pinning/killing tentpoles. Pin = must survive into every route. Kill = never proposed again.

---

### Step 4 — Outline: Objective Options

**`objectiveOptions`** — called per page slot. Produces 3 alternative objectives for the author to pick from or edit.

```
System: what an objective is, causality rules, JSON schema
User:   BOOK name
        BRIEF
        BOOK SPINE (the throughline)
        OBJECTIVES SO FAR (only the pages *before* this slot — causal prefix)
        THIS SLOT's title
        CURRENT OBJECTIVE (vary away from it, if set)
```

**Key**: the model sees a causal *prefix*, not the whole outline. It only knows what came before. Later pages' objectives aren't shown, so each slot is generated in sequence, grounded on what the story has already committed to.

**Author's lever**: The brief, the spine, and the objectives already set for earlier pages (they become the foundation for later ones).

---

### Step 5 — Beats

**`objectiveToBeat` / `beatCandidates`** — one beat per page. With `candidates > 1` (bulk path), N beats are sampled in parallel and a judge picks the best (see §3).

```
System: what a beat is; rules for causality/value-flip/subtext/concrete-image/threads
User:   BOOK name
        BRIEF (full)
        CANON (if sequel)
        BOOK SPINE
        OUTLINE (all pages with objectives, target page marked ◀── THIS PAGE)
        PREVIOUS BEAT (nearest prior page that has a beat — the causal antecedent)
        THREADS ON THIS PAGE (SEED / PAY OFF from book_thread_anchors)
        STEER (books.steers["beats"])
        THIS PAGE'S OBJECTIVE
```

**Why the previous beat matters**: beats must connect by "therefore" or "but" — never "and then". The model needs the antecedent to write a causal continuation. The beat is read fresh on every call, so in a serial pick (author approves beat → requests next) each subsequent page is grounded on the beat the author actually approved.

**Author's lever**: Beats steer, and the objective (it's the instruction the beat must fulfill). Thread anchors (seed/payoff assignments on specific pages) also shape the beat.

---

### Step 6 — Draft: Prose Write

**`beatToProse`** — renders one page from its beat into finished prose. The largest prompt in the system; split into two layers for prompt caching.

**Stable prefix** (cached — same for every page write in this book):
```
BOOK name
BRIEF (band scope only)
CANON (if sequel)
VOICE SAMPLE (from books.bible.voice_sample)
  → + list of AI-tell phrases to avoid
OUTLINE (all pages with objectives — "← you are here" marker)
```

**Variable part** (changes per page):
```
STORY SO FAR (summaries of all pages before the last 2)
PRECEDING PROSE (full text of the 2 pages immediately before this one)
CHARACTER STATES (latest snapshot from the previous page)
OPEN LOOPS (which threads to SEED, PAY OFF, or WITHHOLD on this page)
OBJECTIVE (what this page must achieve)
BEAT (the concrete plan to follow — follow this, not just the objective)
STEER (books.steers["prose"])
```

**After every write**, two cheap haiku calls fire automatically (see §3): one to summarize the page (feeds `storySoFar` for later pages), one to update the character state ledger (feeds `characterStates` for the next page).

**Author's lever**: Prose steer, and the voice sample — it's weighted higher than any instruction and is the strongest single style anchor in the system.

---

### Step 7 — Read: Evaluation

**`runEvaluation`** — reads the whole manuscript and produces a multi-dimensional editor's report. Structured as a **map-reduce**: triage first, then 3 parallel group evaluations, then one synthesis verdict. 5 total calls.

**Shared cached system** (used by all 5 calls):
```
EDITOR_STANCE (the critic's posture)
FICTION_RUBRIC (criteria: character/plot/pacing/dialogue/prose/genre/world/resonance/mechanics)
FULL MANUSCRIPT (title + brief + all pages tagged with real page ids)
```

**Call 1 — Triage** (low effort, ~45s timeout):
```
User: Identify the genre contract, one-sentence premise, and whether the book is speculative
Output: { genre_contract, premise, is_speculative }
```

**Calls 2–4 — Group evaluation** (parallel, medium effort, ~105s timeout each):

| Group | Dimensions covered |
|---|---|
| story | character, plot, pacing |
| craft | dialogue, prose |
| whole | genre_contract, world_building (if speculative), resonance, mechanics |

Each group call adds:
```
User: "The genre contract is: [triage result]. Judge against it. Evaluate ONLY: [menu]."
Output: { sections: [{ id, title, stance, assessment, strengths, issues: [{ severity, note, evidence, suggestion, page_ref }] }] }
```

**Call 5 — Verdict** (medium effort, ~55s timeout):
```
System: EDITOR_STANCE only (no rubric or manuscript — not needed for synthesis)
User:   book name + genre contract + per-section stances/assessments/issue summaries (not full prose)
Output: { genre_contract, stance, letter (2-4 sentence editorial letter), priorities }
```

Every issue carries a `page_ref.id` (a real page row ID). This is what makes the "Revise this" button possible on the Read step — clicking it pre-fills the Revise step with that page's specific issues.

**Author's lever**: None — this is a read-only analysis. The brief shapes what the model judges against.

---

## 2. Revision of Units

These calls are triggered by the author after the initial build, to revise specific things. They take the current artifact + an instruction (or a conversation, or an evaluation) and return a revision.

---

### Tentpole Revise — `reviseTentpole`

**Where**: Foundations step → Tentpoles → "Revise" on a specific tentpole.

```
System: targeted revision rules (apply the instruction, preserve what works, keep 1–3 sentence scene form)
User:   BOOK name
        SETTLED FOUNDATIONS (for consistency)
        CURRENT MOMENT (the existing tentpole text)
        AUTHOR'S INSTRUCTION
```

Returns only the revised text. Does not rewrite from scratch.

**Author's lever**: The instruction field. The model is instructed to apply it surgically.

---

### Inline Node Revision — `reviseNode`

**Where**: The pencil icon on any spine, objective, or beat in PageReview or the Studio.

Works on all three layers (`layer: "spine" | "objective" | "beat"`).

```
System: "You are revising [the spine / a page OBJECTIVE / a page BEAT]. Apply the instruction; preserve what works."
User:   BOOK name
        BRIEF (genre/audience/premise/tone — scope and success omitted)
        BOOK SPINE (if layer is objective or beat, for throughline consistency)
        CURRENT [spine / objective / beat]
        AUTHOR'S INSTRUCTION
```

Returns only the revised text — no preamble, no explanation, no list of changes.

**Author's lever**: The instruction field next to the node.

---

### Prose Revision — `revisePage`

**Where**: The "Revise" build path — addresses editorial notes on existing prose. Triggered by "Revise this" on the Read step, or by the AutoRevise flow.

Same **stable prefix** as prose write (cached: brief + canon + voice sample + outline). Variable part differs:

```
STORY SO FAR
PRECEDING PROSE
CHARACTER STATES
OPEN LOOPS
This page's OBJECTIVE (for context)
CURRENT PAGE PROSE (the text to revise)
THE EDITOR'S NOTES TO ADDRESS: [{ severity, note, evidence, suggestion }]
```

Uses `SYSTEM_REVISE` instead of `SYSTEM` — instructs the model to address every note while preserving voice and strengths.

**Author's lever**: The editorial notes. They come from the evaluation (auto-populated from `page_ref` issues) or are typed manually.

---

### Beat Chat — `beats-agent`

**Where**: The Beat Chat panel in the Beats step. A stateful conversation with an editor about the beat sheet.

The model has three modes per turn, chosen by the model: **talk** (answer/discuss), **evaluate** (judge the sheet against fiction criteria), or **propose a change** (emit a `RevisionPlan` in a trailing JSON block).

Context assembled at turn start:
```
System: SYSTEM (Beat Editor persona, output format rules — system prompt cached)
First user turn:
  BOOK name
  BRIEF (full)
  SPINE
  FOUNDATIONS (settled, if any)
  CURRENT BEAT SHEET (all pages: [id], title, objective, beat)
  TRACKED THREADS (setup/payoff page ids)
  FICTION CRITERIA (the beat evaluation rubric)
  — — —
  AUTHOR: [their message]
Subsequent turns: bare text (history kept to last 24 turns)
```

Output format: plain markdown reply. If the model proposes a change it appends a trailing ` ```json ` block holding the `RevisionPlan`. The client splits them: reply → chat display, plan → `beat_chats.pending_plan` for the author to review and apply.

**Author's lever**: The conversation itself. The model is stateful; it accumulates context across the session.

---

### Editor's Agent — `revise-agent`

**Where**: The "EditorAgent" path on the Read step. A durable, self-chaining tool loop — the most complex call in the system.

**Method**: triage the evaluation notes → investigate by reading actual prose → ask the author about genuine creative forks → propose a surgical revision plan.

**Initial context** (first message, cached for the entire run):
```
BOOK name
BRIEF (full)
CURRENT OUTLINE (all pages: [id], type, title, objective, summary)
TRACKED THREADS (names, statuses, setup/payoff page ids)
EDITOR'S EVALUATION (full verdict + all sections with their issues)
```

**Tools** the model can call:

| Tool | What it does |
|---|---|
| `read_page(page_id)` | Fetches full prose of one page (up to 12,000 chars) |
| `ask_author(question, options[])` | Parks the run until the author answers; resumes on their reply |
| `propose_revision_plan(...)` | Terminal: inserts a `book_revisions` row; ends the run |
| `finish(report)` | Terminal: ends without a plan (if no changes are needed) |

**Each chain link**: one model call (medium effort, adaptive thinking, 8,000 max tokens). The model narrates its reasoning in plain text before each tool call — that text becomes the live progress feed the author sees in the UI.

**Cache breakpoints**: placed on the first message and the latest message of each turn so each link only pays tokens for new content.

**Author's lever**: `ask_author` answers (they shape the plan's creative direction), and the evaluation itself.

---

## 3. Automated Triggers & Bookkeeping

These calls fire automatically — not user-initiated. They are invisible to the author in the UI but feed every subsequent AI call's context.

---

### Page Summary — `summarize`

**Fires**: after every successful prose write (`beatToProse`).

```
System: "Summarize this page in 1-2 sentences: what happens and any new facts a later page would need."
User:   The page prose (up to 12,000 chars)
```

**Model**: low tier (haiku).

Stored in `pages.metadata.summary`. Feeds `storySoFar` for every page that comes after this one — this is how "the story so far" is assembled without sending all prior prose every time.

---

### Character State Extraction — `extractCharacterStates`

**Fires**: after every successful prose write (`beatToProse`), in parallel with the summary call.

```
System: "Track character state. Given the PRIOR states and NEW page prose, output the UPDATED state of EVERY character."
User:   PRIOR CHARACTER STATES (JSON from the previous page's snapshot, or "(none yet)")
        NEW PAGE PROSEpush
Output: { characters: [{ name, want, wound, believes, knows[], feels, has[] }] }
```

**Model**: low tier (haiku). Max 24 characters (runaway guard).

Stored in `pages.metadata.character_states`. Feeds the `CHARACTER STATES` block on the next page's prose call — this is how characters accumulate what they know/feel/have/believe instead of resetting on every page.

---

### Beat Judge — `pickBestBeat`

**Fires**: inside `objectiveToBeat` when `candidates > 1` (the bulk/unattended path). Not called in the serial attended path.

```
System: JUDGE_SYSTEM (criteria: causality, value flip, subtext, concrete image, objective)
User:   OBJECTIVE
        PREVIOUS BEAT (if any)
        [1] candidate beat
        [2] candidate beat
        [3] …
```

**Model**: high tier (same as generation — not haiku). Replies with a single digit only (max_tokens: 8).

The judge picks the winner; only that beat is returned to the caller. N candidates generated in parallel at `temperature: 1` for spread; judge at `temperature: 0` for determinism.

---

### Image Prompt Composition — `generate-scene-image` / `generate-character-portrait` (mode: "prompt")

**Fires**: when the author clicks "Compose" in `ImageGenStudio` (scenes in PageReview, portraits in Foundations → Cast → Look).

**Always `IMAGE_PROMPT_MODEL`** (`qwen/qwen3-235b-a22b` via OpenRouter, regardless of admin tier). Never uses `ANTHROPIC_API_KEY` — a deliberate prod dependency isolation.

Scene prompt context:
```
Present cast descriptions (from foundations.cast)
The 2 preceding beats (continuity — not depicted in the image)
The current beat (the moment to illustrate)
Author's art direction (optional free text)
```

Portrait prompt context:
```
Character name, role, want, wound (from foundations.cast)
Author's art direction (optional)
```

**Author's lever**: The **art direction** field in the `ImageGenStudio` component. Separate from the prose steer.

---

### Image Rendering — `generate-scene-image` / `generate-character-portrait` (mode: "image")

**Fires**: after prompt composition (or when the author edits the prompt and clicks "Generate").

**Always `google/gemini-2.5-flash-image` via OpenRouter** — the only model in the stack that accepts reference images for face consistency.

Scene render input:
```
The composed (and optionally author-edited) prompt text
Cast portraits of characters named in the beat (up to 2 angles each, from foundations.cast[].portraits)
Author's uploaded reference images (if any)
```

**Face coherence model**: author generates portrait variants in Foundations → Cast → Look; those URLs are stored in `foundations.cast[].portraits`. Scene generation feeds them as input images so the model renders the same faces across scenes.

---

### AI Call Meta-Evaluation — `evaluate-ai-call`

**Fires**: manually, from the `/admin` panel. Admin-only.

An LLM-as-judge that scores any logged `ai_calls` row. Given the call's `fn` type, it applies criteria appropriate to that call — prose calls are scored on voice/continuity/objective achievement; beat calls on causality/flip/subtext. Used to calibrate prompt quality offline.

---

## Context Size by Call

| Call | Typical input tokens |
|---|---|
| Foundations sub-step | ~800–1,500 |
| Spine routes | ~1,500–3,000 |
| Objective options | ~600–1,200 |
| Beat (single) | ~2,000–4,000 |
| Beat judge | ~500–1,000 |
| Prose write (page) | ~4,000–8,000 |
| Prose revise | ~6,000–12,000 |
| Evaluate triage | ~5,000–40,000 |
| Evaluate group | ~5,000–40,000 |
| Evaluate verdict | ~1,000–3,000 |
| Revise-agent per turn | grows each turn, starts ~3,000 |
| Beats-agent per turn | ~3,000–6,000 |
| Summarize | ~500–2,000 |
| Character state extract | ~1,000–4,000 |

The manuscript dominates evaluation calls. For prose calls, the preceding prose (2 pages × ~1,500 words ≈ 4,000 tokens) is the largest single chunk in the variable part.

---

## What the Author Controls

| Lever | Where to set it | Which calls it affects |
|---|---|---|
| **Brief** | Book settings | Every call |
| **Foundations (settled)** | Foundations step | Spine routes, beats-agent, revise-agent, beat, prose |
| **Tentpole pins/kills** | Foundations → Tentpoles | Spine routes (hard constraint, validated post-generation) |
| **Voice sample** | Foundations → Voice or Voice step | Every prose write (strongest single style anchor) |
| **Per-step steer** | Steer field on each step | Foundations, spine, beats, prose (matched by step key) |
| **Beats (approved)** | Beats step | Prose write (the beat is the plan the prose follows) |
| **Art direction** | ImageGenStudio component | Image prompt composition only |
| **Cast portraits** | Foundations → Cast → Look | Scene image rendering (face coherence) |
| **Ask-author answers** | Revise-agent dialog | Revise-agent plan shape |
| **Thread anchors** | Thread panel | Beat generation (SEED/PAY OFF instructions per page) |
