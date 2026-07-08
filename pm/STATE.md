# STATE — what exists, and what status it's in

> Snapshot date: **2026-07-09**. Update when something ships, parks, or dies.
> Deep detail lives in `docs/` and `apps/web/src/features/dna/FEATURE.md`; this is the map.

## The product at a glance

Two pillars (NORTH_STAR §4):

- **Writing** — manual authorship. Books/pages editor, publishing to the marketing site,
  EPUB/Kindle path. Mature; mostly maintenance.
- **Studio** — generated stories. The **DNA tree** (`book_nodes`) is the single source of truth;
  pages are a render of it. One AI surface: the **AgentRail** agent. This is where nearly all
  active work happens.

North Star metric baseline: **read-through depth ~4 pages** on a self-generated book (stops are
edit-reflex, not boredom). The bar: a full book, no edit-reflex.

## Project status board

### Substrate & engine (Studio core)

| Project | Status | Notes |
|---|---|---|
| DNA tree substrate (`book_nodes`, novelDna.ts engine) | shipped | Single source of truth; pages = projection |
| DNA tree editor (grouped tree, typed fields, CRUD, reviser rail) | shipped | The ONE studio surface (vanilla /dna studio deprecated 2026-07-03) |
| Structure-as-render (outline → reconcile → pages) | shipped | Cheap JSON edits, deliberate render |
| Causality axis (state keys, earned `therefore`) | shipped | Generation constraint, not just lint |
| Meters (comedy/heat/game-score plottable axes) | shipped (P1) | Vertical fit cascade remaining |
| Scene ledger (unified between-scenes read) | shipped (P1–P2) | P3 `ledgerAt` composes but consumers not wired |
| Obligation ledger (debt-based completion) | shipped | Journey gate (`draft` stage gated on `debtSettled`), waive gesture (`DnaOverview.tsx` button + agent tool), endgame objective (`currentObjective`'s `promises` step) all confirmed live + parity-locked, checked 2026-07-09 |
| Incremental continuity digest (per-page prefix fold) | shipped (edge) | Bridge twin NOT mirrored yet |
| Prose streaming proxy (escape ~150s worker ceiling) | shipped | Was killing ~54% of prose calls |
| Timeline layer (temporal projection) | partial | verticalLints shipped; timeline UI + promote-to-thread parked |
| DNA tree versions (save points, diff, restore) | shipped | Auto-checkpoint on auto-accept arm |
| Generation hardening (SSOT schema, fail-closed validateOps) | shipped | Killed 4-mirror drift |
| Brief→Mandate propagation (VOICE vs MANDATE, foregrounded, per-page length budget) | shipped (mechanism) | `docs/brief-mandate-propagation.md` C1/C2/C4; live in `dna-expand` + mirrored in `eval-bridge.mjs`. Conformance-report UI (`mandate-gate` core+edge fn) built pre-pivot, orphaned when Build Studio was deleted — not reconnected to any client path. C5b (content_type → publish/marketplace gate) pending |

### Agent (the single AI surface)

| Project | Status | Notes |
|---|---|---|
| AgentRail (one tool-using agent thread per book) | shipped | Collapsed 6 chat rails into one |
| Auto-accept mode (∞ toggle; agent runs autonomously) | shipped | Absorbed the retired autopilot |
| Agent context model (anchors not fences; @-mention tray) | shipped | Whole book always visible |
| Agent-curated prose (render brief + read-repair loop) | shipped | Stream still writes prose |
| Agent sessions table (archived chats off jsonb) | shipped | Fixed slow "New chat" + Realtime amplification |
| Agent improvement plan (dead-reckoning → sensing) | shipped (code) | P0→P4 landed 2026-07-02; exercised live 2026-07-08 (book 1229, build-all attempt): auto-verify/auto-accept/search/digest confirmed; §v2/§v3 FIXED+deployed 2026-07-08; §v1 (payoff-thread scoping) + §v4 (546 retry/backoff; watchdog already covered it) FIXED+deployed 2026-07-09 — `docs/agent-improvement-remaining.md`. Not yet re-exercised live post-fix. Remaining: §4a/§4b/§3a |

### Verify layer (reading the artifact back)

| Project | Status | Notes |
|---|---|---|
| Verify suite (LintConfig, brief-compile, synopsis read, proseLints, arc threads, cold read, decision journal) | shipped | 2026-07-06 build |
| Vertical-fit lints (shape_unmapped, ending_feel_mismatch, …) | shipped | 2026-07-04 |
| Book evaluation (editor's-read rubric, ~$0.33/read) | shipped | The cheap proxy for the human read-through |
| Structure Miner (mine prose for missed axes, MDL gate) | shipped (R1–R2) | `controlling_metaphor` + `somatic_value_carrier` graduated → `metaphor_monotone`/`value_asserted` lints, both twins, parity-locked; `docs/structure-miner.md`, `scripts/structure-miner.mjs` |
| Thread tracking (foreshadowing/open loops) | partial | Backbone shipped; UI remaining |

### Onboarding & import/export

| Project | Status | Notes |
|---|---|---|
| EPUB import Layer A (epub → DNA tree draft) | shipped | Prose locked as user-truth |
| EPUB import Layer B (semantic ascent) | shipped | 2026-07-08 (`4330bfc` + `84fb407` durable-task promotion: book_decompositions row, self-chain, stopRun); remaining: scene enrichment + act re-segmentation |
| Publish → marketing revalidation (DB trigger → pg_net) | blocked | REVALIDATE_SECRET env not yet set |
| Sequel canon (book-2 constrained by book-1 packet) | shipped | O5 groundwork |

### Infrastructure & ops

| Project | Status | Notes |
|---|---|---|
| Durable AI tasks (task rows, self-chain, watchdog) | shipped | Standing pattern for every AI activity |
| ai_calls logging + LLM-as-judge evals | shipped | One chokepoint (_shared/claude.ts) |
| Model stack = OpenRouter (Qwen/DeepSeek tier) | shipped | Anthropic-shape → converted; cost lever |
| Unified stop (lib/stopRun.ts) | shipped | Route new AI surfaces through it |
| Task notifications (email + browser) | shipped | Uneven tab-closed coverage |

### Known quality gaps (bugs against the hypothesis)

- **Repetition:** verbatim prev-page context was the top repetition source (prose-context
  experiment); digest mitigates, watch for regressions.

### Retired (kept for orientation)

Build Studio + per-layer chat rails (→ DNA substrate pivot, 2026-06-30) · Autopilot (→ auto-accept,
2026-07-01) · Vanilla /dna studio (→ tree-only, 2026-07-03) · Chat-first studio docs.
