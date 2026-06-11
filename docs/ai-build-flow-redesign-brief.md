# Redesign brief — the AI book-build flow

A self-contained context document for a design tool / designer. It describes one surface of
**Pensive** (an AI-assisted book-writing web app): the flow that takes an author from a one-line
idea to a finished draft. Goal of the redesign: make this flow feel like an intuitive, game-like
studio where the next move is always obvious and any artifact can be opened and reviewed in place.

No code knowledge is needed to use this doc. Where the data model matters for design honesty, it's
called out explicitly.

---

## 1. Product in one paragraph

Pensive lets a writer co-author a book with AI. Instead of "type a prompt, get a book," the book is
built up a **resolution ladder** — from a rough premise down to finished prose — one rung at a time,
with the author reviewing and approving as they go. The author is the showrunner/editor; the AI
drafts and self-revises. The promise: stories good enough that a reader doesn't care they're
AI-assisted. The flow in this doc is where that build happens.

**Surface:** desktop-first web app (also used on tablet/mobile). Calm, literary, editorial tone —
serif headings, generous whitespace, muted ink-on-cream palette, restrained accent color. Not a
flashy SaaS dashboard. Think "a quiet writing studio," not "an AI playground."

---

## 2. Who & what

- **User:** a writer (hobbyist → serious) building one book. Solo. Comes back across many sessions.
- **Job:** turn an idea into a complete, coherent draft they're proud of — without losing the thread
  between sessions, and without babysitting every page.
- **Mental model we want them to hold:** "My book gets built in clear stages. I can see where I am,
  what's next, and open up any part to read or change it. The AI does the heavy lifting; I steer and
  approve."

---

## 3. The core concept — the resolution ladder

The whole product rests on one idea: a book is refined top-down through levels of resolution. Each
level is a real, stored artifact the author can see and edit.

```
BRIEF      one-liner: genre, audience, premise, tone, length         (the contract)
  ↓
SPINE      one paragraph: the book's throughline / what it's about
  ↓
OUTLINE    chapters + pages, each page a one-sentence OBJECTIVE       (structure, no prose)
  ↓  (per page, repeated for every page)
  OBJECTIVE   what this page must achieve
    ↓
  BEAT        one paragraph: the concrete plan for the page (what happens, in order)
    ↓
  PROSE       the actual written page
```

Two cross-cutting artifacts ride alongside:
- **VOICE** — a chosen sample passage that anchors how every page sounds (picked once, early).
- **THREADS** — promises/setups the book makes and must pay off (foreshadowing), tracked across pages.

A separate **EDITOR'S READ** evaluates the finished draft and feeds an **AUTO-REVISE** pass.

**Design implication:** the design should make this ladder legible. The author should always sense
where a given piece sits (is this a plan or the prose? a whole-book thing or a per-page thing?).

---

## 4. The build, as steps (the "game")

The author moves through an ordered set of steps. This is the spine of the experience.

| # | Step | What the author does | Produces | Gate to advance |
|---|------|----------------------|----------|-----------------|
| 1 | **Brief** | Fill a short form (genre, audience, premise, tone, length) | `brief` | Author approves |
| 2 | **Spine** | Generate a throughline paragraph, edit it | `spine` | Author approves |
| 3 | **Outline** | Generate chapters+pages as objectives; review/edit; create | pages w/ objectives | Author approves |
| 4 | **Voice** | Generate 3 sample voices, pick one | `voice` | Author approves |
| 5 | **Beats** | Plan a beat for every page (AI) | per-page `beat` | Author approves |
| 6 | **Draft** | Write prose for every page (AI) | per-page `prose` | Author approves (draft built) |
| 7 | **Read** | Get an AI editor's critique; optionally auto-fix major issues | evaluation report | — (unlocks at prose) |
| 8 | **Revise** | Re-plan the outline or rework the draft from a described change | revised artifacts | — |
| 9 | **Publish** | Make the book public | published book | — |

Notes that shape the UI:
- Steps 1–6 are a **linear, gated ladder**: each must be **approved** before the next unlocks.
  Approval is a deliberate act ("Approve & continue"), not automatic — it's the author signing off.
- Steps 7–9 are **post-draft actions**, unlocked once prose exists; they're not strictly ordered.
- "Approved" is the only state that can't be derived from data — everything else (does a spine exist?
  do all pages have beats?) is **computed from the real artifacts**. The design must not invent a
  "fake" sense of progress; a step is only "ready to approve" when its artifact genuinely exists.

---

## 5. Current UI (what exists today — the thing being redesigned)

The book page is a tabbed workspace:

```
[ Manuscript 26 ]  [ Brief ]  [ Threads ]  [ Bible ]  [ AI tools ● ]
```

- **Manuscript** — the page list / where you read & hand-edit pages.
- **Brief / Threads / Bible** — supporting context editors.
- **AI tools** — THE build surface (the focus of this redesign). It currently has two stacked parts:

### 5a. The step rail ("Build with AI") — pinned at the top
A horizontal row of step chips with status, plus the current step's tool expanded inline below it:

```
BUILD WITH AI                                                  ▸ next: pick the voice
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ✓ Brief    ✓ Spine    ✓ Outline   [4 Voice]   🔒 Beats   🔒 Draft   🔒 Read  …   │
└─────────────────────────────────────────────────────────────────────────────────┘
  Voice
  Pick how the book sounds — it anchors every page the AI writes.
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ ✦  Find the book's voice                                              →    │
  │    Draft three candidate voices and pick one — it anchors the prose.       │
  └───────────────────────────────────────────────────────────────────────────┘
```

- Chip states: **done** (✓), **current/active** (numbered, highlighted), **locked** (🔒), **available**.
- Clicking an unlocked chip opens that step's tool inline (no navigation away).
- The current step is auto-selected and shows "▸ next: …".

### 5b. The resolution graph — below the rail
A dense grid showing the whole book's ladder. Brief→Spine cards on top, then, per page, a row of
`OBJECTIVE → BEAT → PROSE` cards connected by arrows. Empty cells read e.g. *"Empty — re-create from
the objective."* Clicking any card opens a **side drawer** to read/edit/regenerate that node.

```
RESOLUTION GRAPH                                              37% in sync — 41 gaps
  [● BRIEF: the premise]  →  [● SPINE: this book takes a solitary urban wanderer…]

  PART ONE — THE SURFACE
  The Crowd     [● OBJECTIVE …] → [● BEAT …]              → [○ PROSE  empty]
  The Commute   [● OBJECTIVE …] → [○ BEAT  empty]         → [○ PROSE  empty]
  The Glass …   [● OBJECTIVE …] → [○ BEAT  empty]         → [○ PROSE  empty]
```

### 5c. Live AI runs
Every AI action (generate spine, draft voices, plan beats, write draft, evaluate, auto-revise) is a
**background job** the UI watches live — it shows progress ("Planning beats 12/40 → Writing 3/40"),
survives a page refresh, and runs even if the tab closes. Each run can be **cancelled / restarted**
if it stalls. Designs must account for these in-progress and stuck states.

---

## 6. What's wrong today (the problems to solve)

These are the author's actual complaints — the redesign brief.

1. **"What's next" is whisper-faint.** In the graph, an empty beat just says *"Empty — re-create
   from the objective"* in light italic. It is not obvious that the next move is to generate it, or
   in what order. The flow's momentum is invisible.
2. **Too much context-switching.** Reviewing/editing the brief or spine jumps you to a different tab.
   Opening a page's beat is a separate drawer. There's no single place where you can glide between
   "see the big shape" and "open this one thing" without losing your place.
3. **The two halves feel like two products.** The step rail (clear, sequential, game-like) and the
   resolution graph (dense, flat, powerful) don't feel like one surface. The clarity of the rail and
   the depth of the graph should be the *same* experience.
4. **Hard to tell plan from prose, whole-book from per-page.** The ladder's levels aren't visually
   distinct enough; everything is a similar card.
5. **Stuck/empty states are underdesigned.** A brand-new book, a mid-build book, a stalled run, a
   fully-drafted book — these should each feel intentional, not like the same grid with blanks.

---

## 7. The north star (the vision to design toward)

> "It should unfold like cards, where the next step is clear by visual hierarchy and flow, and it
> should open up like a game. And it should act as a workspace where opening and reviewing any of
> this is super easy."

Concretely, the redesign should deliver:

- **One coherent surface** for the whole build — not a rail bolted above a grid. The sense of
  *sequence/progress* and the ability to *drill into any node* should be unified.
- **Obvious next move.** At any moment, the single most useful next action is visually dominant. The
  author should never wonder "what do I do now?"
- **Cards that unfold / levels that open.** Moving from brief → spine → outline → pages should feel
  like opening up a structure, each level revealing the next. Completed levels collapse to a calm
  summary; the active level is open and inviting.
- **Review & edit anything in place.** Brief, spine, an objective, a beat, a page of prose — open it,
  read it, change it, regenerate it, without leaving the flow or losing context.
- **Legible ladder.** A glance tells you what's a plan vs. prose, what's whole-book vs. per-page,
  what's done vs. waiting vs. locked.
- **Game-like progression, calm tone.** Satisfying forward motion and clear "level cleared" moments —
  but in the app's quiet, literary voice, not gamified confetti.

---

## 8. States the design must cover

Design these explicitly; they're the real lifecycle:

1. **Brand-new book** (only a title): the flow should beckon — "start here," one clear action.
2. **Mid-ladder** (brief+spine+outline done, no prose): the current step front and center; done steps
   summarized; future steps previewed but locked.
3. **A step in progress** (AI running): live progress, a sense the machine is working, cancel
   available.
4. **A run stalled/failed**: clear recovery — cancel / restart — without dead-ends.
5. **Reviewing a node** (open a beat/prose/brief to read or edit): in-place, easy in/out.
6. **Drafted, now refining** (prose exists): read → auto-revise → revise → publish, all reachable.
7. **Done / published**: a calm finished state, the build collapsed, the manuscript foregrounded.

---

## 9. Constraints & non-negotiables (so the design stays buildable)

- **State is derived from real artifacts.** "Ready to approve / done / locked" must reflect actual
  data (spine exists? every page has a beat? prose written?). Don't design affordances that imply
  progress the data can't back. The one stored flag is **approval** per gated step.
- **Guided but not jailed.** The ladder gates the *AI's next step*, but the author can always hand-
  write/edit in the Manuscript view. The lock guides; it never traps. Keep an always-available exit
  to the full workspace.
- **Per-page scale.** A book can have ~5 to ~150 pages. The "per-page" parts (objective/beat/prose)
  must stay scannable at both ends — a short story and a novel.
- **Long-running, resumable actions.** AI steps take seconds to minutes, run in the background, and
  survive refresh. Progress and stuck-recovery are first-class UI, not afterthoughts.
- **Approval is a deliberate, low-frequency act** (≈6 gates total). Never ask the author to approve
  per-page in bulk — that causes rubber-stamping. They approve the *plan*, not every unit.
- **Tone:** literary, editorial, calm. Serif display, muted palette, restrained motion.

---

## 10. Content inventory (real labels & copy in use)

Use or improve these; they convey the voice.

- Steps: Brief · Spine · Outline · Voice · Beats · Draft · Read · Revise · Publish
- Step captions:
  - Brief — "Tell the AI what the book is — every step below is drawn from it."
  - Spine — "The one-paragraph throughline the whole book realizes."
  - Outline — "The chapters and pages as objectives — review, edit, create. No prose yet."
  - Voice — "Pick how the book sounds — it anchors every page the AI writes."
  - Beats — "Plan what each page does — causal order, value flips, concrete images — before any prose."
  - Draft — "Render the prose from the approved beats, in the book's voice."
  - Read — "A structural critique of the draft — then auto-fix the critical & major issues."
  - Revise — "Re-plan the outline or rework the draft — describe the change and review before it sticks."
  - Publish — "Make the book public."
- Action labels: "Find the book's voice", "Plan 24 beats", "Write 26 pages", "Approve & continue",
  "Continue — write the prose", "Auto-fix critical & major issues".
- Ladder nodes: BRIEF · SPINE · OBJECTIVE · BEAT · PROSE.
- Status words: ready · done · locked · running · stuck.
- Graph header: "37% in sync — 41 gaps" (a freshness/completeness readout for the whole ladder).

---

## 11. What success looks like

A first-time author, dropped into a fresh book, knows exactly what to do and does the whole build —
brief to drafted manuscript — without ever asking "where am I / what now / how do I see that again."
A returning author re-enters and instantly re-orients. Reviewing or changing any piece feels like
turning a page, not opening a settings menu. The surface feels like one calm, legible studio with a
satisfying sense of building something, level by level.

---

## 12. Out of scope for this redesign

- The reading experience / public book pages.
- The Manuscript page-editor itself (rich text editing).
- The underlying AI prompts and model behavior.
- Account, billing, sharing.

Focus: the **AI tools build surface** — steps 1–9, the ladder, and how an author moves through and
reviews them.
```
