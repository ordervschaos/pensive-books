# DNA: how the seed and premise are created

> The "Build" half of Pensive turns a book's **brief** into a self-similar
> `book_nodes` tree (`seed → premise → pillar → act → beat → scene → prose`),
> then renders that tree into `pages`. This doc covers only the first two rungs.

## The ladder

One recursive table, `book_nodes`, walked as a self-similar tree. Fixed rung
vocabulary, low resolution → high (`novelDna.ts:8` `LADDER_KINDS`):

```
seed → premise → pillar → act → beat → scene → (prose)
  0       1         2       3      4       5
```

Each rung is a lower-resolution **contract** every rung below is drawn from.
`seed`/`premise` are **singleton kinds** (`SINGLETON_KINDS`) — exactly one per
book — unlike the act/beat/scene collections.

## The entry contract (not in the tree)

`books.brief` — the narrow data contract at the feature seam. Holds:
- **`idea`** — the raw, unpolished "what's the book about" (the *amateur entry
  point*). **`idea ≠ logline`.**
- genre, tone, audience, scope (word target), content_type (heat).

The brief is the **mandate**. It is never duplicated into the tree.

## Seed (rung 0)

- Root: `parent_id = null`, level 0. Content = `{ logline }` (`dnaSchema.ts:35`).
- **Bootstrap:** the agent can't create a parent-less root, so the client does.
  `DnaTreePage.tsx:2334` mints the seed on first load of an empty tree and
  prefills `logline` from `brief.idea` as a *provisional placeholder* — only
  when empty, never overwriting a refined one (`:2297`).
- **Refinement:** `dna-expand` `target:"logline"` (`dna-expand/index.ts:611`) —
  a story-editor LLM call that forges the raw idea into a real logline naming
  five concrete things: **protagonist · inciting incident · primary goal · main
  obstacle · stakes**. Written onto the seed's OWN content, not a child
  (`dnaExpand.ts:209`); authoring → `accepted`.
- Agent flow: `STEP_RECIPE.seed` (`dnaJourney.ts:144`) — propose 2–4 options,
  recommend one, ask the author. Flagged `manual: true` — the one hand-authored
  origin; the whole tree grows from it.

## Premise (rung 1)

- Seed's only child. Required field **`dramatic_question`** ("central question",
  `dnaSchema.ts:44`). Optional `shape` = 5-part sketch (setup/turn1/turn2/turn3/
  resolution), demoted because acts/beats own real structure a rung down.
- Agent flow: `STEP_RECIPE.premise` (`dnaJourney.ts:145`) — create the node
  (`propose_node_ops add`, parent = seed), then propose 2–4 options, each
  **elaborating the accepted logline** (protagonist/goal/obstacle/stakes fixed).
- Core = the **central question the whole book lives inside** — plot ("will she
  escape the colony?") OR thematic ("can a single day hold a whole life?").
  Framed wide so the rung stays universal across genre/literary work.
- genre/tone are **NOT** copied here — they live only on the brief
  (`dnaSchema.ts:37`). Single source of truth; avoids drift.

## The system: the guided journey

`dnaJourney.ts` is a **derived state machine** — it reads the tree and computes
each stage's status (done/now/locked/available). Pure; nothing stored.

```
Stage 1 "Idea"       ← seed & premise
   ├─ Seed    (manual, gates →)
   └─ Premise (ready only once seed accepted)   stageSubsteps():93 → ready:seedDone
Stage 2 "Foundations"  (pillar, cast, world…)
Stage 3 "Structure"    (acts, beats)
Stage 4 "Scenes"
Stage 5 "Prose"
```

`currentObjective()` (`:176`) picks the single next rung and injects its
`STEP_RECIPE` into the agent's system prompt as an **"anchor, not a fence"**:
the agent sees the whole tree but is pointed at one rung. When the rung is
filled + accepted, the objective recomputes from the tree and advances itself.

## Full flow

```
books.brief.idea          raw idea (entry contract)
     │  bootstrap: client mints root, copies idea in as provisional
     ▼
  [seed] logline           dna-expand target=logline: idea → real 5-part logline
     │  agent propose_options → author picks → accepted
     ▼
  [premise] dramatic_question   agent elaborates accepted logline → central question
     │
     ▼
  (pillar → acts → beats → scenes → prose — next)
```

## Architectural terms

self-similar tree · resolution ladder · singleton node kind · narrow data
contract / seam · bootstrap/scaffold · provenance stamp (source/status/locked) ·
single source of truth (mandate on brief) · derived state machine ·
anchor-not-fence prompt injection · amateur entry point (idea) vs logline.
