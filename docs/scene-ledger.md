# Scene Ledger — unified between-scenes state

**Status: SHIPPED (2026-07-02). All three phases implemented in the parity-locked engine twins + edge fns.**

Deltas from spec worth noting:
- **Phase 2 shipped the 2a deterministic floor only.** `facetEchoes`/`facetExposureBefore` (verbatim-echo
  detection) + the disclosure-budget prompt block are live. The 2b fold-reported (paraphrase-catching)
  layer is the documented follow-up; it needs the fold to be fed each scene's candidate facet list.
- **Phase 3 `ledgerAt` COMPOSES the existing derivations** (`ledgerBefore`, `facetExposureBefore`) rather than
  migrating `causality()`/`seriesFrom()` call sites into it. The "one fold" intent is met by delegation; the
  call-site migration (3.1) remains a follow-up.
- **All three consumers (3.2 #1–3) ARE wired**, via two shared engine helpers so the surfaces can't drift:
  - `ledgerText(nodes, sceneId)` — the name-resolved between-scenes rendering (open/held promises + positions).
  - `traceDiff(nodes)` — the planned-vs-observed STATE join (advances/payoffs vs observed facts, by node id).
  1. **Prose context** (`dna-expand`): an `ENTRY STATE` block from `ledgerText` + the Phase-2 disclosure budget.
  2. **Agent tree digest** (`book-agent`/`threadSystem`): a `<between_scenes>` block via `ledgerText` for the
     next scene to draft (`nextDraftTarget`) — the agent curates its render brief against the SAME snapshot.
  3. **Verify loop** (`factLedger` + `DnaLedgerPage`): `traceDiff` → `traceFindingsMessage`; the editor handoff
     now carries continuity breaks AND trace gaps, and the ledger page shows a trace-gaps panel.
  The §3.2 #4 lints-over-`SceneLedger` and the §3.1 `causality()`/`seriesFrom()` call-site migration remain follow-ups.
- **`DIGEST_VERSION` bumped once to 4** (Phase 1's grounded ledger shape). Phase 2 rode the same bump.

The problem, in the author's words: prose keeps re-describing what the reader already knows — a
location's palette restated verbatim in every scene set there, a character's traits re-announced, a
dialogue line repeated without new value. And the state an author carries in their head between scenes
(how far apart two characters are now, which promises are open even when nothing on the page touches
them, where a character started and ended) is not available as data anywhere the generators can read it.

The design insight: we already have this ledger — **three times, in three disconnected keyspaces**.
This doc unifies them, in three sequenced phases:

1. **Entity registry grounding** — make all three ledgers speak in node ids (the shared keyspace).
2. **Facet exposure** — track *how much of each entity has already been rendered* (progressive disclosure).
3. **`ledgerAt()`** — one pure fold that answers "what is the state of the story between scene N and N+1?"

Each phase is independently shippable and independently valuable; each later phase consumes the
previous one's output.

---

## 0. The current landscape (three ledgers, three keyspaces)

| Ledger | Where | Keyspace | Fold |
|---|---|---|---|
| **Plan deltas** | scene/beat `content` fields: `establishes`/`needs`, `threads[{ref,role}]`, `advances[{ref,how}]`, `readings[{ref,value}]`, `pov`, `loc`, `time` (`_shared/novel-dna.ts:56-140`) | node ids (`n_…`) + snake_case state keys | inline, per consumer: `producedSoFar` (causality lint `novel-dna.ts:570`), meter carry-forward (`seriesFrom`, `novel-dna.ts:637`), promise counting (`novel-dna.ts:536`) |
| **Continuity digest** (observed) | `dna-expand/index.ts:28-244` — `DigestLedger {characters, objects, locations, timeline, open_threads}` + impressions, cached per node as `authoring.prose_digest` (hash-chained, `DIGEST_VERSION=3`) | **LLM-minted free-text strings** ("Mara — hiding in lot 7") | `foldDigest` (LLM, one call per new page, cache makes it O(1) steady-state) |
| **Fact ledger** (observed) | `read-facts/index.ts` + `features/dna/lib/factLedger.ts` — key→value canon written to `scene.observed_establishes`, breaks to `continuity_flags` | **LLM-minted snake_case strings** ("mara" → "lot 7") | client prefix-scan (`factLedger.ts`), sequential O(n) |

Plan-side is deterministic and id-keyed. Both observed ledgers are LLM-read and *name*-keyed — the
models re-derive entities from prose with no knowledge of the DNA tree. Consequences:

- The planned-vs-observed **trace diff** (docs/true-agent.md) can't join: `advances: [{ref: n_rel_x}]`
  has no observed counterpart it can be compared against by key.
- The same entity can drift into multiple observed entries ("the harbormaster" / "Okonkwo") despite
  the fold prompt's merge discipline — nothing anchors it.
- Nothing anywhere tracks *disclosure*: the prose prompt hands out the full location palette every
  time with the instruction "render the SAME palette every time" (`dna-expand/index.ts:328`), and the
  only anti-repetition defense is the reactive, entity-blind phrase blocklist.

### Non-goals (explicit, all phases)

- **No storage migration.** The scattered plan-delta fields stay as they are. Uniformity is a *read
  interface* (`ledgerAt`), not a new table or a unified delta array. Migrating storage means touching
  every producer + the parity-locked edge twin for zero behavior change.
- **No third observed read.** Phase 2's exposure signal rides inside the existing digest fold; no new
  per-scene LLM pass.
- **eval-bridge is not updated** (it is not a mirror — see project memory). The web/edge twins are.

---

## Phase 1 — Entity registry grounding

**Goal:** every observed-ledger entry that concerns a known DNA entity carries that entity's node id.
After this phase, plan and observed state join key-by-key.

### 1.1 The ref grammar

- **Entity ref** = the node id verbatim (`n_…`). No prefixes, no new grammar — it is already the
  plan-side convention (`ThreadRef.ref`, `Reading.ref`, `advances[].ref`, `scene.loc`).
- **Non-entity facts keep free keys.** The fact ledger must still record things that aren't nodes
  ("ferry_schedule" → "hourly until dusk"). Grounding is *additive*: a fact gains an optional
  `entity` field; it never loses its key.

### 1.2 The registry block (shared)

New pure helper in `_shared/novel-dna.ts` **and** its web twin `features/dna/lib/novelDna.ts`
(parity-locked, same as the rest of the engine):

```ts
/** The entity registry as an LLM-consumable block: one line per entity node,
 *  `id — kind — name (+ one-line identifying detail)`. Deterministic order (kind, then position). */
export function entityRegistryBlock(nodes: DnaNode[]): string
```

Covers `character`, `location`, `world_fact`, `thread`, `relationship` (a relationship line names both
ends: `n_rel_x — relationship — Mara ↔ Okonkwo`). ~1 line per entity; a 40-entity book costs ~600
tokens per fold call. Games/meters/tentpoles are excluded — they are plan constructs the prose never
names.

### 1.3 `read-facts` grounding

- Request gains `entities` (the client already owns the tree; `factLedger.ts` passes
  `entityRegistryBlock` output — the edge fn stays stateless).
- Prompt addition: *"ENTITY REGISTRY — the canonical cast/places/rules, with ids. When a fact is about
  one of these, set `entity` to its id and reuse a consistent key. Resolve names, titles, epithets, and
  pronouns to registry entries; do not mint a parallel entry for a new way of referring to a known
  entity."*
- Output `Fact` gains `entity?: string`; validated server-side against the ids actually sent
  (unknown id → field dropped, fact kept). `LedgerFact` in both twins gains the same optional field.
- `observed_establishes` on scenes just carries the richer facts — no schema-shape change beyond the
  optional field (register the note in `dnaSchema.ts` field notes).

### 1.4 Digest fold grounding

- `DigestLedger` entries change from `string[]` to `{ ref?: string; name: string; note: string }[]`
  for `characters`, `objects`, `locations`, `open_threads` (objects usually have no ref — fine).
  `formatLedger` renders `name — note` exactly as today, so downstream prompt text is unchanged.
- `foldDigest` prompt gains the same registry block + resolution discipline (it already has the
  merge/no-minting discipline at `dna-expand/index.ts:159-162`; this gives that discipline something
  to resolve *against*).
- For `open_threads`: the registry lists thread nodes (`promise`, `payoff`), so the fold can tag an
  observed open loop with the planned thread it realizes — the single highest-value join (observed
  thread state ↔ `ThreadRef` plan roles).
- **Bump `DIGEST_VERSION` → 4.** The whole cached chain invalidates by design; cold re-fold is
  budget-bounded (`FOLD_BUDGET_MS`) and self-healing across generations — same path the v3 bump took.

### 1.5 Acceptance

- Unit: `entityRegistryBlock` deterministic output; ref-validation drops unknown ids (both twins,
  parity test).
- Integration (run on book 1171 or any folded book): after one full re-fold, ≥80% of
  `ledger.characters` + `ledger.locations` entries carry a `ref` that resolves in the tree; every
  `observed_establishes` fact about a cast member carries `entity`.
- The trace diff becomes *possible*: for one scene, `advances[].ref` and observed relationship facts
  share a key. (Building the diff itself is Phase 3's consumer.)

### 1.6 Files touched

`_shared/novel-dna.ts`, `features/dna/lib/novelDna.ts` (+ parity test), `dna-expand/index.ts`
(DigestLedger/foldDigest/DIGEST_VERSION), `read-facts/index.ts`, `features/dna/lib/factLedger.ts`,
`features/dna/lib/dnaSchema.ts` (field note).

---

## Phase 2 — Facet exposure (progressive disclosure)

**Goal:** the prose prompt stops handing out full entity descriptions unconditionally and starts
handing out a *disclosure budget*: what has never been rendered (offer it), what has (show the count
and last phrasing; demand variation), what is saturated (forbid restatement).

### 2.1 Facets are schema fields — enumeration is free

A **facet** is `(entityRef, field)` where `field` is one of the entity's descriptive content fields:

- `location`: `sight | sound | smell | texture | mood`
- `character`: `tag | wound | lie | idiolect`
- `world_fact`: `rule | mechanism`
- `relationship`: `bond`

The facet list is derived from the tree — deterministic, no LLM, no authoring burden.

### 2.2 Detection — two layers

**2a (deterministic floor, ship first).** New pure function in both twins:

```ts
export interface FacetUse { ref: string; facet: string; sceneId: string; echo?: string }
/** Scan prosed scenes in reading order; a facet is "used" in a scene when a distinctive n-gram of its
 *  authored text appears in the scene's prose (near-verbatim echo — the harm we're killing). */
export function facetEchoes(nodes: DnaNode[]): FacetUse[]
```

Reuses the `distinctivePhrases` n-gram approach already in `dna-expand` (extract 3-5-gram shingles
from the facet's authored text, case/punct-normalized substring match against prose). Targets exactly
the named harm — *verbatim* repetition — and is unit-testable with no model in the loop. Known
limitation, stated in code: paraphrase escapes it.

**2b (fold-reported, richer, second).** Extend the Phase-1 grounded `foldDigest` output with

```json
"facets_used": [{ "ref": "n_…", "facet": "smell", "phrasing": "<the phrase the page used>" }]
```

fed the scene's *candidate facet list* (only entities present in the scene — POV/`present`/`loc`
resolved, so the ask is small and grounded). Stored on the existing `DigestLink`; accumulated in
`DigestAccum` as counts + last phrasing per facet. Catches paraphrase; costs zero extra calls.
Detection = union of 2a and 2b; when they disagree, 2b wins on count, 2a's `echo` wins on phrasing.

### 2.3 The saturation lifecycle

Per facet, derived (never stored as a status — it falls out of the counts):

```
unrevealed (0 uses) → revealed (1..SATURATION-1) → saturated (≥ SATURATION)
const FACET_SATURATION = 3   // tunable, one const, lives next to METER_FLAT_RUN
```

### 2.4 Prompt injection (the payoff)

In `dna-expand`'s prose context, the `LOCATIONS`/`SETTING`/cast blocks change from *"render the SAME
palette every time"* to a per-facet budget, e.g.:

```
SETTING — Harbor (disclosure budget: reveal what's fresh, vary what's known, drop what's saturated):
  smell — established ×2, last phrasing "tar and old rope": do NOT restate; an oblique echo at most.
  sound — established ×1 ("gulls fighting over fish heads"): fine to touch again, in NEW words.
  sight — never rendered: this scene's chance to establish it.
  mood  — saturated (×3): omit unless the scene turns on it.
```

Same treatment for the POV/present characters' `tag`/`idiolect` facets. The dialogue blocklist
(`priorDialogue`) stays as-is (it is already exactly a "spent lines" facet, just globally keyed;
entity-anchoring it is optional polish, not in scope).

**Degradation rule:** no exposure data (cold cache, fold budget hit) → render today's blocks
unchanged. Exposure only ever *adds* constraint; its absence never blocks generation.

### 2.5 Acceptance

- Unit (both twins + parity): `facetEchoes` finds a planted verbatim palette echo, ignores an
  unrelated scene; saturation thresholds.
- Behavioral: generate scene N+1 at a location already described twice → prose does not contain any
  blocklisted facet n-gram (assertable in a script against real generation, same harness style as
  `scripts/prose-context-experiment.mjs`).
- The budget block renders in `prepare`-mode output (inspectable via the prompt the browser streams).

### 2.6 Files touched

Both engine twins (`facetEchoes`, `FACET_SATURATION`), `dna-expand/index.ts` (fold schema `v→5` or
bundled with Phase 1's `v→4` if shipped together; budget-block rendering), tests.

---

## Phase 3 — `ledgerAt()`: the unified view

**Goal:** one canonical, pure answer to *"what is true between scene N-1 and scene N?"* — consumed by
prose context, the agent's tree digest, lints, and the verify loop's trace diff. Interface
unification; **no storage change**.

### 3.1 Contract

In both engine twins:

```ts
export interface SceneLedger {
  sceneId: string; index: number;                  // position in scenesInOrder
  causality: { established: string[] };            // state keys produced upstream (fold of `establishes`)
  threads: {                                        // thread FSM, derived — "held open" is representable at last
    ref: string; state: "unopened" | "open" | "paid";
    openedAt?: number; lastTouch?: number; scenesSinceTouch?: number;   // reader-pressure signals
  }[];
  relations: { ref: string; moves: number; lastHow?: string; lastAt?: number }[];  // fold of `advances`
  meters: { ref: string; value: number }[];        // carry-forward level entering this scene (reuses seriesFrom)
  positions: { ref: string; loc?: string; lastSeenAt: number }[];      // char → last loc they appeared in (present/pov + scene.loc)
  exposure: { ref: string; facet: string; uses: number; lastPhrasing?: string; saturated: boolean }[]; // Phase 2
  facts: LedgerFact[];                             // observed canon folded from observed_establishes (Phase 1 keys)
}
export function ledgerAt(nodes: DnaNode[], sceneId: string): SceneLedger
```

- **Pure and deterministic** — plan fields + already-persisted observed outputs
  (`observed_establishes`, `prose_digest`, facet uses). No LLM call, no I/O; callable everywhere both
  twins are, including per-keystroke in the tree editor.
- Internals are *relocations* of folds that already exist inline: `producedSoFar` → `causality`,
  `seriesFrom` point-lookup → `meters`, promise counting → `threads`. Those call sites migrate to
  `ledgerAt` (or its internals) so the fold logic exists once.
- "Held open" (the between-scenes thread state) = `state: "open"` with `scenesSinceTouch > 0` —
  derived, never authored, exactly as designed.
- **Relationship distance as a numeric axis is explicitly deferred.** If it proves wanted, it is a
  meter on the relationship pair (`readings` with `ref` = relationship id) and rides the existing
  meter machinery for free — no new subsystem. `relations` here surfaces what `advances` already
  gives us (move count + last move), which may be enough.

### 3.2 Consumers (migration order)

1. **Prose context** (`dna-expand`): the "entry state" bits currently assembled ad-hoc (used
   locations, digest ledger, exposure block) read from one `ledgerAt` call.
2. **Agent tree digest** (`book-agent`/threadSystem): the agent sees the same snapshot the generator
   sees — anchors, not fences.
3. **Verify loop / trace diff** (docs/true-agent.md): planned vs observed key-by-key —
   `advances[].ref` vs `facts[entity==ref]`, `readings` vs `observed_readings`, planned `ThreadRef`
   roles vs observed thread state. Phase 1 made the join possible; this is where it pays.
4. **Lints**: continuity lints (e.g. "character speaks in scene N but `positions` has them elsewhere
   with no travel") become one-liners over `SceneLedger` — new lints are follow-ups, not this spec.

### 3.3 Acceptance

- Unit (both twins + parity test): a fixture book where every field of `SceneLedger` is exercised —
  thread opened-held-paid across three scenes, meter gap carry-forward, position change, saturated
  facet, superseding fact.
- Refactor safety: causality lint + meter series produce byte-identical results before/after their
  internals route through the shared fold (existing tests must not change).
- One consumer live: `dna-expand` prose context reads `ledgerAt` (diffable in `prepare`-mode output).

### 3.4 Files touched

Both engine twins (+ parity/unit tests), `dna-expand/index.ts` (consumer 1), `dna-journey.ts`/agent
context assembly (consumer 2), verify-loop client (`factLedger.ts`/`meterRead.ts` neighborhood,
consumer 3).

---

## Sequencing rationale & risks

**1 → 2 → 3** because: grounding (1) is small, unlocks the keyspace everything else joins on, and
bumping `DIGEST_VERSION` once early avoids repeated cold re-folds; exposure (2) is the new
user-visible value and depends on grounded refs to anchor facet usage; `ledgerAt` (3) is a
consolidation refactor that is *better specified after* 1–2 exist, because two of its fields are their
outputs.

| Risk | Mitigation |
|---|---|
| `DIGEST_VERSION` bump cold-refolds every existing book | budget-bounded (`FOLD_BUDGET_MS`), persisted per-fold, self-heals across generations — proven path (v2→v3). Bundle Phase 1+2 fold-schema changes into ONE bump if shipped close together. |
| LLM ignores/garbles refs | validate ids server-side against the registry actually sent; drop the field, keep the entry. Grounding degrades to today's behavior, never below it. |
| Registry block bloats fold prompts on huge casts | 1 line/entity; cap at the same spirit as `MAX_LEDGER` (registry cap ~120 lines, prefer entities already in the ledger + scene-present ones). |
| Twin drift (edge `novel-dna.ts` vs web `novelDna.ts`) | every new pure fn lands in both + `novelDna.parity.test.ts` — the established parity lock. |
| Exposure over-constrains prose (model refuses to mention the harbor at all) | budget language *offers* fresh facets and only forbids at saturation; degradation rule keeps absence-of-data harmless. |
