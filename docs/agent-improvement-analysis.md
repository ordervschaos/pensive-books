# Agent improvement analysis — where novel generation loses quality today

> Status: findings / proposal, 2026-07-02. A code-grounded audit of the DNA agent stack
> (`book-agent`, `dna-expand`, the client half) along four axes: missing capabilities, data
> structure, prompting, and design. Companion docs: [`agent-capabilities.md`](./agent-capabilities.md)
> (the capability surface as shipped), [`true-agent.md`](./true-agent.md) (the eval-loop north star —
> this doc names the concrete gaps between that design and the code),
> [`agent-prompt-audit.md`](./agent-prompt-audit.md) (the previous audit; its findings are fixed and
> NOT repeated here).

**TLDR: the biggest quality lever isn't a new capability — the agent flies blind during exactly
the runs that produce the book.** The autonomous drafting loop *dead-reckons* (acts from snapshots
taken when the author hit send) instead of *sensing* (re-deriving state from the live tree each
turn). Three defects compound into that, and their shared root cause is architectural: the pure
engine (`novelDna.validate`, `dnaJourney`) exists only in the browser bundle, so the server agent
can't see what the system itself already knows.

---

## 1. The autonomous drafting loop is blind (design — highest impact)

Three findings that compound:

### 1a. The scene digest carries no drafted marker

`DIGEST_FIELDS.scene` (`supabase/functions/book-agent/index.ts:826`) shows
goal/value_shift/pov/loc/needs/establishes — nothing indicating whether `content.prose.text`
exists. The one question a "draft the book" run asks every turn — *which scene is next?* — is
unanswerable from the tree the agent is handed.

**Fix (one line):** add a drafted marker to the scene digest line — `prose: "1,842w"` /
`undrafted` (the word count already lives at `content.prose.words`).

### 1b. `context_objective` / `context_analysis` go stale the moment the first change applies

Both are client-computed and stashed per user message (`index.ts:260`); the auto-accept resume
(`autoContinue`, `index.ts:143` → `useAutoAccept.ts` → `continueAgent`) is a pure status flip that
never refreshes them. Mid-auto-run the system prompt keeps saying `TARGET NODE: scene 14 of 80`
after scene 14 is rendered — while the prose recipe explicitly orders "pass exactly its id, don't
pick a different one from the tree" (`dnaJourney.ts:152`). The agent must *disobey its own
instructions* to make progress, navigating from transcript memory across up to 50 turns.

### 1c. The structural lints never refresh mid-run

`validate()`'s 25+ rules (uncaused_therefore, dangling_promise, sagging_middle,
ungrounded_climax, …) are the system's crown jewel, but the agent only ever sees them as the
frozen `<story_analysis>` snapshot from message time.

### Root cause + fix direction: ship the engine to the edge

`novelDna.ts` + `dnaJourney.ts` are pure, dependency-light TS. Do to them what `NODE_SCHEMA`
already got — the `dna-schema.json` artifact + golden-test pattern, or a directly shared
Deno-compatible module — so `threadSystem()` can recompute the objective, the drafted map, and the
lints from the live tree **every chain link**. That single move converts the guided flow from dead
reckoning into a true server-side reconciler, and it unblocks §2.

---

## 2. The eval loop is prompt-ware, not machinery (missing capabilities)

`true-agent.md` names generate→verify→revise as the ceiling. What this audit adds: today's verify
steps exist only as *suggestions the model may ignore*.

### 2a. The read-repair loop is a paragraph, not a mechanism

"Check the tail before rendering the next page" lives in `STEP_RECIPE.prose`
(`dnaJourney.ts:152`) — prose inside the objective block. Under a cheap model in auto mode,
nothing enforces it. **Fix:** after an applied prose render in auto mode, the server chain itself
runs the contract check (and eventually the fact-ledger delta) before offering the next turn —
render→verify→fix as a structural loop, not a recipe.

### 2b. `check_against_contract` breaks the generate/verify duality

It judges prose against the *brief mandate* only (heat/genre/success — `_shared/mandate-gate.ts`).
It never checks the scene against its *own plan*: did the prose deliver the planned `value_shift`?
Does it establish the state keys the causal DAG says downstream beats will spend? The scene's DNA
edges **are** the verification context — that's the whole payoff of causality-as-data
(`true-agent.md` §duals), and it's unused at verify time. **Fix:** a plan-conformance mode of the
judge that loads exactly the scene's plan slice (value_shift, establishes, threads, register) and
verdicts per field.

### 2c. The beatsheet sanitizer silently degrades instead of repairing

`dna-expand/index.ts:590-612` drops orphan payoffs, unresolvable thread refs, and duplicate
tentpole claims. Every drop *manufactures* a `dangling_promise` or `tentpole_unplaced` lint
silently — the model is never told and never gets a repair turn. This is the opposite of the
repo's own fail-closed doctrine at the write boundary (`validateOps`). **Fix (~30 lines once §1
lands):** after sanitizing, run the lints over the candidate sheet; on errors, one bounded repair
call with the violations listed. This is the eval loop's first real tooth.

### 2d. Smaller gaps

- **No durable editorial memory.** An `ask_author` answer ("keep the heat at 3, never fade to
  black") dies when the chat archives, even though `books.craft_notes` (tier-2 craft,
  `project_craft_knowledge_tiers`) is its natural home. A `record_craft_note` tool closes the loop.
- **`search_nodes` is a substring grep over raw JSON** (`book-agent/index.ts:676`) — snippets
  include field names and JSON escapes; fine for names, weak for motif/echo work. Field-aware
  extraction (search values, label the field) is the cheap step; semantic search the bigger one.
- **No prose alternatives.** `propose_options` covers structured content; there's no A/B channel
  for a scene's prose (two renders, pick one).

---

## 3. Data structure costs (poor data structure)

### 3a. Transcript write amplification

The live thread's `transcript` jsonb is rewritten whole every chain link (`index.ts:427` et al.)
and rides Realtime — the same pathology already fixed once for `sessions`
(`project_agent_sessions_table`). A 50-turn auto run over a large book does O(n²) DB traffic on
one hot row. The related *quality* issue: **no context compaction** — an old thread carries stale
`read_node` dumps that can contradict the fresh digest, and the model has no way to know which
snapshot to trust. Fix direction: per-message rows or periodic compaction that summarizes/strips
old tool_results (context editing).

### 3b. The continuity-digest cache stores O(n²)

Each scene's `authoring.prose_digest.value` is the *entire accumulator* (every prior page's recap
line + ledger + impressions — `dna-expand/index.ts:28,205`). Scene 80 stores ~80 recaps; summed
storage grows quadratically, bloating exactly the table Realtime subscribes to. Storing the
per-page *delta* (recap line + ledger diff) and folding on read keeps the hash-chain invalidation
semantics at O(n).

### 3c. Causality state keys are an open vocabulary with no registry

`needs`/`establishes` are free snake_case strings. A typo silently splits the DAG (the
`redemption_fund` incident); the lints catch *unearned* spends but two spellings of one key pass
as two facts — and `observed_establishes` extraction (read-facts) has to guess the same spellings.
**Fix:** a lightweight key registry, or a canonicalization pass at the write gate (nearest-match
against keys already in the tree).

### 3d. Beat→scene plan inheritance is mechanically lumpy

`realizeScenesFromBeat` (`dnaExpand.ts:175`) drops all of a beat's `establishes`/`needs`/`plays`
onto scene 1 and `grounds_in`/`resolves` onto the last scene. With 3+ scenes per beat the middle
scenes carry no plan and scene 1 is told to produce everything. The scenes-generation call could
*distribute* these (the schema already has the fields; ref validation already exists).

---

## 4. Prompting efficiency (inefficient prompting)

This layer is mostly *good* — schema-on-demand, digest-not-dump, cache breakpoints, the
deterministic anti-echo blocklist are validated, deliberate choices. Three real inefficiencies:

### 4a. "ONE change per turn" in auto mode multiplies cost

`<autonomous_mode>` (`index.ts:1263`) mandates one change per turn; each cycle is a full model
call with the full system prompt — whose tree block mutates every turn, guaranteeing a cache miss
on the biggest block — plus a client round-trip. `propose_node_ops` already carries multiple ops.
**Fix:** let auto mode batch *independent* edits into one call (keep serial only when a later edit
depends on an earlier result); "fix all 12 flagged beats" drops from 12 cycles toward 1–2.

### 4b. The beatsheet is one fragile 8000-token call

A 40-beat sheet with threads/needs/establishes/realizes per beat flirts with the `max_tokens` cap
(`dna-expand/index.ts:580`); truncated JSON → `JSON.parse` throws → the whole expensive call
retries from zero. Options: raise the cap, generate per-act against a global plan, or add a
truncation-aware continue/repair path.

### 4c. One global model tier for heterogeneous work

`getActiveModels().high` drives the agent's reasoning loop, structural JSON, *and* prose — and
`model-config.ts:44` itself warns about this (hermes: great prose, watch the JSON). The
model-prose benchmark showed the best prose model and the best structure model are different
models. **Fix (cheap, independent):** a per-role map — `agentModel` / `structureModel` /
`proseModel` — exactly the pattern `DIGEST_MODEL` already establishes.

---

## Recommended order

1. **Ship the engine to the edge** (§1 root cause) — artifact or shared module; enabler for everything else.
2. **Live re-derivation in `threadSystem`** (§1a–c): objective + drafted markers + lints recomputed per chain link. Fixes autonomous drafting outright.
3. **Lint-then-repair on the beatsheet** (§2c) — the first mechanical eval loop; small once (1) lands.
4. **Per-role model config** (§4c) — cheapest pure-quality win, independent of the rest.

Then, from the remainder: plan-conformance verify (§2b) and the enforced read-repair chain (§2a)
are the path to `true-agent.md`'s loop; the data-structure items (§3) are health/cost fixes that
can ride alongside.
