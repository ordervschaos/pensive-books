# DNA Studio — an analysis of its story-building method

**What this is:** a critical read of *how the DNA Studio builds a story* — the method, not the UI.
What's good, what's genuinely great, why it will produce a good story, where it will fall short, and
how to get the most out of it. Grounded in the actual engine (`supabase/functions/dna-expand/index.ts`,
`apps/web/src/lib/novelDna.ts`) and the design docs (`novel-dna-flow.md`, `-schema.md`, `-games.md`,
`dna-studio-system.md`, `sota-story-generation.md`, `can-i-generate-a-better-book.md`).

---

## 0. The method in one picture

```
  ┌──────────────── THE DNA TREE (book_nodes — the single source of truth) ───────────────┐
  │                                                                                         │
  │  BRIEF  ──derives──►  MANDATE (binding: heat/length/genre/success — VERBATIM)           │
  │  (root; raw idea      VOICE   (exemplar + narration)                                    │
  │   + settings)            │  injected into EVERY step below                              │
  │       │                  ▼                                                              │
  │       ▼  (refine raw idea → a real logline)                                             │
  │  seed (logline) → premise → pillar ──┬── (spine)  movement → [THREADS] → [GAMES] →      │
  │                     │            ══ GLOBAL BEAT SHEET ══ → scene → prose                │
  │                     └── (entities) character · world_fact · relationship ·              │
  │                                    tentpole · thread · game · location · voice          │
  └─────────────────────────────────────────────────────────────────────────────────────┘
                          │  render() — pure projection, no generation
                          ▼
  scenes (DFS order) → partition by chapter_start → [section page + text page] → the book
```

**The one idea:** a book is a *single self-similar tree* the author builds **rung by rung, coarse to
fine**, with four verbs at every depth — **expand · choose · edit · lock**. Higher rungs constrain
lower ones. The tree is the source of truth for *everything*; pages are a render.

**The brief is the beginning — the amateur entry point.** The brief is *promoted to the root of the
tree*: it is the origin everything derives from. It is deliberately **what an untrained author can
hand over** — a raw **premise** (just an idea, unpolished — "a detective who can't lie"), plus the
settings (genre, heat, length, tone, success criteria) that derive the MANDATE/VOICE injected into
every step beneath it. The brief still physically lives on `books.brief` (not in `book_nodes`, so it has
its own save path), but renders inline at the top of the tree and shows even before the tree is seeded
("the brief below is the origin — edit it, then seed the tree from it").

**Idea ≠ logline — and the system must not conflate them.** These are two different artifacts at two
levels of polish:
- **idea** (`brief.idea`) = the author's raw *idea* — "what is the book about?". Unpolished, partial,
  amateur-grade. This is brief input. *(Renamed from `brief.premise` to disambiguate it from the L1
  `premise` node — dramatic_question + shape. Migration `20260628120000`; readers fall back to the old
  `premise` key for safety.)*

  Note: **genre and tone are book-level contract fields on the brief** (they derive the MANDATE every step
  reads), not ladder content. They used to be duplicated onto the L1 `premise` node too, but nothing
  downstream read those copies — pure drift risk — so they were dropped from the premise rung (migration
  `20260628140000`). The brief is the single source for genre/tone; the premise node holds only the
  dramatic question + the 5-part shape.
- **logline** = a polished **1–2 sentence summary** that names the **protagonist, the inciting incident,
  the primary goal, the main obstacle, and the stakes**. This is a *structured craft artifact* — the
  system's first real value-add: it refines the raw idea into a proper logline.

> **Status: built.** Both halves are now in place. The brief carries the raw idea; the seed's `logline`
> is *generated* from it by a dedicated `dna-expand` step (`target: "logline"`) that fleshes the idea out
> into a one- to two-sentence logline naming protagonist / inciting incident / goal / obstacle / stakes —
> surfaced as the **"draft logline"** verb on the seed (DnaStudio). The brief→seed sync now only fills the
> logline when it's *empty* (a provisional starting point) and never clobbers a drafted/refined one, so
> editing the idea no longer overwrites the logline. The amateur supplies the spark; the first rung forges
> it into a real logline before anything downstream reads it. *(Mirrored in the dev bridge; edge deployed.)*

**Where it sits:** this is the third generation of the system. v1 was a heterogeneous stack
(`brief`/`foundations`/`spine`/`outline` columns). v2 was the "Build Studio". DNA collapses all of it
into one node store + one generation graph. Read `sota-story-generation.md` for the problems it's
reacting to.

---

## 1. The method, stage by stage (what actually happens)

| # | Step | What it produces | What it reads (context in) |
|---|---|---|---|
| 0 | `brief` (the root, **amateur input**) | raw **idea** (`brief.idea`) + settings → MANDATE/VOICE | — (author-supplied origin) |
| 1 | `seed` | a polished **logline** (protagonist · inciting incident · goal · obstacle · stakes) — *derived from the raw idea*, not equal to it | brief |
| 2 | `premise` (L1) | dramatic_question + 5-part shape (genre/tone live on the brief, not here) | seed + brief |
| 3 | `pillar` | controlling_idea + ending | premise + brief |
| 3a–e | entities | cast, world_facts, relationships, tentpoles, locations, voice_profile | pillar argument+ending |
| 4 | `movements` | acts: goal, **turning_point**, value, target_pct | pillar + cast |
| 5 | `threads` | **promise registry** {name, promise, payoff} | premise+pillar + **the whole arc** |
| 6 | `games` | possibility space {win/lose, governing_rules, couples} | arc + cast + world rules |
| 7 | **BEAT SHEET** | ALL beats at once: summary, connector, polarity, thread roles, needs/establishes, realizes, plays/resolves, grounds_in | **the whole sequence** + threads + games + tentpoles + cast |
| 8 | `scenes` | pov, present, goal/conflict/outcome, value_shift, inherited polarity + anchors | beat + cast + tentpoles + locations |
| 9 | `prose` | the words | scene + VOICE + MANDATE + idiolect + **prior-page digest** |

**One law of the flow** (`novel-dna-flow.md`): every step reads only *what is above it* + the
*registries* + *MANDATE/VOICE*. **Nothing reads forward.** A late payoff works because the *promise*
was registered as a thread at step 5 and handed to the beats/scenes that keep it — in reading order.

---

## 2. What is good

These are solid, correct decisions — table stakes done right.

- **One node, four verbs, at every depth.** Uniformity is the whole reason the system is tractable.
  The same `NodeCard`, the same `expand`, the same staleness machinery works for a premise and a
  scene. No special cases means no drift between layers.
- **Tree is the source of truth; pages are a render.** `reconcile(DNA) → pages` is a pure function
  (`structure-as-render.md` generalized). This kills an entire class of "the outline and the prose
  disagree" bugs. Edit a scene, re-render — the chapter boundaries, word counts, page indices all fall
  out for free.
- **Staleness is derived, not stored** (`src_hash = hash(input set)`). A stored dirty-bit drifts under
  concurrency; a content hash never does (the lesson from `multiresolution-outline.md`). Edit a node →
  its descendants compute as stale on read.
- **Locks as fixed points.** `lock(node)` = a hard constraint injected into every downstream `expand`,
  and a wall a `regenerate` sweep stops at. This is what makes regeneration *safe* — the author commits
  intent and it is never overwritten.
- **Progressive disclosure / approve-gates-expansion.** You can only `expand` a node whose parent is
  `accepted`. Cognitive load is front-loaded onto L2 (the human core — wound + lie + ending) and tapers
  to "voice corrections" at the leaf. The author is steered to spend attention where it compounds.
- **MANDATE carried verbatim (anti-launder).** Heat/length/genre are treated as a *contract*, not a
  vibe — injected unsoftened at every step. This directly fixes the documented failure where "explicit"
  → "the last pretense" → fade-to-black across three compressions (`brief-mandate-propagation.md`).
- **Live projection.** The studio subscribes to `book_nodes` over Realtime; any change from any source
  (agent rail, parallel tab, edge fn) re-projects. The UI is never fetch-once.

---

## 3. What is *great* (the differentiators)

These are the ideas that make this more than a prompt-chain — the reasons it can produce a genuinely
**good** story, not just a competent one.

### 3.1 Two edge types: the ladder vs. the reference graph
The tree has **parent edges** ("is composed of": pillar→movement→beat→scene — defines reading order &
render) *and* **reference edges** ("points at": scene→character, scene→thread, beat→game). This is the
key structural insight: **a payoff at a distance is a reference edge reaching forward in reading order**,
not a reordered beat. The setup scene and payoff scene both point at the same `thread`; the words
between them *are* the distance. This is how the system represents foreshadowing/mystery without
fragile page anchors that drift on reorder (the C7 flaw of the old stack).

### 3.2 The global beat sheet pass (the root fix)
This is the single best decision in the system. A first end-to-end run (book 1172) produced a 15-scene
unrelieved descent (`sagging_middle`) and a promise paid off but never set up (`unearned_payoff`). Root
cause: when beats were generated *per-movement* and scenes *per-beat*, **no step ever held the whole
sequence** while assigning thread roles or emotional polarity. They emerged from local decisions, and
emerged badly.

The fix is structural: **generate the entire beat sheet in ONE pass** that sees every movement and
every thread, so it can (a) schedule each promise's setup *before* its payoff and (b) plan polarity to
**oscillate** (never >3 same-polarity beats in a row). The general principle is the quotable one:

> **A property must be decided at the resolution where its whole scope is visible.** Parent-local
> generation is correct for the causal spine; sequence-level properties need a sequence-level pass.

### 3.3 Invariants, not just detectors
`enforcePromiseSchedule` is a *pure function* that **drops any payoff lacking a prior setup**. So
setup→payoff stops being something we *hope* the model does and becomes something it **cannot violate**.
The lints moved from detectors (complain after) to invariants (impossible to break). Same move with
tentpoles (each realized by ≤1 beat, first-claim-wins) and games (each resolved by ≤1 beat).

### 3.4 The causality axis (needs/establishes)
Each beat declares `needs` (state keys it depends on) and `establishes` (state keys it produces). The
rule: **every `therefore` beat must `need` at least one state an earlier beat `establishes`** — that
upstream dependency is what makes a turn *caused*, not "and then". This closes the episodic-drift
failure that plagued the old `objective-to-beat` (which never saw the preceding beat). Verified on book
1171: closed DAG, auto-fixed a dangling `redemption_fund` key. This is the deepest craft idea in the
system — it encodes *causation* as data, not prose.

### 3.5 Games = an explicit possibility space
A game forces a `win_condition` AND a `lose_condition` ("you can't win if you can't lose"). The climax
is then *one realized, legal path* through a defined space — not authorial fiat. The reader feels the
losses that loomed, so the win is earned. Multi-game **coupling** (one outcome voids/raises/enables
another) makes stakes *computable*. This is the formalization of "make the ending earned" that most
generators hand-wave.

### 3.6 Grounding (no deus ex machina)
World facts carry a `mechanism` (the *operable* rule). The climax beat **must** `grounds_in` an
established rule — the victory must be mechanically earned by a rule the reader already knows. Lester
Dent's law, encoded as a generation constraint + a lint.

### 3.7 The analytic layer reads the shape continuously
Three derived axes over scenes-in-reading-order — **pacing** (cumulative words vs. `target_pct`),
**promises** (open/closed tracking), **charge** (polarity oscillation) — emit lints continuously. These
are exactly what *Save the Cat* / Weiland / Story Grid / *Bestseller Code* measure by hand on a
spreadsheet, computed off the DNA instead. They're the conformance backstop for structure, the way the
mandate gate is for prose.

### 3.8 Prose context = digest, not verbatim dump
Prose generation gets a *compact digest* of all prior pages (rolling per-page recap + continuity ledger
+ anti-repeat blocklist) plus the single previous page tagged **voice-only**. The
`prose-context-experiment.mjs` finding: the verbatim previous page was the *top source of accidental
copying*, so its phrases go into the blocklist with an explicit anti-echo instruction. Net: fewer
echoes + higher continuity at ~⅓ the tokens.

---

## 4. Why it *will* produce a good story

Put the differentiators together and you get the four things that separate "reads as AI" from
"reads as a book," each structurally enforced rather than hoped for:

| Reader experience | What enforces it |
|---|---|
| **It hangs together** (causal, not episodic) | `needs/establishes` DAG + therefore/but connectors |
| **Setups pay off** (and in order) | thread registry + `enforcePromiseSchedule` invariant |
| **It doesn't sag** (emotional variety) | global beat sheet's oscillation rule + charge lint |
| **The ending is earned** (not arbitrary) | game possibility-space + `grounds_in` climax rule |
| **It delivers the brief** (heat/length/genre) | MANDATE carried verbatim, anti-launder |
| **Voice is consistent** | voice_profile node + exemplar in every prose call + per-scene register |

The deep reason it works: **it decides each property at the resolution where that property's scope is
visible**, and it **converts the craft rules of structural theory into invariants and lints** instead of
trusting a single prose model to "just write well." Most generators are one big prompt; this is a
graph with the right things factored to the right rungs.

---

## 5. Why it *won't* (the honest limits)

The system's own `sota-story-generation.md` names the meta-problem: **it is a single forward pass with
author-triggered revision bolted on. State-of-the-art output is not a better first draft — it is
loops.** Here are the specific gaps, ordered by how much each caps quality.

### 5.1 The plan is never pressured → the *modal story* problem ⭐ biggest ceiling
`dna-expand` generates each node as **ONE authoritative value** (see the code comment: "NOT 2–3
proposals to choose among"). There is **no candidate+judge, no best-of-n, no critique pass** before the
structure is committed and 40 prose calls render it. One sample from a formula-prompted model = the
*modal* story for that premise — and **the modal story is exactly what reads as AI.** The schema and
beat sheet guarantee the story is *well-formed*; nothing makes it *surprising-yet-inevitable*. A
perfectly causal, perfectly paid-off, perfectly oscillating story can still be the obvious one.

> The infrastructure to fix this exists (the old stack had candidate+judge for spine routes and
> beat-core). DNA dropped it for simplicity. This is the highest-leverage missing piece.

### 5.2 No closed eval→revise loop inside DNA
`generate-book`/autopilot expands down to prose and **stops**. The $0.33 "editor's read"
(`evaluate-book`), the mandate gate, and the durable-task chassis all exist — they are just *never
chained* to the DNA expand path. Write → eval → revise → re-eval is four built pieces with no pipe
between them. The agent rail can revise on request, but there's no automatic quality pressure closing
the loop. (This is M3 in the SOTA doc.)

### 5.3 Lints mostly *warn*; only a few are *enforced*
Enforced (invariants): setup→payoff order, single-claim tentpoles/games, causality refs resolve.
**Warn-only** (don't block, don't auto-fix): `dangling promise`, `pacing drift`, `sagging middle`,
`ungrounded climax`, `halfopen_game`, `unresolved_game`. So a book can render with a sagging middle and
a dangling promise — the system *sees* it but won't *act* unless a human reads the lint and regenerates.
The analytic layer is a great dashboard; it is not yet a control loop.

### 5.4 The causality DAG is shallow by construction
`needs/establishes` are free-text snake_case keys the model invents in one pass, then string-matched.
This catches "and then" drift (real win) but: keys can be *plausibly* satisfied without being
*dramatically* satisfied (a beat can `establish: trust_restored` in one limp line); the matching is
lexical, so `ledger_settled` vs `debt_cleared` won't link even when they should; and nothing checks the
*magnitude* of a turn, only its presence. It enforces *connectivity*, not *weight*.

### 5.5 One-shot generation at every rung compounds upstream error
Because no rung is sampled+judged, an off-key pillar or a generic premise flows down uncorrected. "Fix
at the highest stage that's wrong" (from `can-i-generate-a-better-book.md`) is the right discipline —
but the system relies on the *human* to notice and the *staleness graph* to propagate. There's no
automatic "is this premise actually any good?" gate. Errors at the top compound hardest and are checked
least.

### 5.6 Model tier complicties
The active tier is Qwen/DeepSeek via OpenRouter (`model_stack_openrouter`), chosen for cost. The docs
note cheaper tiers "may comply less with the MANDATE." The anti-launder design *mitigates* this, but
heat/voice/subtext are exactly where a weaker model degrades — and there's no per-call mandate re-check
on the DNA path to catch it.

### 5.7 Subtext & texture still rely on the prose model
Beats plan *what happens* (+ causality/polarity/threads). They do **not** plan "said vs. meant" or a
telling concrete image (M5 in SOTA — the old beat schema had hooks for this; DNA's doesn't carry them
into the beat sheet). So the prose renderer must invent subtext and texture from scratch — and stating
emotions on the nose is AI-tell #2. Voice is well-handled (exemplar + register); subtext is not yet
factored into the plan.

### 5.8 Foundations breadth ≠ depth
The system generates many entity kinds (characters, world_facts, games, locations, threads, relationships,
tentpoles). Breadth is good for coherence, but each is one-shot too. Over-seeding tentpoles/threads
then under-curating ("the model picks") is a documented failure (`can-i-...` §3). Without author taste
pruning the registries, the beat sheet schedules *everything*, and "great material silently dropped" or
"kitchen-sink" both become likely.

---

## 6. How to get the most out of it

The system is a **power tool for an editor-in-chief, not a vending machine.** Its strengths reward an
author who spends attention at the top and curates; its weaknesses punish "generate the whole thing and
read the output." Concretely:

1. **Spend your taste on the ★ human-core slots, early.** wound + lie (protagonist), controlling_idea +
   ending, the turning points + where they land, the mandate (heat/length/success). These are the slots
   the AI genuinely can't guess and where error compounds hardest (`-schema.md` §8). Get these right and
   lock them — everything downstream inherits them as hard constraints.

2. **Manufacture the variety the one-shot generator won't.** Because there's no best-of-n, *you* are the
   selection pressure. After expanding a rung, regenerate it 2–3 times and keep the least-obvious
   version, or edit the modal output toward something surprising, then lock. Do this hardest at premise,
   pillar, and the beat sheet — the rungs whose errors compound.

3. **Curate the registries before the beat sheet.** Pin the tentpoles/threads/games that *must* land;
   kill the off-brief ones; resolve near-duplicate causality keys. The global beat sheet schedules what
   it's given — a curated registry is the difference between a tight book and a kitchen sink.

4. **Read the lints as a to-do list, not a report.** Pacing drift, sagging middle, dangling promise,
   ungrounded climax are warn-only — the system won't act on them. Treat each amber lint as "regenerate
   this subtree" and re-check. This is the manual version of the eval→revise loop that isn't wired yet.

5. **Use locks + staleness as your version control.** Lock what you've blessed; let staleness (amber
   chips) show the blast radius before you regenerate. Regenerate from the *highest* stale rung, not the
   prose — fixing prose under a bad beat is whack-a-mole (`can-i-...` §4).

6. **Close the eval loop by hand.** After a full draft, run the mandate gate + editor's read, feed the
   critical findings back as edits/regens at the stage that first dropped the property (layer-trace),
   re-measure with the same tool. Until §5.2 is built, you are the pipe.

7. **A/B before concluding "it can't."** Most lost properties exist upstream and a framing/selection lost
   them. Hold context fixed, vary one lever, compare — don't regenerate ten times hoping.

---

## 7. The one-paragraph verdict

The DNA Studio is an unusually principled story generator. Its great ideas — the two-edge graph, the
global beat-sheet pass, causality as data, games as a possibility space, grounding, and an analytic
layer that reads structural theory off the tree — mean it can produce a story that **hangs together,
pays off, doesn't sag, and earns its ending**, with the brief delivered verbatim. That is already
better than the modal AI novel. Its ceiling is set by one architectural choice: **it is a single
forward pass of one-shot generations with no automatic quality pressure** — no best-of-n at the plan,
no closed eval→revise loop, lints that warn but don't act. So it reliably produces a *well-formed,
coherent, on-brief* story, but not yet a *surprising* one — the modal story, told correctly. The fix
is loops, and the chassis for loops already exists; it's wiring, not new infrastructure. Used as
designed — an editor-in-chief curating the top rungs and supplying the selection pressure the engine
omits — it will produce a genuinely good book. Run as a one-click vending machine, it will produce a
competent one.
</content>
</invoke>
