# Novel DNA — the whole build pipeline (zoom-out)

> Companion artifact: https://claude.ai/code/artifact/ca9cbe0b-4643-4d2f-9c73-57cffc171bbc
> Per-rung deep dives (this folder): `01-seed-premise` · `02-foundations` ·
> `03-structure` · `04-scenes` · `05-prose`. Driver: `06-driver`.

## The thesis

The whole book is a single self-similar tree of `book_nodes` — the **genotype**,
the source of truth. Each rung down is **higher resolution and lower authority
over causality**. The last step **transcribes** the tree into `pages` — the
**phenotype** the reader sees. `book_nodes` is private to the DNA feature;
`pages` is the only thing the editor/reader touch (the seam: books-in / pages-out).

```
brief → seed → premise → foundations → structure → scenes → prose ⇒ pages
         L0      L1         L2           L3·L4        L5      (content)  (projection)
        abstract ───────────────── resolution ↑ ───────────────── concrete
```

The rungs are a typed sequence (`LADDER_KINDS`), so their order is real
information — the artifact colors them on an ordered cool→warm ramp for that
reason.

## The six rungs

### 0 · Seed  (`seed`, L0, singleton, root)
- **Creates**: the client bootstraps the parent-less root; `dna-expand · logline`
  refines it.
- **Produces**: `logline` — protagonist · inciting incident · goal · obstacle · stakes.
- **Mechanic**: idea ≠ logline — the first refinement. The one hand-authored origin.

### 1 · Premise  (`premise`, L1, singleton)
- **Creates**: agent `propose_node_ops add` → `propose_options`.
- **Produces**: `dramatic_question` (central question) + optional 5-part shape.
- **Mechanic**: elaborates the accepted logline; question can be plot OR thematic.
  Genre/tone stay on the brief — one source of truth, never duplicated down.

### 2 · Foundations  (`pillar` + entity branch, L2)
- **Creates**: agent sets pillar → cast; entities via config-driven generation
  (`node_type_configs`).
- **Produces**: pillar (controlling idea · ending) · characters · world_facts ·
  tentpoles · games · locations · threads · meters.
- **Mechanic**: hub-and-spoke on the pillar (`PARENT_KIND`). Authorship plane:
  authored / derived / instrument. Pin anything → propagates down as a hard
  constraint. These are the *materials* the plot is later forced to build from.

### 3–4 · Structure  (`act`, `beat`, L3·L4)
- **Creates**: acts = one `replace_children`; beats = one **global beat-sheet
  pass** on the pillar.
- **Produces**: acts (goal · turn · value shift) · beats (therefore/but ·
  polarity · needs/establishes · grounds_in · realizes · plays/resolves · threads).
- **Mechanic**: `needs`↔`establishes` state keys form a **causal DAG** — every
  "therefore" must be earned upstream (the and-then killer). The thread registry
  is minted in the same pass.

### 5 · Scenes  (`scene`, L5)
- **Creates**: per-beat `propose_expansion(scenes)`; `realizeScenesFromBeat`
  projects the beat's plan down.
- **Produces**: pov · loc · goal→conflict→outcome · value_shift · register · readings.
- **Mechanic**: projection, not re-invention. `needs`→first scene,
  `establishes`→last. A local pass, one beat at a time — causality settled above.

### Prose  (`scene.content.prose`, draft)
- **Creates**: two-hop — `prepare` assembles, the browser streams off-worker.
  Agent attaches a curated brief (focus · mustHonor · avoid).
- **Produces**: `scene.content.prose`.
- **Mechanic**: escapes the ~150s worker ceiling. A rolling incremental digest
  keeps continuity at O(1)/page. Read-repair: observed vs planned → fix the tail.

### The projection → Pages  (`reconcileDna`)
- chapter → a section page (title) + a text page (its scenes' prose).
- incremental · non-destructive (archive, never delete) · idempotent.
- Render & publish are **deliberate author gestures** — the agent can't cross
  the seam.

## The second strand (cross-cutting, runs through every rung)

- **Provenance & locks** — every node stamped source · status · locked; a lock is
  injected verbatim into every pass below it.
- **Propose / commit** — one engine, two exits: auto-land as accepted nodes, or
  reviewable ops (phantoms + apply/discard in the AgentRail).
- **Generate ↔ verify** — rungs down are dead-reckoning; lints + prose read-repair
  are the sensing half (a trace-diff of observed vs planned, can cascade a fix up).
- **Lints** — structural (`orphan`, `misparented`) · promise (`misordered_payoff`
  = error) · vertical (`beat_polarity_undelivered`) · causal (`uncaused_therefore`).

## The driver (what walks the book down)

- **the journey** — five gated stages (Idea → Foundations → Structure → Scenes →
  Prose); each locked until the prior completes.
- **currentObjective** — derives the one next rung live from the tree, injected as
  an anchor, not a fence.
- **AgentRail** — one tool-using agent thread per book; auto-accept can arm it to
  walk the whole ladder autonomously. (See `06-driver.md` for the full driver.)
