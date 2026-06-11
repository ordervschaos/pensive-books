# Design — author-directed outline authoring (serial, with a fill-the-rest lever)

Status: **DESIGN AGREED, NOT BUILT. Parked 2026-06-11.** A handover for a future build session.
Companions: `docs/ai-build-flow-redesign-brief.md` (vision), `docs/ai-build-flow-redesign-handoff.md`
(code map of the AI build surface), `docs/sota-story-generation.md` (master roadmap),
`docs/multiresolution-outline.md` (the ladder/dirty-graph this extends).

---

## 1. The problem (what prompted this)

The resolution ladder is `brief → spine → outline(per-page objectives) → beat → prose`. Today the
**outline step generates an objective for every page in one shot** (`spine-to-objectives`, with a
draft→critique→revise loop, so the objectives are mutually coherent). Then beats are picked serially
underneath that frozen grid.

The author's complaint: **the outline is rigid.** Objectives are a contract written *before any beat
is chosen*, and every beat is told to "fulfil the page's objective exactly" (`beat-core.ts`). So:

- The objective is a **rail** — a beat choice can decorate a page but cannot redirect the story.
- If a chosen beat diverges from what a later page's frozen objective assumed, **the objective wins**,
  silently snapping the story back to the planned line.
- Nothing tracks this: provenance edges (`spine_objective`, `objective_beat`, `beat_prose`) are all
  *within-page*. There is **no cross-page consistency edge** — divergence is invisible.

The author wants to **direct the story early**, at the outline, not just decorate pages later.

## 2. The core tension

Two ways to build an outline, each with one half of what's wanted:

- **One-shot** (today): plans the whole book at once → has natural **rhythm** (it knows it's writing a
  beginning/middle/end and paces toward a climax) but gives the author **zero say** until it's done.
- **Pure serial** ("what's the next page?", author picks each): gives **control from page one** but the
  generator has **no sense of position**, so nothing pulls toward an ending — it writes rising action
  forever. "The story might never end" is the literal failure mode. Loses **rhythm**.

You don't pick one. You get both by **separating two things the one-shot outline fuses**: the *shape*
(rhythm — global, cheap) and the *content* (the actual scenes — where authorial direction lives).

## 3. The agreed model — one serial engine, one lever, over a fixed shape

### 3a. Pin the shape first (new rung)
A cheap, one-shot, author-approved **arc/shape** artifact: target length + act structure + where the
turning points fall as fractions of the whole (inciting incident ~10%, midpoint ~50%, climax ~85%,
resolution ~100%). This is a **beat sheet / pacing template** (Save the Cat, three-act, Hero's Journey
are all exactly this — a normalized "where the turns belong" map).

The shape is **load-bearing**: it is the **convergence pressure** that stops the never-ending story
(it always knows the climax must land by ~85%), and it makes *both* the per-slot takes *and* the
fill-the-rest batch produce rhythm. The whole-book critique that today guarantees coherence moves *up*
into this rung; the page level becomes author-driven.

Ladder gains a rung: `brief → spine → SHAPE/ARC → outline(serial) → beat → prose`.

### 3b. Then build the content serially — one engine with two moves per slot
Walk the outline slot by slot. At every slot the author has two moves:

- **Pick & continue** — choose one storyline (from 3 position-aware takes, or write their own), advance
  one slot.
- **Fill the rest** — batch every remaining slot in one shot, position-aware, grounded on everything
  committed so far.

The two "modes" we'd been treating as rivals are just the **ends of one continuum**:

```
Fill the rest @ slot 0  ───────────────────────────────►  Pick & continue ×N
  (= today's one-shot)        the author lives here            (fully hand-authored)
                         pick ch.1–3 to aim the story,
                         Fill the rest, revise ch.12 later
```

Implications:
- **One system, not two.** "Batch" = "fill from here to the end." One-shot stops being special — it's
  the lever pulled at slot 0. This is the existing `SerialBeats` pattern lifted one rung up, with the
  existing one-shot scaffold (`spine-to-objectives`) becoming the **Fill-the-rest** button.
- Every per-slot take is **position-aware**: generated knowing arc phase + runway ("you're at 28% of
  ~40 pp, rising, ~6 pp to the midpoint — propose the next scene serving this phase"). The three takes
  are therefore all **rhythm-valid**; the author directs among options the shape has vetted for pacing.

```
ch.1 ✓  ch.2 ✓  ch.3 → [ ① ]  [ ② ]  [ ③ ]   ·· or ··  [ Fill the rest ▸ ]
                         each take is position-aware       batches 4..N, grounded on 1–3
```

### 3c. Granularity — author's choice, fatigue-proofed
The author may pick slot by slot (even ~40 times) **if they enjoy it**, OR press **Fill the rest** at
any point to auto-complete the remainder. We assume some authors will genuinely enjoy hand-picking
each storyline and revising as they go. The Fill-the-rest lever is what makes fine granularity
non-punishing — it's always one click to stop picking.

## 4. Two consequences — RECOMMENDED, NOT YET CONFIRMED BY THE AUTHOR

These two fell out of the model and were proposed with a recommendation; the author parked the design
before explicitly confirming. **A build session must confirm these before implementing.**

1. **Revise-as-you-go ripples forward.** This is the original rigidity problem, now at the outline. If
   the author revises ch.3 *after* committing ch.4–12, those were built on the old ch.3.
   **Recommendation:** mark the downstream slots **stale** and **offer "re-fill from here"** — do NOT
   silently rewrite them (that yanks work out from under the author). "Re-fill from here" is the same
   Fill-the-rest batch, started mid-book. Author stays the showrunner; the system flags drift and
   offers the redo. → Needs a **new forward/sibling dependency signal** (none exists today; provenance
   is within-page only).

2. **Slots are a flexible target, not a hard count.** Rhythm needs a total length to compute position%
   and runway, so the **shape sets a *target* slot count** — a flexible scaffold of empty slots. A pick
   can still split / merge / resize a slot (the author bends the pacing), and the runway recomputes. The
   story *can* run long if they keep complicating, but the shape keeps *showing* them they've drifted
   past the climax mark. Soft guidance, never a jail (matches the brief's "guided but not jailed").

## 5. Implementation surface (for the build session — reuse, don't fork)

What exists to lean on:
- `supabase/functions/_shared/beat-core.ts` — the **serial pattern to mirror one rung up**: `prepareBeat`
  / `sampleBeats` / `beatCandidates` (un-judged takes), reads `precedingBeat` for causal grounding. The
  outline engine is the same shape: candidates grounded on the committed prefix + the shape/position.
- `apps/web/src/components/book/SerialBeats.tsx` — the **client serial-pick UI to mirror**: walk
  ordered slots, draft 3 takes, pick/edit, save, advance; `reqRef` stale-guard; resume at first gap.
  The outline version adds the **Fill-the-rest** button and a **"you are here on the arc"** indicator.
- `supabase/functions/spine-to-objectives/index.ts` — today's one-shot scaffold (draft→critique→revise).
  Becomes the **Fill-the-rest / re-fill-from-here batch**; must learn to take a committed prefix +
  start index + the shape, and pace the remainder toward the ending.
- `apps/web/src/lib/ladder.ts` — add `transforms.objectiveCandidates` (mirror `beatCandidates`) and
  reuse `saveObjective`. Add the dual-backend route in BOTH `objective` edge fn and
  `scripts/eval-bridge.mjs` (bridge is long-lived, NO auto-reload — restart after route changes).
- `supabase/functions/revise-outline` (planOnly mode) — already rewrites objectives + structure and
  flags pages stale. This is the muscle behind **re-fill-from-here**; wire it to the serial engine.
- Provenance: `src/lib/planProvenance.ts` ↔ `_shared/plan-provenance.ts`. For consequence #1 you need a
  **new cross-slot/forward edge** (e.g. each objective records the prefix hash it was generated under),
  so revising an early slot can mark later slots stale. This is net-new.

What's net-new:
- The **SHAPE/ARC artifact** — no equivalent today. Where it lives (extend `books.spine`, or a new
  `books.arc` jsonb) is an open call. It stores target length + act breaks + turning-point positions.
- **Position/runway math** — derive "X% · phase · N pp of runway" from shape + committed slots, surfaced
  in the picker and fed into every candidate/batch generation prompt.
- The **Fill-the-rest / re-fill-from-here** operation as a first-class, resumable action.

Studio wiring: the outline step in `JourneyStudio.tsx` (`StepPanel` `k === "outline"`) currently renders
`ScaffoldGenerator`. It would render the new serial outline component (mirroring how the beats step
renders `SerialBeats`). Derived `ready.outline` stays computed from real pages.

## 6. Open questions a build session must resolve
- Confirm the two §4 consequences with the author.
- Where the SHAPE artifact is stored, and whether it's its own ladder step/gate or folded into spine.
- Slot granularity unit at generation time (scene vs page vs chapter) and how slots map to `pages` rows
  (today the scaffold *creates* the pages; serial must create/fill slots incrementally against a target).
- How the position-aware prompt is phrased; whether takes lean differently (advance / complicate / linger).
- Author-fatigue + cost telemetry: 40 serial calls vs one batch.

## 7. One-paragraph summary for whoever picks this up
Make the outline author-directed without losing rhythm. Add a one-shot **shape** rung (acts +
turning-point positions + target length) that supplies convergence pressure. Then build the outline
with **one serial engine**: per slot the author can **Pick & continue** (choose 1 of 3 position-aware
takes, or write their own) or **Fill the rest** (batch the remainder, grounded on the committed prefix).
One-shot is just Fill-the-rest at slot 0; fully-hand-authored is Pick ×N; real authors mix and revise.
Reuse the `SerialBeats` + `beat-core` serial pattern and `spine-to-objectives` as the batch. Revising an
early slot should flag later slots stale and offer "re-fill from here" (needs a new forward-dependency
signal). Slots are a flexible target from the shape, so pacing can bend but the climax mark still pulls.
