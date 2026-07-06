# DNA: Structure (stage 3 — acts + the global beat-sheet pass)

> Where the book stops being statements about itself and becomes a sequence with
> causality. Two rungs: act (3) and beat (4). The beat sheet is the heart of the
> system — a global causal pass, not a per-act outline.

## Acts (rung 3) — the macro skeleton

Hang off the pillar. Schema (`dnaSchema.ts:103`):
- **goal** (required), **turning_point**, **target_pct** (word-% anchor),
  **value** `{name, from, to}` = the macro value shift (e.g. trust: naive->betrayed).

Recipe (`dnaJourney.ts:148`): ONE `propose_node_ops replace_children`, parent =
pillar, childKind = act. Whole-set replacement — acts are a small skeleton
designed together. **`replace_children` semantics.**

## Beats (rung 4) — the GLOBAL beat-sheet pass

NOT per-act, NOT by hand. Recipe (`dnaJourney.ts:149`):
`propose_expansion(nodeId = pillar, target = 'beatsheet')` — builds every beat
of every act in ONE causal pass.

Why global: three things need the whole arc in view —
1. setup->payoff scheduling (plant act1, pay off act3),
2. polarity oscillation (never >~3 same-direction beats in a row),
3. earned causality (each connector justified by what came before).

### Beat fields (`dnaSchema.ts:108`)

Hand-editable:
- **summary** (required)
- **connector** `therefore | but` — the "and-then" killer (Parker/Stone rule):
  every beat links to the prior by consequence (therefore) or reversal (but).
- **polarity** `up | down` — value ends better/worse.

genOnly (reviser sets, editor doesn't — `:111`):
- **needs** `[state key]` this turn DEPENDS on (earned upstream)
- **establishes** `[state key]` this turn PRODUCES
- grounds_in -> world_fact · realizes -> tentpole · plays/resolves -> game
  · threads -> {ref, role} · readings -> meter values

### Causality axis — the DAG in the beat sheet

needs/establishes = DNA's 4th axis (why). State keys = short snake_case handles
(ledger_settled, rival_humiliated). Rule (`dna-expand/index.ts:662`): every
"therefore" beat MUST need a state an earlier beat establishes — the upstream
dependency is what makes the turn CAUSED, not "and then". This turns the flat
beat list into a **causal DAG** (beat = node, needs->establishes match = edge).
"Therefore" becomes checkable, not asserted. Climax win must grounds_in a
world_fact planted earlier — mechanically earned, no deus ex machina.

### Thread minting — derived index built in-pass

Threads are derived (Foundations). Born here: if none pre-declared, the beat
sheet MINTS 3-6 open loops (promise + payoff) and schedules setup->advance->
payoff across beats (`dna-expand/index.ts:658`).

`persistBeatSheet` (`dnaExpand.ts:360`) ordering:
1. minted threads land under the pillar FIRST, keeping server ids (`:371`) so
   beat thread-refs resolve;
2. beats created, grouped under acts;
3. old UNLOCKED beats deleted last (cascade removes scenes); LOCKED beats
   survive (`:366`). Same replace_children idea — never clobber pins.

Name->id resolution recurs (`dna-expand/index.ts:833`): LLM refs threads/
tentpoles/games/world-facts by NAME; fn resolves to ids, drops unresolved.

## Macro vs micro

```
ACT    value: trust naive ───────────────▶ betrayed   (macro trend "down")
BEATS  ●─therefore▶●─but▶●─therefore▶●      (oscillate WITHIN the act)
       up          down   up          down
THREADS setup■┈┈┈┈┈┈┈┈advance┈┈┈┈┈┈payoff□  (span the whole book)
```
Act = macro value trend; beats oscillate within it (`dna-expand:660`) — hope
spots in down-acts, setbacks in up-acts.

## Propose vs commit — one engine, two exits

`expandNode` (`dnaExpand.ts:203`) commits beats as accepted nodes.
`generateExpansionOps` (`:409`) runs the SAME `callExpand` engine but returns
reviewable ops (phantoms + apply/discard in AgentRail). Generation written once;
auto-land vs review is just which exit it takes. **Propose/commit duality.**

## Terms

causal DAG (needs/establishes producer/consumer edges) · therefore/but connector
(and-then killer) · turning point / value shift / polarity oscillation (emotional
topography) · global vs per-node generation · materialized index minted in-pass
(threads) · replace_children semantics (atomic regen, locks preserved) · state
keys as currency of causality · name->id resolution seam · genOnly fields ·
propose/commit duality.
