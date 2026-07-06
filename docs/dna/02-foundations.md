# DNA: Foundations (stage 2 — the pillar + entity branch)

> Foundations is where the book's *materials* are declared: the thematic
> argument (pillar) plus the cast, world rules, set-pieces, and games the spine
> will later be forced to build the plot out of.

## Shape: hub-and-spoke (not a single-file ladder)

Seed→premise are single-file (one parent, one child). Foundations is a hub:
the **pillar** (rung 2) with a branch of entities hanging off it.

```
seed → premise → PILLAR ──┬── character (cast)      ← authored, REQUIRED
  0        1        2      ├── relationship          ← authored, optional
                          ├── world_fact            ← authored, optional
                          ├── location              ← authored, optional
                          ├── tentpole              ← authored, optional
                          ├── game                  ← authored, optional
                          ├── thread                ← DERIVED (beat sheet mints)
                          ├── meter                 ← INSTRUMENT
                          └── voice_profile          (singleton)
                 (act → beat → scene also hang off the pillar)
```

## The pillar (rung 2)

A ladder node (acts hang off it) whose content is thematic (`dnaSchema.ts:50`):
- **`controlling_idea`** — required — the book's one-sentence thematic argument.
  `taste: true`.
- **`ending`** — the ending that argument implies. `taste: true`.

Two structural facts:
1. **Singleton** (`SINGLETON_KINDS`, `novelDna.ts:23`) — one per book.
2. **Universal attachment point.** `PARENT_KIND` (`novelDna.ts:18`) declares
   character/relationship/tentpole/world_fact/location/thread/game/meter/
   voice_profile — and `act` — all parent to `"pillar"`. Single source of truth
   for "where does this attach." Generation asserts onto it so a stray call
   can't orphan cast/tentpoles onto the premise (`dnaExpand.ts:243`).

## The entity branch — the materials (`dnaSchema.ts:51–89`)

| Kind | Core fields | For |
|---|---|---|
| character | want/need/wound/lie/truth/idiolect/tag; role | the cast |
| relationship | a,b (char refs), bond, charge | charged edges |
| world_fact | name, rule, mechanism | rules of reality; beats `ground_in` these |
| location | name + sight/sound/smell/texture/mood | sensory palette, carried verbatim into scenes |
| tentpole | summary | a set-piece the book MUST deliver |
| game | players, win/lose, stake, governing_rules→world_facts | a contest with victory mechanics |
| thread | promise, payoff | open loop — DERIVED |
| meter | poles, scale, target | numeric axis — INSTRUMENT |

## The authorship plane (`novelDna.ts:35` `AUTHORSHIP`)

Tags every kind by who naturally produces it:
- **authored** — pillar, character, world_fact, game, tentpole, relationship,
  location, voice. The author (with AI options) owns it. Journey "now" steps
  only point here.
- **derived** — thread (and beats/scenes): a materialized index minted by an
  engine pass (the beat sheet mints the thread registry). Never blocks;
  pre-declaring optional.
- **instrument** — meter: measurement, not story. Never blocks.

## Journey substeps (`dnaJourney.ts:100`)

```
pillar         now       (ready once premise accepted)
cast           required  (ready once pillar accepted; needs >=1 character)
world/games/tentpole/relationship   optional branches
```

Foundations `done` = pillar accepted AND >=1 character (`stageComplete`,
`dnaJourney.ts:36`). Everything else is enrichment.

## Generation is data-driven (`dna-expand/index.ts:795`)

`dna-expand` looks up a `node_type_configs` row for the target: `child_kind`,
`count`, `schema_json`, and **`slots`** = which context blocks to inject
(slot-filling / context assembly):

```
slots.entities   -> entityBlock       (cast sees existing entities)
slots.worldRules -> worldRulesBlock
slots.threads/tentpoles/games/...
always: BRIEF (binding) + MANDATE + "STORY SO FAR" LOCKED-ancestor chain, verbatim
```

**Name -> id resolution seam** (`:826–864`): the LLM references entities by
NAME (relationship a/b, game players/rules); the fn resolves name->node id and
drops any that don't resolve. LLM works in names, graph works in ids.

## Why it exists (the downstream payoff)

The later beat sheet forces each beat to `realizes` a tentpole, `grounds_in` a
world_fact (climax win must be mechanically earned — no deus ex machina),
`plays`/`resolves` a game. None of that is possible unless those materials were
declared here first. Pin (lock) something in Foundations and it's injected
verbatim as a non-negotiable constraint into every pass below —
**constraint propagation** down the ladder.

## Terms

hub-and-spoke topology · single source of truth for attachment (PARENT_KIND) ·
authorship plane (authored/derived/instrument) · materialized index (threads) ·
taste gate (taste:true fields) · data-driven generation (node_type_configs) ·
slot-filling / context assembly · name->id resolution seam · constraint
propagation (locked ancestors verbatim).
