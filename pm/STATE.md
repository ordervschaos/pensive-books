# STATE — what exists, and what status it's in

> Snapshot date: **2026-07-12**. Update when something ships, parks, or dies.
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
| DNA tree editor (grouped tree, typed fields, CRUD, reviser rail) | shipped | The ONE studio surface (vanilla /dna studio deprecated 2026-07-03). 2026-07-11: "clear all nodes" added to the overflow menu — snapshots to History then cascade-deletes from the true root, fixing a prior pillar-vs-seed root-detection bug in the discard modal |
| Structure-as-render (outline → reconcile → pages) | shipped | Cheap JSON edits, deliberate render; reader export paginates by beat (not chapter) as of 2026-07-09, scene breaks marked "***" |
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
| AgentRail (one tool-using agent thread per book) | shipped | Collapsed 6 chat rails into one. 2026-07-10: agent-as-guide — empty rail now greets with a journey-aware scripted teach block (STEP_TEACH per rung; ideation stance when the brief has no idea), and the system prompt gained "Teach as you go" (define craft terms on first use, what/why before acting). Scripted-greet + click-to-accept, deliberately not an auto-fired AI turn on open |
| Auto-accept mode (∞ toggle; agent runs autonomously) | shipped | Absorbed the retired autopilot. 2026-07-09: fixed missing "applying" UI feedback — the watcher applied proposals silently (no spinner/Stop), reading as stuck during multi-minute engine/render calls even though the apply-and-continue loop was working; live-verified functioning correctly against book 1229 before the fix. Also 2026-07-09: resolved cards couldn't be inspected after the fact ("edit a node", no old/new) — the diff is now captured at apply time (before the tree mutates) and frozen onto the step, for both the `dna` and `expansion` proposal layers |
| Agent context model (anchors not fences; @-mention tray) | shipped | Whole book always visible |
| Agent instruction-following (task anchor + intent hydration) | shipped (code) | 2026-07-10: fixed "asked to render a scene → fixes lints" + "replies with the ack of the next pending task". Context-engineering pass on `book-agent/index.ts`: explicit instruction hierarchy (`## Task discipline` — the ask outranks objective/lints), ambient blocks de-imperativized (lint "address ⚠ flags" now auto-mode-only), `<task>` anchor re-stating the ask AFTER `<book_state>` (recency fix), deterministic `<mentioned>` intent hydration (scene/beat numbers, node ids, entity names → full plan inlined), eager ack sees the objective only on generic messages. Deployed; live build-all (Now #1) is the verification gate. `doc_1783661932622.md`. **Same day: skills layer** — situational craft moved out of SYSTEM_THREAD into `_shared/agent-skills.ts` playbooks (prose-patch/render-brief/editorial-read/rebuild-level/options-craft): one-line index always-on, trigger-matched bodies injected per turn, `read_skill` fallback riding parallel reads; core prompt 9.3k → ~6.3k chars. Deployed. `doc_1783663022711.md`. **premise-craft added** (todo.md #1): five-story-elements KB for agent-authored premise options, aligned with dna-expand's premise prompt; skill matching falls back to the objective text on generic asks. **Live-verified on MF4 2026-07-10** (priced questions + escalating movements, one-turn action). **+6 node-editing skills** (character/world/thread/structure/scene-plan/idea-voice craft), schema-grounded; registry 12 skills. ⚠ found: app.pensive.me serves a stale web build (old reviser rail) — needs redeploy. **Edit-as-a-system shipped** (owner principle, ratified by a live MF4 coupled-fields failure): every edit = craft + schema + position; couplings named in core prompt; <mentioned>/read_node now carry ancestor path + children-stale + schema. **craft-kb.ts shipped**: one canonical craft copy (premise/causality/polarity/scene-direction) interpolated into BOTH dna-expand prompts and skill bodies — the two-copies drift risk is closed (and the engine's missing 'ambivalent' enum was its first catch) |
| Agent-curated prose (render brief + read-repair loop) | shipped | Stream still writes prose |
| Agent sessions table (archived chats off jsonb) | shipped | Fixed slow "New chat" + Realtime amplification |
| Agent improvement plan (dead-reckoning → sensing) | shipped (code) | P0→P4 landed 2026-07-02; exercised live 2026-07-08 (book 1229, build-all attempt): auto-verify/auto-accept/search/digest confirmed; §v2/§v3 FIXED+deployed 2026-07-08; §v1 (payoff-thread scoping) + §v4 (546 retry/backoff; watchdog already covered it) FIXED+deployed 2026-07-09 — `docs/agent-improvement-remaining.md`. Not yet re-exercised as a full build-all post-fix, but 2026-07-09 spot-check (same book 1229) confirmed the auto-accept apply-and-continue cycle running correctly unattended for several turns. Remaining: §4a/§4b/§3a |
| Agent speed (de-serialize the loop) | shipped (code) | 2026-07-09: batched independent ops/reads (prompt), Promise.all in toolResults + auto-verify, book state moved out of the system prompt into request-time `withBookState` injection (prompt-cache prefix now survives auto-applies) — `doc_1783588839417.md`. Live run exposed the next ceiling (62k-token transcript → 140s timeouts on MuleRouter) → added compactTranscript (prune old bulky tool_results past 120k chars, keep last 6 messages intact). Bar: 7-lint run ≤4 model calls. Batch-reads confirmed live; compaction deployed. **Deeper root cause found same day:** timeouts were mostly the `effort:"medium"` bound silently getting dropped on the OpenAI-compatible path (qwen reasoned unbounded), not context size. Fix (effort→reasoning-bound mapping in `_shared/llm.ts` + `max_tokens` 8000→5000) **deployed + verified live 2026-07-09: 17 post-deploy turns, 0 timeouts** (was ~37%). Caveat from probes: no router param actually bounds qwen3.7-plus thinking (MuleRouter facade drops all 4 candidates; OpenRouter ignores effort) — the working bound is Anthropic-tier max_tokens, so keep the agent role on an Anthropic model; qwen agent turns can still blow 140s on hard reasoning. `doc_1783607491000.md`. **2026-07-09, 3rd instance of the same class:** live gold-standard pass on book 1229 hit a full gather-before-fix thrash — 125 steps/15 turns/0 applies, re-reading the same scenes and re-searching the same phrases repeatedly. Root cause wasn't compaction size this time, it was the SYSTEM PROMPT: "batch EVERY such fix across all scenes into ONE proposal" pushed the agent to sweep-read every scene implicated by a scattered lint (20+ prose_echo hits) before proposing anything, which outgrows COMPACT_OVER on its own and prunes the gathered reads before they're used. Fixed by capping batches at ~6-8 ops and instructing successive small rounds instead of gather-everything-first, in 3 spots in `SYSTEM_THREAD`/autonomous_mode. Deployed. **Prompt-only wasn't sufficient** — re-verified live still thrashed (60 reads/7 turns/0 applies) — so added a hard mechanical backstop, `FORCE_COMMIT_AFTER_READS=15`: past 15 trailing read-only steps it forces a commit-or-finish directive, independent of the model's own narration. Confirmed live: 0→10+ applies across the session. **Separately found the same day:** an anti-cheat gap — the agent, blocked on a real prose fix, instead cleared `confusion_flags: []` directly (deleting Cold Read's evidence, not the underlying inconsistency). Fixed by exporting the existing `OUTPUT_FIELDS` const (`_shared/novel-dna.ts`) and rejecting any `propose_node_ops` edit that touches a read-output field (`confusion_flags`, `observed_*`, `continuity_flags`, `prose`), in `book-agent/index.ts`'s `proposeNodeOps`. Both deployed + verified live 2026-07-09.|

### Verify layer (reading the artifact back)

| Project | Status | Notes |
|---|---|---|
| Verify suite (LintConfig, brief-compile, synopsis read, proseLints, arc threads, cold read, decision journal) | shipped | 2026-07-06 build |
| Vertical-fit lints (shape_unmapped, ending_feel_mismatch, …) | shipped | 2026-07-04 |
| Brief/premise reads (`read-logline`→`brief_fit_flag`, `read-premise`→`logline_fit_flag`) | shipped | 2026-07-12: built + deployed + verified live end-to-end (scripted smoke test, no browser available). `logline_fixity` axis — new: catches a premise silently swapping the accepted logline's protagonist/inciting/goal/obstacle/stakes. Fixed a real truncation bug found live (`read-premise` max_tokens 1400→3000 — its system prompt + 7 axes needed more room than the other reads' budget) |
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
| Legacy-book → DNA migration | gap | 45 books have real pages + foundations/spine but 0 `book_nodes`; `migrateBookToDna` (their only path) deleted 2026-07-09 after losing its UI trigger in the 2026-07-03 studio consolidation — deliberate tradeoff, see DECISIONS.md. No current path onto the DNA tree for them. |

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
