# True Agent — Pensive Studio as a writer/editor with taste

> Status: design / north-star for the agent layer. Supersedes nothing; it names the
> homes for the "agent" ideas across the existing DNA stack. Companion docs:
> [`sota-story-generation.md`](./sota-story-generation.md) (loops + human gates),
> [`agent-rail.md`](./agent-rail.md) (one tool-using thread),
> [`dna-studio-analysis.md`](./dna-studio-analysis.md) (named the missing eval loop),
> [`novel-dna-meters.md`](./novel-dna-meters.md) (the planned emotional trace),
> [`novel-dna-spec.md`](./novel-dna-spec.md) / [`novel-dna-schema.md`](./novel-dna-schema.md) (the tree).

## Implementation status

- **Step 1 (plan-vs-intent, pure) — shipped.** `meterTarget` + `targetGap` + `target_drift` lint in
  `novelDna.ts`; target curve overlaid (dashed) on `DnaMetersPage`. No model cost.
- **Step 2 (observed-vs-plan, the read) — shipped.** Two decisions diverged from the sketch below:
  - **Separate beat-segmented read, NOT piggybacked on `evaluate-book`.** That read is page-segmented and
    cites page ids; meters are beat-keyed. So `read-meters` (edge fn + dev bridge route) reads a
    beat-segmented manuscript (each beat = its scenes' prose) and emits one reading per (beat, meter).
  - **Stored ON-NODE** as `beat.content.observed_readings` (parallel to authored `readings`) — the tree
    stays SSOT; `observedSeries`/`observedGap`/`read_gap` derive the 3rd (dotted) trace + lint. Context cost
    is neutralized: `revise-agent` reads the derived `analysisText` (never raw readings); `dna-chat` strips
    `observed_readings` like it already strips `prose` (output data, not plan input).
  - **Manual gate:** "Read the emotional trace" runs the read; "Send gaps to editor" hands the `read_gap`
    findings to `revise-agent` (free-text path) and jumps to the tree's AgentRail. `lib/meterRead.ts` is the
    client orchestrator.
- **Step 3 (granularity policy + loop closure) — not started.**

## Thesis

**A story is a bunch of choices you make.** This is already literally true in the model:
the DNA tree *is* the choice tree. Premise, cast, each relationship-game, each beat —
every node is a choice plus its reason. The agent's whole job is:

1. make those choices well (generate), and
2. verify they still cohere with each other and with the contract (verify).

World-building is just choices made earlier in the tree that constrain the later ones —
"after the promise is set, it goes and builds a world."

## The reframe: pipeline → agent is the eval-loop fix

Generation today is a **pipeline**: filter context → emit all beats at once (macro), or
emit prose for a scene (micro). `dna-studio-analysis.md` named the ceiling of that:
*one-shot modal story, no eval loop.* The "true agent" **is** that eval loop — the thing
that closes generate → verify → revise.

The "personality / skill level" framing is only useful if it cashes out as **function**:
an editor's skill level maps to *which craft-knowledge tier is loaded and how strict the
rubric is* (we already have tier-1 immutable craft + tier-2 editable `craft_notes`), not
just tone. A "senior editor" loads more craft and fails more findings. That keeps
personality honest.

## Generate and verify are duals

The hard question is *when verifying, what context do you use?* It's the reverse of
generation:

- **Generate**: filter relevant DNA → emit text.
- **Verify**: take the emitted text → ask "what DNA was this supposed to satisfy?" →
  load *exactly that slice* → judge.

Why this is tractable in Pensive and not in a generic writing tool: **the contract is
machine-readable.** A beat's contract is its causality edges (produces/consumes state
keys), its function, and the meter targets at its position. So verifying a beat = "does
this prose still close the `therefore` it promised, and does its observed tension land
where the meter said it should." You don't *guess* the verification context — the node's
own DNA edges **are** the context. That's the payoff of having made causality and meters
into data.

## The experiential read = observed trace vs planned trace

The editor "reads start to end and notices the emotions felt." That read produces an
**observed** emotional/tension curve. We already have the **planned** curve — that's what
the meters pillar is (comedy / heat / tension as plottable axes).

So an editorial finding is not a vibe; it's a **diff between two traces**: where the
reader-felt curve departs from the authored meter line is precisely where a beat isn't
serving its purpose.

```
planned   ╭───────╮          ← meters pillar (authored target)
tension  ╱         ╰──╮
        ╱             ╰───
observed ───╮     ╭────       ← editor's read output
(felt)      ╰─────╯
            ^^^^^^^            ← GAP = the work list (beat reads flat)
```

The editor's read (the expensive ~$0.33 op) outputs a meter trace; overlay it on the
planned one; the gaps are ranked findings. This turns "experience the book" into a
measurable, re-runnable artifact.

## Macro vs micro: a granularity policy (cost-forced)

The full read is expensive, so the agent can't run it on every micro-edit — and shouldn't.
Map it to the macro/micro distinction:

- **Micro ops** (prose from a scene, scene from a beat) verify *locally*: against immediate
  neighbors + the node's own DNA edges. Cheap, runs often.
- **Macro ops** (act complete, book complete) trigger the **full experiential read** +
  trace diff. Rare, deliberate.

The loop needs a **stop condition** or it thrashes. Build → verify → revise converges to a
**taste gate** (reuse the human gates from `sota-story-generation.md`), not spin.

## Agent modes

The all-capable agent has a small set of operations, each with a generate side and a
verify side:

| Mode | Generate | Verify (reverse) |
|---|---|---|
| Beats | beats from foundation (macro, all at once) | beats vs premise/promise + causality DAG closed |
| Scenes | scenes from a beat | scenes deliver the beat's function + state changes |
| Prose | prose from a scene | re-render → does it serve the genre/voice contract + meter target |

Build flow it runs autonomously (milestone-gated): plan foundation → write act → expand
beats → render first prose → verify prose against contract → revise → gate.

## World / cast / relationship — a DNA *content* extension, not a new system

Everything is `book_nodes` (the self-similar tree). So:

- **Characters** = a node kind. Each carries *why it was cast* — the choice and its reason
  tied to genre/premise. "Casting to win a world" means a character node references the
  contract it exists to serve. Cast is deliberate: for a couple, the male/female,
  appearance, age are *choices* because they decide how the pair reacts to each other.
- **Relationships** = typed edges between character nodes, with the **game** named
  explicitly (opponent / teacher / playmate). The existing game-score meter rides on these.
  Some links are kept hidden/weak (butler ↔ enemy's butler) — focus on the load-bearing few.
- **The Obsidian-style graph is a render of that edge set** (exactly like pages are a render
  of the outline). Visual encoding contract:

  | Relation | Encoding |
  |---|---|
  | Enemy (mutual hostility) | two red arrows |
  | Mutual friend | two green arrows |
  | Asymmetric (A friend of B, B hostile) | green A→B, red B→A |
  | In love | pink (overrides green on the in-love direction) |
  | Hidden / incidental | low edge weight → longer & fainter |

  Edge **weight** drives length: load-bearing relationships cluster tight; incidental ones
  drift to the rim. Direction + color encode the game.

Tradeoff: the world/cast/graph layer is *new content schema + a new UI surface*. The
verify loop is *new behavior over data we already have*. Two different first bites.

## Sequencing

1. **Verify loop first.** Behavior over existing data, lowest new surface area, highest
   signal — it gives the agent *taste* before we give it more to build. Concretely: one
   editorial pass that takes current beats/prose, produces an observed meter trace, diffs
   it against planned meters, and emits ranked findings ("beat 14 promises rising tension,
   reads flat").
2. **World / cast / relationship-graph layer second.** Richer feature, bigger build
   (schema + graph UI), and it benefits from the verify loop existing — casting choices can
   then be *verified* against the genre contract instead of merely asserted.

## Open questions

- Skill/personality: how many editor tiers, and exactly which craft + rubric strictness
  each tier loads?
- Trace representation: is the observed meter trace per-beat, per-scene, or continuous?
  (Determines diff granularity and read cost.)
- Termination: what's the taste-gate criterion that ends a revise loop vs. escalates to a
  human gate?

## Out of scope (separate track)

Pre-launch / marketing campaign — "do something bigger, pick a launch day, pre-launch
energy matters." Tracked elsewhere, not part of the agent build.
