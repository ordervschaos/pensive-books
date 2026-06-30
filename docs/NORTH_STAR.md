# North Star

> **What this is.** The standing reference for *why this product exists and when it is done.*
> Business, product, and UI/UX in one place. Implementation specs (`novel-dna-spec.md`,
> `chat-first-studio.md`, `sota-story-generation.md`, …) answer **how**. This answers **what for** and
> **how we know it's working**. When a decision is contested, it is settled against this doc.
>
> **Status:** living. Edit it when the hypothesis or the bar changes — not when the code changes.

---

## 1. The hypothesis (the one thing we are testing)

> **With enough *structure* — a DNA — and a way to *hydrate* it with AI and *grow* more structure
> from it, a book (and then a series) can be generated that a person will simply read.**

Everything we build is an experiment on this single claim. Not "can AI write prose" (it can, badly,
everywhere). The bet is narrower and harder:

- **Structure first.** A story is a self-similar tree (seed → premise → pillar → act → beat →
  scene → prose). The tree is the source of truth; pages are a *render* of it. (`novel-dna-spec.md`.)
- **AI hydrates the structure**, it does not free-write the book. Each rung is generated *from the
  rungs above it* plus locked author intent. The structure is the leash.
- **Structure begets structure.** From a one-line seed, the system can grow the whole tree down to
  prose — and back up a level into a *series* (canon carried forward across books).

If the hypothesis is **true**, we will be able to produce a book that passes the bar in §2 with low
author effort. If it is **false**, we will find the rung where structure stops helping and prose stops
being readable — and that finding is itself the deliverable. We are not committed to the conclusion;
we are committed to running the test honestly.

```
        THE HYPOTHESIS, AS A MACHINE

   seed ──hydrate──▶ premise ──hydrate──▶ pillar ──▶ act ──▶ beat ──▶ scene ──▶ PROSE
    ▲                                                                                  │
    │                                                                                  ▼
  author intent (locks)  ◀──────────── steer / revise ──────────────────────  a book you READ
    │                                                                                  │
    └────────────────────────── series (canon forward) ◀───────────────────────────┘
```

---

## 2. The North Star metric (the bar for "it works")

> **The read-through test:** *Can the target reader read a generated book end-to-end and not want to
> edit it?*

Concretely, measured on the author who is also the first reader (today: you):

1. **Read-through depth.** How many pages of a *self-generated* book do you read before you stop —
   either because you're bored, or because the editor's reflex kicks in ("I'd change that line")?
   - Baseline (2026-06): **~4 pages.** Stops are edit-reflex, not boredom — close, not there.
   - **The bar: a full book read with no edit-reflex.** "Read it and go." That is the win condition
     for the hypothesis.
2. **Generation ease.** How much author effort produced that book? Counted in *decisions and
   corrections*, not minutes. A blank seed → a readable book is the asymptote.
3. **Step intuitiveness.** At each step, did the author know what to do and why, without being told?
   ("Don't make me think.") Friction here is a product bug even when the prose is good.

These three are the only top-level scoreboard. A feature that doesn't move read-through depth,
generation ease, or intuitiveness is not a priority — it's a distraction.

### The evaluation loop (how we keep score)

```
   BUILD a book in the Studio  ──▶  READ it as a reader  ──▶  SCORE against the bar
        ▲                                                          │
        │                                                          ▼
        └──────────  fix the rung that broke read-through  ◀──  WHERE did it break + WHY
```

- **Read, don't admire.** We judge the *artifact*, not the cleverness of the pipeline.
- **Locate the break.** When read-through stops, name the rung (was the *beat* causal-but-flat? the
  *scene* shift missing? the *voice* generic?). That rung is the next sprint.
- This is the existing `evaluate-book` rubric (editor's read) plus the human read-through. The rubric
  catches craft failures cheaply; the human read is the ground truth. (`docs/book-evaluation.md`,
  `docs/book-1150-gold-standard-log.md`.)

---

## 3. The audience (who this is for)

A subset of the **Pensive** audience: people who want to write books — and in practice, often
**story** books. Two real groups, one product:

| | **AI-native authors** | **Story-first authors** |
|---|---|---|
| Who | Already use AI tools; today they copy-paste generated prose *in* from elsewhere | Have stories to tell; not fluent in prompting or AI workflow ("how do we let them create?") |
| Pain | No structure — they get disconnected prose blobs, then babysit continuity by hand | Blank page; don't know the moves of story craft; tools assume they do |
| What we give | A structure that *holds* the prose together; AI on the inside, not the clipboard | Guided rungs that *ask small questions* and do the craft for them |

**The unifying insight:** today the generated prose enters Pensive as *paste* — context-free, no
spine, no memory across pages. Our job is to move generation **inside** the structure so prose is born
*from* a tree that already knows the wound, the lie, the turning points, and the cast. Same AI; the
difference is the **leash.**

**Primary user, for now:** the builder (you). You are good at targeting and you build stories you'd
want to read. The product is "complete enough" when *you* read your own generated book and don't reach
for the editor. If it clears that bar for you, it clears it for the audience.

---

## 4. The product (two pillars, one clear line between them)

There must never be ambiguity about *which mode you are in.* This is the core product clarity.

```
┌────────────────────────────────┐     ┌────────────────────────────────┐
│  WRITING                        │     │  STUDIO                         │
│  manual authorship              │     │  generated stories              │
│                                 │     │                                 │
│  • you type the prose           │     │  • the DNA tree (source of      │
│  • pages, chapters, editor      │     │    truth) + AI hydration        │
│  • the book as a reader sees it │     │  • seed → … → scene → prose     │
│                                 │     │  • chat = the agent; center =   │
│  "I am the author."             │     │    a near-manual editor of      │
│                                 │     │    each rung                    │
│                                 │     │  "I am directing a generation." │
└────────────────────────────────┘     └────────────────────────────────┘
        the page is the truth                 the tree is the truth;
                                              pages are a render of it
```

- **Writing** = the manual book. The page *is* the artifact. No AI in the author's way.
- **Studio** = the generated book. The **DNA tree** is the artifact; pages are reconciled *from* it.
  The author works four verbs at every rung — **expand · choose · edit · lock** — and AI does the
  heavy lifting without overwriting intent. (`novel-dna-spec.md`.)
- **The bridge:** Studio *renders into* the same pages Writing edits. A generated book becomes a
  normal Pensive book — readable, publishable, sendable — with no second class of object.

Every screen should let the user answer in one glance: *"what is this part helping me do?"*
Writing helps you **write**. Studio helps you **direct a generation**. Anything that blurs that line
is a regression.

---

## 5. Objectives & success criteria

| # | Objective | Done when… |
|---|---|---|
| O1 | **The artifact is readable** (the hypothesis) | A full self-generated book passes the read-through test (§2) — read with no edit-reflex. |
| O2 | **Generation is easy** | A blank seed → a readable draft with author input measured in a handful of decisions/locks, not a manuscript's worth of corrections. |
| O3 | **The steps are intuitive** | At every rung the author knows the *one* small thing being asked and why — no manual needed. ("Don't make me think.") |
| O4 | **The UI is clean & operable** | One clear job per screen; the Writing/Studio line is unmistakable; nothing speculative on screen. |
| O5 | **It compounds into a series** | Canon carries forward; book 2 is generated *constrained by* book 1 (cast, voice, open threads). |

O1 is the hypothesis. O2–O3 are why anyone would use it instead of pasting blobs. O4 is the cost of
admission. O5 is the upside the structure uniquely unlocks (paste-workflows can't do continuity).

---

## 6. UX principles (the standing rules)

1. **Don't make me think.** Every step states its purpose and its single ask. If a user pauses to
   figure out "what does this button do / what am I supposed to put here," that is a bug.
2. **One mode at a time.** Writing or Studio — never a muddy middle. The verbs available match the
   mode.
3. **Small asks, front-loaded.** Cognitive load lives at the human core the AI can't guess (the
   wound, the lie, the turning points) and tapers to "voice corrections" at the leaf. Prefer
   *"choose / correct"* over *"fill a blank."*
4. **AI proposes; the author owns.** Locks are sacred — regeneration never overwrites pinned intent.
   The author is always able to see *what changed* and revert it.
5. **Live projection, not refresh.** The UI is a live mirror of server state; you never hit refresh to
   see the truth. (Standing rule across the app — see `feedback_refresh_is_noop`.)
6. **Show the blast radius.** Before any regeneration, show what it will touch. No silent rewrites.
7. **Nothing speculative on screen.** Minimum UI that does the job. Clean up our own mess.
8. **Proposed changes survive their verdict.** When the author accepts or denies a proposal, the change text stays readable in the chat thread — it is not erased. Accept/deny is a state transition on the proposal, not a deletion. An author must always be able to see *what they said yes or no to.*

---

## 7. Business (why this is worth building)

- **Wedge:** Pensive already has authors and a publishing path (book → marketing site → Kindle). The
  Studio is the *generation engine* that fills that pipe with original, structured books instead of
  pasted blobs.
- **Differentiator:** not "AI writes prose" — **AI grows a book from a structure that remembers
  itself.** Continuity, causality, and series-canon are the moat that clipboard workflows can't cross.
- **Cost discipline:** generation runs through one logged chokepoint (`ai_calls`) on a tunable model
  stack (OpenRouter tier today). We know the per-book cost (~$0.33 for an editor's read at the eval
  baseline) and price/decide against it. (`project_book_eval_cost`, `project_model_stack_openrouter`.)
- **Monetization (directional, not committed):** the readable-book bar (O1) is the precondition for
  *any* paid tier — nobody pays to generate slop. Paid surfaces (`TODO: paid_books_plan.md`) come
  *after* the hypothesis clears for real books, not before.

---

## 8. Non-goals (what we are deliberately not doing)

- **Not a general chatbot / free-write tool.** Generation is leashed to structure. If we're tempted to
  "just let the model write," that's the failure mode we exist to replace.
- **Not maximizing prose volume.** A readable short book beats an unreadable long one. Read-through
  depth, not word count.
- **Not a craft tutorial.** The structure *does* the craft so the author doesn't have to learn it.
  Teaching story theory is a side effect at most.
- **Not editing-as-the-point.** If the author has to heavily edit to make it readable, the hypothesis
  hasn't been met — more editing tools won't fix a structural miss.

---

## 9. How to use this doc

- **Prioritizing?** Rank by act on §2 (read-through depth, generation ease, intuitiveness).
  Nothing else outranks the hypothesis.
- **Designing a screen?** Check §4 (which pillar?) and §6 (the seven rules).
- **Scoping a feature?** If it doesn't serve an objective in §5 or it lands in §8, cut it.
- **Disagreeing?** Argue against this doc explicitly, and if you win, change this doc — don't route
  around it.
```
