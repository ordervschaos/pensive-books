# DNA structure analysis — does the taxonomy make sense?

> Status: findings / proposal, 2026-07-02. Prompted by the author's observation that **threads sit
> in the cast-and-world (Foundations) section but aren't intuitive to author at the planning
> stage** — analyzed whether that's a one-off or a pattern in the DNA's taxonomy. Verdict: the
> resolution ladder is sound; the flat **level-2 entity bucket mixes four ontological planes** and
> has no notion of *who naturally authors each kind*, and threads are the clearest casualty.
> Companion docs: [`novel-dna-schema.md`](./novel-dna-schema.md) (the schema as designed),
> [`agent-improvement-analysis.md`](./agent-improvement-analysis.md) (the agent-side audit),
> [`dna-studio-analysis.md`](./dna-studio-analysis.md) (the method critique).

## The shape today

Structure is a clean self-similar ladder: `seed → premise → pillar → act → beat → scene`. But
every entity kind hangs flat off the pillar (`PARENT_KIND`, `novelDna.ts:18`):

```
pillar ─┬─ character, relationship, world_fact, location   (story-world nouns)
        ├─ thread, game, tentpole                          (plot machinery)
        ├─ voice_profile                                   (the telling)
        └─ meter                                           (instrumentation)
```

Those four groups are different **ontological planes** — different natural authors, different
lifecycles — stored as sibling kinds with nothing distinguishing them. The schema has *field*-level
classification (`taste` = user-owned, `genOnly` = AI-maintained, `dnaSchema.ts:20-27`) but no
*kind*-level equivalent. That's the root of the confusion the author sensed.

## The lens: authored vs. derived vs. instrument

Classify each kind by **when it becomes knowable** and **who naturally produces it**:

| Kind | Knowable at planning? | Natural author | Plane |
|---|---|---|---|
| character, world_fact, location, relationship | yes — premise-level | author + AI options | world |
| game | yes — a game IS a premise-level conflict ("who wants what, what's the contest") | author + AI | plot machinery |
| tentpole | yes — "the set-pieces I'm writing toward" is a planning thought | author | plot machinery |
| **thread** | **no** — a promise schedule (setup→payoff across beats) is only *meaningful relative to a beat sheet that doesn't exist yet* | **the beatsheet pass** | plot machinery |
| voice_profile | yes, but it's about the *telling*, not the world | author (pure taste) | telling |
| meter | partially — the axes are pluggable, the *target curve* is planning; readings are output | AI, from game/genre | instrumentation |

The codebase already half-admits the thread verdict: `dnaJourney.ts:120` moved threads *out* of
Foundations into the Structure stage with the comment *"a thread's identity IS its beat anchors
(setup→payoff), so it crystallizes during structure work."* But the schema still parents them to
the pillar as if they were cast, and the flow still asks the author (or agent) to invent them
before beats exist.

## Finding 1 — threads: three surfaces disagree about the same contract (bug)

Whether threads are required before the beat sheet has **three different answers** in three places:

1. **The journey says optional.** `dnaJourney.ts:122` — threads are an `optional` branch of the
   Structure stage; the `beats` recipe (`STEP_RECIPE.beats`) tells the agent to call
   `propose_expansion(target='beatsheet')` without mentioning threads at all. The `threads` recipe
   even says "do this BEFORE the beat sheet" — but it's the *later* step in the resolved sequence.
2. **The engine hard-requires them.** `dna-expand/index.ts:573` —
   `if (!threads.length) return json({ error: "generate the threads before the beat sheet" }, 400)`.
3. **The agent's validation doesn't check.** `book-agent/index.ts:1117-1119` — `proposeExpansion`
   for `beatsheet` verifies the pillar exists and acts exist, **not threads**. So a thread-less
   book sails through the agent's gate and fails later, client-side, at engine time.

Consequence in the flagship autonomous mode: the agent follows the objective (which never
mentioned threads), stages the beatsheet expansion, and the server writes the tool_result
**"✓ Expansion requested and applied … Your next turn will show the new nodes"**
(`book-agent/index.ts:471`) *at staging time* — before the client actually runs the engine. The
apply then 400s; `useAutoAccept` discards the proposal and resumes; the agent's next turn sees an
unchanged tree while its transcript asserts the change landed. It's told it succeeded at the thing
that failed — false history in a durable transcript.

**Fix (two independent pieces):**
- **Make threads derived, not requested.** The beatsheet pass already schedules setup→payoff
  book-wide; let it *mint the thread registry* when none exists (emit `threads: [{name, promise,
  payoff}]` alongside beats; persist under the pillar; resolve refs against the fresh batch —
  exactly the name→id pattern `couples.to` already uses for sibling games,
  `dnaExpand.ts:249-259`). Author-declared threads remain honored as constraints when present.
  A thread is a **materialized index over beats**, and indexes are built, not hand-authored.
- **One prerequisite source + honest acks.** Whatever prerequisites remain, encode them once
  (kind-level data, next to `PARENT_KIND`/the schema artifact) and have journey, agent validation,
  and engine all read it. And in auto mode, don't write "applied" into the transcript at staging —
  the truthful ack is "staged; the client will apply it", or better, `autoContinue` should carry
  an apply outcome the server appends.

## Finding 2 — games are placed right, but their twins should be auto-minted

Games *belong* at planning: "X and Y are locked in a contest over Z, win = A, lose = B" is a
premise-level thought, and the win-precondition experiment (`[EXP:preconditions]`) hangs real
causal machinery off it. The friction is that one dramatic tension is **triple-encoded** with no
enforced correspondence:

- the `game` (the contest), its `game_score` **meter** (the plottable trajectory), and the
  **thread** that promises its resolution are three separate nodes the author/agent must create
  and keep aligned by hand;
- the lints catch *some* drift (`unresolved_game`, `no_jeopardy`) but nothing asserts "this game
  has a score meter" or "this game's resolution is a paid-off promise."

**Fix:** creation-time auto-minting — accepting a game offers/creates its `game_score` meter and
its resolution thread in the same op (a code-enforced invariant, not prompt discipline). This is
denormalization done honestly: keep the three views, derive two of them.

## Finding 3 — no kind-level authorship metadata (the systemic version of #1)

`taste`/`genOnly` classify *fields*; nothing classifies *kinds*. The journey, the agent recipes,
the tree editor's "add node" menu, and the objective recipes each hand-assert their own view of
"what the author does vs. what the AI does" — which is exactly how threads ended up with three
contradictory contracts. One tag on the schema:

```ts
authorship: "authored" | "derived" | "instrument"
// authored:  seed, premise, pillar, character, relationship, world_fact,
//            location, game, tentpole, voice_profile, act
// derived:   thread (by beatsheet), beat (by engine), scene (by engine), prose
// instrument: meter (axes pluggable; readings always output)
```

…and let every surface derive its behavior: the journey only makes `authored` kinds into "now"
steps; recipes only ask the author about `authored` kinds; `derived` kinds get engine passes;
`instrument` kinds never block anything. Same SSOT move as `NODE_SCHEMA` → `dna-schema.json`.

## Finding 4 — smaller taxonomy observations

- **`beat` is mostly a join table.** 8 of its 10 content fields are `genOnly` relational edges
  (`threads`, `grounds_in`, `needs`, `establishes`, `realizes`, `plays`, `resolves`, `readings` —
  `dnaSchema.ts:100-112`); only `summary`/`connector`/`polarity` are narrative. Not wrong — the
  causal ledger IS the value — but it confirms the plane-mixing: the "narrative unit" is
  structurally a ledger entry, which is why the beat editor UI feels dense.
- **The top of the ladder is fragmented.** One concept — "the book's idea" — is spread across
  `books.brief` (off-tree), `seed.logline`, `premise.dramatic_question`, and
  `pillar.controlling_idea`. Each rung is a real refinement, but the storage boundaries are
  thicker than the conceptual ones (already flagged from another angle in
  [`brief-mandate-propagation.md`](./brief-mandate-propagation.md) and
  `project_brief_premise_logline`). Candidate simplification if onboarding data shows authors
  stalling across three near-identical "what's it about" steps.
- **`tentpole` is the thinnest kind** — one required `summary` field and a placement edge. It
  works, but it's arguably a *property* (a pinned flag + text on a future beat) promoted to a
  node; kept as a node it should at least stay `optional` everywhere (it is today).
- **`voice_profile` as a pillar child is fine but plane-distinct** — it constrains the *telling*,
  not the story. The `authorship`/plane tag (Finding 3) is enough to mark that; no move needed.

## Recommended order

1. **Fix the thread contract** (Finding 1) — it's a live bug in the autonomous flow: align the
   agent's `proposeExpansion` gate with the engine, and make the beatsheet mint threads when the
   registry is empty. The false-"✓ applied" ack fix rides along.
2. **Kind-level `authorship` tag** (Finding 3) — small schema addition; journey/recipes/editor
   derive from it; prevents the next Finding-1-shaped drift.
3. **Auto-mint game twins** (Finding 2) — quality win for the games pillar; independent.
4. **Top-of-ladder consolidation** (Finding 4) — only with onboarding evidence; touches the brief
   contract, so it's the biggest blast radius for the least certain gain.
