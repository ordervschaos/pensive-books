# Structure Miner — closing the DNA loop by mining prose for missed structure

> Status: PLAN (2026-07-08). Not built.
> Companions: [`true-agent.md`](./true-agent.md) (generate↔verify duality, trace-diff),
> [`novel-dna-meters.md`](./novel-dna-meters.md) (the first mined axis, done by hand),
> [`dna-studio-analysis.md`](./dna-studio-analysis.md) (named the missing eval loop).
> Reference corpus: book **1229** "Mastering Freedom v3" (dev), a finished book for the real run.

## 1. Where this sits (placement)

The DNA stack has three verify legs today, all aimed at **known** axes:

| Leg | Question | Code |
|---|---|---|
| Lints | does the *plan* obey its own rules? | `validate()` in `novelDna.ts` |
| Meter read | does the *prose* deliver the planned emotional curve? | `read-meters` → `observed_readings` |
| Fact ledger | does the *prose* contradict planned state? | `read-facts` → `observed_establishes` |

All three can only check structure we already have a name for. The Structure Miner is the
**fourth leg: discovery** — read finished prose and ask *"what structure is in here that no
DNA node kind, meter, or scene field currently encodes?"* Its output is not a fixed score;
it is **new candidate axes** — future meters, lints, and scene fields.

**Architectural terms in play:** closed-loop control (output feeds back into the system that
produced it), *system identification* (inferring a system's internal model from its observed
output), *residual analysis* (study what the current model *fails* to explain), *MDL /
minimum description length* (the best model is the one that compresses the data most),
*feature induction* (deriving new features from data instead of hand-designing them), and a
*self-modifying harness* (the run rewrites its own instrument set between iterations).

## 2. The thesis — compression IS the quality bar

The stated tension — "as detailed as possible AND as compressed as possible" — is exactly
the MDL criterion. An axis earns a place in the DNA iff **a few bits per scene explain many
words of prose**. `value_shift` is the canonical example: one signed pair per scene (`−` →
`+`) explains the whole emotional architecture of a scene. `register` likewise. A candidate
axis that needs a paragraph per scene to state is not structure, it's paraphrase — reject it.

So the miner's scoring gate is literally a compression ratio, and "mathematical" candidates
(numbers, enums, small tuples, curves) outrank prose-shaped ones *by construction*.

## 3. What we already know (the seed registry)

Discovery must not re-discover. The known-axis inventory the miner is seeded with:

- **Ladder fields** (scene content, live on book 1229): `loc, goal, needs, outcome, conflict,
  register, value_shift, threads, establishes, chapter_start, sketch`
- **Sketch axes** (Gardner/McKee already encoded): `distance` (psychic distance), `mode`,
  `time`, `tension`
- **Entity kinds**: character, relationship, tentpole, world_fact, location, thread, game,
  meter, voice_profile
- **Derived series**: `meterSeries` (7 meter kinds), `topography` (polarity), `pacing`,
  `causality` (state-key DAG), `promiseLedger`, `obligationLedger`, `facetEchoes`,
  `ledgerBefore/ledgerAt`

A candidate only survives if it is **not derivable** from a combination of these
(non-redundancy gate, §6).

## 4. Architecture — the loop

```
                       ┌────────────────────────────────────────────┐
                       │  LENS REGISTRY  scripts/.dna-miner/lenses.json  │  ← the self-
                       │  known ∪ candidates, each with:            │    modifying
                       │  name · encoding schema · extraction fn/   │    state
                       │  prompt · status (known|candidate|         │
                       │  ratified|rejected)                        │
                       └───────▲────────────────────┬───────────────┘
                               │ 4. SELF-MODIFY      │ 1. EXTRACT
                               │ (append winners,    │ (every lens × every scene
                               │  refine prompts)    ▼  → trace matrix)
   ┌──────────────┐    ┌───────┴────────┐    ┌──────────────────┐
   │ corpus:      │    │ 3. INDUCE +    │    │ trace matrix     │
   │ scene-       ├───▶│    SCORE       │◀───┤ scenes × lenses  │
   │ segmented    │    │ (Claude Code   │    │ (compressed vals)│
   │ prose + tree │    │  judgment)     │    └────────┬─────────┘
   └──────────────┘    └───────▲────────┘             │ 2. RESIDUAL READ
                               │                      ▼
                               │            ┌──────────────────────┐
                               └────────────┤ residuals: per scene,│
                                            │ "what does the prose │
                                            │ do that the trace    │
                                            │ doesn't capture?"    │
                                            └──────────────────────┘
        Loop until 2 consecutive rounds produce no surviving candidate (loop-until-dry).
```

### The four passes

1. **EXTRACT** — apply every registry lens to every scene, producing the *trace matrix*
   (one compressed value per scene per lens). Two lens types:
   - `computed` — pure JS, zero model cost, maximally compressed. Examples: dialogue ratio,
     words-per-sentence curve, paragraph-length rhythm, scene word count vs planned length,
     interiority-marker density. These are the cheapest programs that explain the data —
     MDL says try them first.
   - `judged` — model extraction (cheap OpenRouter tier, one small call per scene per lens),
     forced into the lens's encoding schema (a number, an enum, a ≤3-field tuple).

2. **RESIDUAL READ** — per scene, one model call gets (a) the scene's full trace-matrix row
   and (b) the prose, and answers: *"Predict the scene from the trace alone. Now read it.
   List what the scene demonstrably does that the trace did not predict."* The answers are
   the residuals — the raw ore. (This inverts the meter read: instead of checking a known
   curve, it asks what's left over after ALL known curves.)

3. **INDUCE + SCORE** — Claude Code (not a script) clusters residuals across scenes and
   proposes candidate lenses, each formalized as: name · per-scene value domain (small!) ·
   fold rule (how it accumulates across the book, cf. `ledgerBefore`) · invariant (what a
   *good* curve looks like — the future lint). Each candidate then faces the gate in §6.
   This is the *grounded theory* move from qualitative research: codes emerge from the
   data, then get tested against it.

4. **SELF-MODIFY** — surviving candidates are appended to `lenses.json` with
   `status: candidate`; extraction prompts that produced noisy traces get rewritten. Next
   round re-runs EXTRACT for new/changed lenses only. The run terminates when **two
   consecutive rounds ratify nothing** (dry), or a round budget is hit.

### Why "self-modifying Claude Code run" = harness script + Claude Code, not one script

- `scripts/structure-miner.mjs` does the mechanical, parallelizable work: corpus fetch,
  computed lenses, batched judged-extraction and residual-read calls via the OpenRouter
  stack (reuse `scripts/lib`, same pattern as `prose-context-experiment.mjs`), writing
  `scripts/.dna-miner/*.json` state.
- **Claude Code is the inductor**: between rounds it reads the residuals + trace matrix,
  proposes/refines/kills lenses by editing `lenses.json`, and re-invokes the script. The
  "self-modification" is real but bounded — the mutable surface is the registry file, never
  the harness code. That keeps the loop auditable and resumable (same philosophy as the
  driver's "every change is a proposal").
- All `scripts/.dna-miner/*` state is local-only (extend the existing `scripts/.dna-*.json`
  gitignore pattern).

## 5. Corpus

- **Dev corpus: book 1229.** Verified 2026-07-08: full tree (44 nodes: 10 beats, 6 scenes,
  10 threads, 6 characters…) but only **3 scenes carry prose** (`content.prose = {text,
  words}`: 2112 + 2353 + 750 ≈ 5.2k words). Perfect for building the harness cheaply;
  too small to ratify axes from.
- **Mining corpus: a finished DNA book** (e.g. 1171 "mastering freedom (DNA test)" or the
  longest completed one — pick at P2). Ratification needs enough scenes (~≥20) for
  coverage/stability statistics to mean anything.
- Optionally, later: a **published human novel** (public domain) as an out-of-distribution
  corpus — structure our generator never produces is exactly what we're missing most.
  (Scene segmentation is manual-ish there; explicitly out of v1 scope.)

## 6. The ratification gate (MDL scoring rubric)

A candidate lens must clear **all five**, judged by Claude Code with the traces as evidence:

1. **Compression** — encoding ≤ ~20 tokens/scene, and the residual read *stops mentioning*
   the phenomenon once the lens is in the trace (the operational test that it "explains").
2. **Coverage** — takes non-default values on ≥⅓ of scenes (an axis that fires once is a
   note, not structure).
3. **Non-redundancy** — a judge given the existing trace row *cannot* reconstruct the
   candidate's value (else it's derivable → reject or express as a derived series instead).
4. **Actionability** — statable as a *generation-time constraint* ("scene N must X") or a
   lint ("flag when curve does Y"). Structure we can't steer with is trivia.
5. **Stability** — re-extracting on the same scenes (different seed/prompt phrasing) agrees
   ≥80%. A lens the model can't read reliably can't be a contract.

## 7. Output & graduation path

The run produces `reports/structure-miner-<bookId>.md`:
- the full trace matrix (evidence),
- per ratified axis: definition, encoding schema, full-book trace, the residuals it
  absorbed, and a **spec stub** naming its landing site in the DNA — one of:
  a) new scene/beat content field in `dnaSchema.ts` (like `value_shift`),
  b) new `MeterKind` or a standard `custom` meter instance,
  c) new derived series + lint in `novelDna.ts` (like `facetEchoes`),
  d) new craft-note tier-2 entry (softest landing).

**Graduation is manual and deliberate** — the miner proposes, it never edits `novelDna.ts`
or `dnaSchema.ts` itself. Same invariant as the driver: discovery output crosses a review
channel before it becomes substrate. (Both twins + parity lock apply to anything that lands.)

## 8. Phases & success criteria

- **P0 — corpus + registry (half day).** `structure-miner.mjs fetch <bookId>` → scene-
  segmented corpus JSON (prose + the scene's own DNA row); seed `lenses.json` with the §3
  inventory as `known`. ✅ when the 3 prose scenes of 1229 round-trip with their trace rows.
- **P1 — computed lenses (half day).** Implement 4–6 pure lenses; emit the trace matrix as
  a markdown table. ✅ when the matrix reads sensibly against the actual scenes. (Bonus
  teaching artifact: these curves are plottable next to meters later.)
- **P2 — judged extraction + residual read (1 day).** Batched model calls, schema-forced;
  pick and fetch the mining corpus. ✅ when residuals are concrete and non-generic ("the
  scene's tension comes from an unanswered question opened 2 scenes ago" — not "good prose").
- **P3 — induction rounds (interactive, 2–4 rounds).** Claude Code induces/scores/ratifies;
  loop-until-dry. ✅ when ≥2 axes clear all five gates, each with a spec stub — or the run
  goes dry and we document *that* (also a result: current DNA may be near-complete for this
  corpus, and the gap is elsewhere).
- **P4 — report + (separately) graduate one axis end-to-end** as the template, the way
  spine was the template for craft tiers.

**Cost:** extraction + residual on a ~30-scene book ≈ 30 scenes × (≤8 judged lenses + 1
residual read) × ~2k tokens ≈ well under $1 on the qwen tier per round; the expensive part
is Claude Code induction time, which is interactive anyway.

## 9. Risks / open questions

- **Paraphrase gravity.** Judged lenses drift toward summarizing. Mitigation: hard schema
  (enum/number only), gate #1's "residual stops mentioning it" test.
- **Small-N ratification.** 1229's 3 scenes can't clear coverage/stability — that's why the
  mining corpus is a separate, finished book.
- **In-distribution blindness.** Mining only our own generated prose finds only what the
  generator *accidentally* does. The human-novel corpus (later) is the fix; for now, note
  each ratified axis's provenance.
- **Where do beat-level residuals go?** v1 mines at scene grain. Beat/act-grain structure
  (e.g., rhythm *between* scenes, chapter-cut placement) shows up as fold rules — the fold
  is the escape hatch, but if residuals cluster above scene grain, add a beat-grain pass in
  round 2+.
