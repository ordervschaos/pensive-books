# Novel DNA — the meters pillar (numbers on the story you can plot)

**Status:** Phase 1 SHIPPED — the `meter` entity + `readings` field + the pure horizontal engine
(`meterSeries`/`meterShape`/`isSerialMeter` + the `flat_meter`/`no_oscillation`/`no_jeopardy` lints in
`novelDna.ts`), the schema (`dnaSchema.ts` `meter` kind, `readings` on beat/scene, new `number` field type),
the regenerated `dna-schema.json` artifact (so the reviser + bridge learn the keys), and the **Meters
dashboard** at `/books/:slug/dna/meters` (`DnaMetersPage` — lists all meters, plots the serial ones).
REMAINING (Phase 2, §5b–§7): the vertical fulfillment cascade / fit scores (an eval-pass concern) and the
`gameScoreFromResolves` auto-derivation. Companion to
`novel-dna-schema.md` (the fields), `novel-dna-flow.md` (generation order, the CHARGE row), and
`novel-dna-games.md` (a game-score is one meter). Motivated by: *"if we put numbers on what we manage,
we can plot multiple graphs — a game's score, a character's happiness, heat, comedy — multiple per-node
metrics over reading order."*

## 1. The idea

A story is already a set of quantities that move: how free the hero is, how close a game is to being lost,
how hot a pairing runs, how funny the page is. The DNA encodes these **qualitatively** today —
`movement.value {from,to}`, `scene.value_shift {polarity}`, `beat.polarity (up|down)`, a `game`'s two poles.
A **meter** is the same thing made **numeric, named, and bounded**, so the trajectory is *computable and
plottable* instead of a feeling.

A meter is **one axis** (comedy, heat, freedom) that exists at *every resolution of the ladder*, not only at
the leaves. It has **three lives**, and the earlier instinct to file "horizontal plot" and "vertical fit" as
two separate families was wrong — they are two *views of the same meter*:

- **TARGET (top — set once).** The mandate sets it: `comedy=90` is a genre need carried verbatim, exactly
  like `heat` already is in `novel-dna-flow.md`'s MANDATE. This is the number the whole book is built toward.
- **FULFILLMENT (every rung — vertical, the eval loop).** As resolution descends, each level is checked for
  whether it *can and does* serve the target: does the **logline** allow a 90-comedy story? does the
  **premise** enable it? do the **beats** set up the runs/payoffs? are the **scenes** actually funny? does
  the **prose** land the jokes? This descending fulfillment cascade **is the eval loop** (§5c).
- **TRAJECTORY (leaf — horizontal, the plot).** At beat/scene the meter becomes per-node `readings` you plot
  as a line over reading order (§3–4).

```
  ONE METER (comedy=90), THREE LIVES

  TARGET   mandate: comedy = 90 ───────────────┐  (the number to hit)
                                                │
  FULFILL  logline  allows it?      ─ fit 0.9 ──┤  vertical cascade
   (each   premise  enables it?     ─ fit 0.8 ──┤  = THE EVAL LOOP
    rung)  beats    set it up?      ─ fit 0.7 ──┤  (each rung serves
           scenes   funny?          ─ fit 0.6 ──┤   the parent target)
           prose    delivers?       ─ fit 0.5 ──┘
                                                │
  TRAJECTORY  per beat/scene readings ──────────┘
   100│  ~~~comedy~~~~~╮   ╭~~~~~      plotted along the spine
     0│ ╭~╯           ╰~~~╯
       └──────────────────► beat#
```

### Two classes of number — never trade one for the other

- **METERS = objectives.** You *optimize toward* a target; they legitimately trade off (more comedy may cost
  tension). A meter at 70 vs 90 is "better/worse," a dial.
- **HEALTH = non-negotiable constraints.** Coherence, causality (`needs`/`establishes` closure),
  completeness, `dangling_ref` — already in `dnaSchema.ts`/`novelDna.ts`. These are **pass/fail gates**, not
  dials. You never sacrifice causal closure to buy comedy.

The DNA build is therefore **constrained optimization**: *maximize meter-fit, **subject to** health = true.*
Health gates first; meters are scored only on a structurally sound tree.

## 2. The `meter` entity (a new entity kind off the pillar)

Same node envelope as the other entities (character/game/thread). Defined **once at book level**, off the
`pillar` (it is a property of the whole story, like the controlling idea). Referenced by readings.

| field | type | fill | meaning |
|---|---|---|---|
| name | string | ★/A | short handle (readings reference it) — e.g. "Mara's freedom", "the contract", "heat" |
| kind | `value \| game_score \| affect \| relationship \| heat \| comedy \| tension \| custom` | U | what flavor of quantity this is — drives default scale, lints, and plot color |
| scale | `{ min:number, max:number }` | A | numeric bounds. Convention: `value`/`game_score`/`heat`/`comedy`/`tension` = `0..100`; `affect`/`relationship` = `-100..100` (signed: despair↔hope, cold↔hot) |
| owner | `ref→character \| game \| relationship` | A | OPTIONAL. An owned meter belongs to an entity (Mara's hope, the contract's score). Unowned = book-global (the controlling value, comedy register) |
| poles | `{ low:string, high:string }` | A | the *meaning* of the ends in prose — `game_score` low/high are the lose/win conditions; `affect` low/high are "despair"/"hope". Makes a bare number legible |
| target | `[{ at:number, value:number }]` | A | OPTIONAL the **planned curve**: meter value at given word-% checkpoints. The shape generation aims at (§5). Sparse — a few anchors, not every beat |

**The controlling value is the one required meter.** Every story has exactly one global `value` meter (the
McKee controlling value — freedom, justice, trust). It is `movement.value` promoted to numeric and book-wide.
Everything else (games, affect, heat, comedy) is optional richness.

## 3. The `readings` field (on beats/scenes — the points)

A turn reports where each relevant meter *stands at that turn*. Scenes inherit from their beat and may refine
(same pattern as polarity/thread anchors). This is `scene.value_shift` generalized: from one qualitative
shift to many numeric levels.

| field on beat/scene | type | meaning |
|---|---|---|
| readings | `[{ ref→meter, value:number }]` | the level of each meter AT this turn (a y-value at this x). Absent meter = unchanged from the prior reading (carry-forward, like a sample-and-hold) |

A reading is a **level, not a delta** — the absolute position, so a plot reads directly and a gap means
"held," not "zero." The delta (`Δ` between consecutive readings) and its sign are *derived* (§4) — that
derived sign is exactly today's `beat.polarity`, which numeric readings subsume.

```
  beat#7  readings: [ {ref: freedom, value: 30}, {ref: contract_game, value: 20},
                      {ref: mara_hope, value: -40}, {ref: comedy, value: 10} ]
                              │
                  one point on each of four lines
```

## 4. Derived: the meter series (never stored — pure functions over the spine)

Computed off the beat/scene order + readings; nothing new persisted. Single-meter / no-reading stories
simply return empty (no penalty).

- **`series(meterId)`** — the ordered `[{ x: wordPct|beatIndex, y: value }]` for one meter, carry-forward
  filling gaps. This is what a chart plots.
- **`delta(meterId, i)`** / **`polarityOf(beat)`** — `sign(series[i] − series[i−1])`. Reproduces
  `beat.polarity` from numbers; the authored polarity becomes a redundant convenience, not a source of truth.
- **`gameScoreFromResolves(game)`** — a `game_score` meter is auto-anchored from the spine: any beat that
  `plays` the game nudges toward contested (≈50 ± move), a `resolves: won|lost` snaps it to `poles.high|low`.
  So games get a score for free from data already in `novel-dna-games.md`.
- **`shape(meterId)`** — summary stats for lints: range used, # of direction changes (oscillation),
  longest flat run, terminal value.

## 5. What the numbers unlock

This is the payoff — the flow doc's CHARGE row ("emotional topography… *Bestseller Code* charge measure,
computed off the DNA continuously") becomes real, multi-dimensional, and **enforceable**.

### 5a. Shape lints (diagnostic — pure, cheap, run continuously)

| lint | fires when | why it matters |
|---|---|---|
| `flat_meter` | a meter holds within ε for ≥ N consecutive beats | dead stretch — nothing moves |
| `no_jeopardy` | a `game_score` meter never comes within δ of its losing pole | soft climax — the win was never in doubt (the games-doc thesis, now measurable) |
| `no_oscillation` | a meter's direction-change count over an act is below threshold | monotone charge — the flow doc wants polarity to OSCILLATE |
| `unearned_jump` | `|Δ|` exceeds a threshold with no setup beat (`establishes`) upstream | continuity fault — heat/hope spiked from nowhere |
| `flatline_relationship` | an `owner=relationship` meter never moves | the dyad is inert; `relationship.charge` is decorative |
| `unresolved_at_end` | a `game_score` ends mid-range (not at a pole) | the central game never decided — no climax |

### 5b. Generation constraints (the same promotion causality got)

Causality went from a post-hoc check to a generation *constraint* (`needs`/`establishes` state keys the
beat generator must satisfy). Meters do the same: `meter.target` is a **target curve** the beat planner aims
at. "Take `freedom` 30→70 across movement 3 with at least one dip below 20" is an instruction, not a wish.
The beat sheet assigns `readings` to hit the anchors — the same global pass that schedules threads, polarity,
and games.

### 5c. The eval loop = the vertical fulfillment cascade (closes the ceiling in `dna-studio-analysis.md`)

This is the core. A meter target set at the top is **checked for fulfillment at every descending resolution**
— each rung must serve the parent's number, or the drift is localized to exactly the rung that dropped it.
The eval loop is this cascade run on every meter:

```
  meter target: comedy = 90        question asked at each rung               fulfillment
  ───────────────────────────────────────────────────────────────────────  ───────────
  seed / logline   does the premise/logline even ALLOW a 90-comedy story?     enables? 0..1
  premise.shape    does the dramatic question / 5-part shape make room?       enables? 0..1
  pillar           is comedy in the controlling idea's register at all?       enables? 0..1
  movements/beats  do the beats SET IT UP — comic runs, reversals, payoffs?   sets up? 0..1
  scenes           is each funny scene's goal/conflict/outcome actually comic? delivers? 0..1
  prose (render)   do the jokes LAND on the page?                             delivers? 0..1
```

Each rung returns a 0..1 **fulfillment score** for the meter — "does this level enable / set up / deliver the
target." The score is highest-meaningful at the leaves (`target` = planned curve vs judge-read **actual**
curve; the gap is the quality signal) and a capability/consistency check higher up ("a logline about a
funeral cannot host comedy=90 — fail at the top, don't waste a draft"). Two payoffs:

- **Early failure.** A target that the logline can't host is caught before any beats are generated — the loop
  fails *up the ladder*, cheaply, instead of discovering flat prose at the end.
- **Localized drift.** comedy fulfilled at logline/premise/beats but collapsing at scenes pins the fix to the
  scene rung — you regenerate scenes, not the whole book.

§6 says who sets each rung's number (derived / planner / judge).

## 6. Who sets the numbers (the one real fork)

Three sources; the system wants all three with a clear default per stage:

| source | sets | trust | role |
|---|---|---|---|
| **derived** | `game_score` from `resolves`; polarity from Δ | high (it's just data already there) | free, always-on |
| **AI / plan** | `target` curve + planned `readings` at beat time | medium (AI grading its own plan) | the **intended** shape |
| **judge** | actual `readings` from reading the prose | highest, costliest | the **verification** pass |

**Default:** derive where the structure already implies it · let the planner declare the *target* · let the
judge measure the *actual*. Quality = `actual − target`. Authors can pin any reading by hand (it becomes ★,
locked against regeneration), same as any other slot.

## 7. Fit = per-rung meter fulfillment (not a separate family)

The earlier draft treated "fit" as its own vertical family of generic derivation-coherence scores. The §1/§5c
reframe collapses it: **fit is the per-rung fulfillment score *of a meter*** — the 0..1 each resolution
returns for "does this level serve the parent's target." There is no free-floating "does child honor parent"
number divorced from a meter; coherence-as-such is a **health gate** (§1, non-negotiable), and everything
optimize-able is a meter being fulfilled (or not) at that rung. So the matrix is:

```
              comedy   heat   freedom(value)   tension     ← meters (objectives)
  logline      0.9      —         0.8            —
  premise      0.8      —         0.9           0.7
  beats        0.7     0.6        0.8           0.8
  scenes       0.6     0.5        0.7           0.7
  prose        0.5     0.4        0.6           0.6
            └── each cell = that rung's fulfillment of that meter ──┘
  (coherence / causality / completeness are NOT columns here — they gate the whole grid)
```

A column read top-to-bottom is the eval-loop cascade for one meter (§5c). A row is "how well this rung serves
all targets." Drift shows as the cell where a column drops.

## 8. Migration (how small the delta is)

The meters layer is mostly **generalizing two fields that already exist**, not green-field:

- `movement.value {name,from,to}` → the global `value` **meter** (numeric, book-wide, with `target` anchors).
- `scene.value_shift {value,from,to,polarity}` → `readings: [{ref,value}]` (numeric, multiple, levels).
- `beat.polarity (up|down)` → **derived** `polarityOf(beat)` = `sign(Δ value)`. Authored polarity retained as
  a convenience/override but no longer the source of truth.
- `game.win_condition`/`lose_condition` → a `game_score` meter's `poles`; the score auto-derives from
  `plays`/`resolves`.
- `relationship.charge` (prose) → optionally dialed by an `owner=relationship` meter.

Code touch-points (no edge change needed for the data model):
- `dnaSchema.ts` `NODE_SCHEMA` — add `meter` kind; add `readings` (genOnly, structural — the reviser sets it)
  to `beat`/`scene`. `KIND_LEVEL.meter = 2` (off the pillar, like `game`).
- `novelDna.ts` — `PARENT_KIND.meter = pillar`; the derived `series`/`shape`/`gameScoreFromResolves` pure
  functions + the shape lints (alongside the existing causality/dangling-ref lints).
- `DnaStoryMap`/a new chart view — plot `series(meter)` for each meter; one line each, x = word %.
- The dna-schema artifact + dev bridge mirror — regenerate so the reviser learns the new keys.

---

**One-line summary.** A *meter* is one named bounded axis (comedy, heat, freedom) with three lives: a
**target** set by the mandate at the top, a **fulfillment** check at every descending rung (the eval loop —
does logline allow it → premise enable → beats set up → scenes deliver → prose land), and a leaf-level
**trajectory** of `readings` you plot. Meters are *objectives you optimize*; coherence/causality/completeness
are *non-negotiable gates* — the build is constrained optimization: maximize meter-fit subject to health =
true. It unifies `value`/`value_shift`/`polarity`/game-poles and the mandate's numeric dimensions into one
plottable, vertically-enforceable layer.
