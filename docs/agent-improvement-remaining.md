# Agent improvement — what's left

> Companion to [`agent-improvement-plan.md`](./agent-improvement-plan.md) (the sequenced plan, now mostly
> shipped) and [`agent-improvement-analysis.md`](./agent-improvement-analysis.md) (the original audit).
> Status: 2026-07-02. This doc is the backlog: the items NOT yet done, why each was deferred, and how to
> approach it. Read the plan for what shipped.

## Shipped so far (branch `fix/agent-rail-realtime-blank`, 9 commits)

| Item | What | How verified |
|------|------|--------------|
| Phase 0 | scene drafted marker · field-aware search · per-role seam | `deno check` |
| P1.1 | pure engine → edge twin (`_shared/novel-dna.ts`) | 40 parity tests |
| P1.2 | `threadSystem` re-derives objective+lints from live tree | parity + typecheck |
| P2.1 | beatsheet lint-then-repair | rule-selection test |
| P2.2 | plan-conformance verify (`plan-gate.ts`) | `deno check` + inspection |
| P2.3 | enforced render→verify loop (auto mode) | `deno check` + inspection |
| P3/§3b | continuity-digest delta storage (O(n²)→O(n)) | standalone simulation |
| P3/§3d | beat→scene causal-state distribution by role | `dnaExpand.test.ts` |
| P3/§3c | state-key canonicalization (DAG-split fix) | `dnaBeatLints.test.ts` + parity |
| P4/§4c | real per-role models (prose/structure/agent) | `model-config.test.ts` (Deno) |

---

## ✅ Exercised end-to-end 2026-07-08 (book 1229, auto run over beat 3)

The gap below is closed: an auto-accept run was driven live (arm auto → "continue building" →
sketch scene 8 → render → auto-verify → next turn) and observed against ai_calls + the DB. Results:

**Confirmed working:**
- **P2.3 auto-verify fires structurally** after an applied render (`book-agent-autoverify` call
  observed) and the agent consumes the verdict in its next turn.
- **Auto-accept** applies proposals without review and chains turns; **auto-checkpoint on arm**
  wrote a `book_tree_versions` row.
- **Phase 0 field-aware search** used unprompted by the agent (`flour`, `copper hairpin` lookups
  before rendering, for continuity).
- **Digest fold (P3/§3b)** wrote `prose_digest` v4 deltas per rendered scene; prose persisted to
  `content.prose.text`; a pending render proposal survived a tab close and applied cleanly later
  (durable-task behavior as designed).

**Two behavioral defects found (new backlog, ordered by M1 impact):**
1. **§v1 verify judge over-scopes threads.** The scene-7 verify FAILed three thread payoffs that
   belong to scene 8 — the agent correctly dismissed them: *"The verify is asking for the wrong
   scene's payoff."* The judge receives beat-level thread expectations, not the scene's slice.
   Every dismissed false positive trains the agent to ignore verify (alarm fatigue) — this
   partially defeats P2.3. Fix in `plan-gate.ts` context assembly: thread payoffs must be scoped
   to the scene under judgment.
2. **§v2 auto mode accepts a no-proposal turn as end-of-run.** ✅ FIXED 2026-07-08. The run went
   `idle` after a turn that only narrated ("once it applies, I'll render scene 9…") with no tool
   call — scene 9 was left unrendered while the run looks finished. Mirror of the P2.3 insight:
   continuation must be structural, not a recipe line. Fix in `book-agent`'s no-tool-call branch:
   in auto mode the turn gets ONE `[auto-continue]` prod ("act now or call finish") and chains;
   the sentinel in the previous user message bounds it — a second consecutive bare turn goes
   idle honestly. Deployed.

**Cost pattern (§4a) quantified live:** each book-agent turn re-sent 43–46K input tokens for
144–1,184 output tokens; one scene's render cycle ≈ 90K input tokens. Confirms §4a batching as
the top cost lever. Also noted: `dna-expand-stream` logs `book_id: null` (stream proxy doesn't
pass it) — small logging gap that breaks per-book cost attribution.

**Still not exercised** (need a beatsheet-generation run — e.g. expanding a fresh act): P2.1
beatsheet lint-then-repair, P3/§3c canonicalization firing on real generation. P4/§4c admin
per-role selectors also unverified in UI. The verify FAIL→*fix* path (agent rewriting prose
because of a legitimate FAIL) has not been observed — both observed verifies were pass or
false-positive; §v1 must land before FAIL-handling can be judged fairly.

### Addendum — the "build all" attempt (2026-07-08, later session)

Continuing the run toward a full build surfaced two more defects and one structural limit:

3. **§v3 a hung apply wedges the auto-accept watcher for the life of the page.** ✅ FIXED
   2026-07-08. Initially misread as "watcher doesn't re-arm after reload" (arming actually
   persists via localStorage); code reading found the real mechanism: `useAutoAccept` sets
   `busy = true` before `run()` and only resets it when the promise settles — but a prose-render
   apply awaits a browser fetch stream with no timeout and no abort signal, so one dead worker
   mid-stream (see §v4's stuck `running` call 7347) wedges `busy` forever and every later
   proposal sits unapplied. Fix: the watcher now aborts the apply on a deadline (6 min for
   prose-render, 3 min otherwise) via the `AbortSignal` plumbing that already existed end-to-end
   (`applyAgentProposal` → `expandNode` → fetch), so the promise always settles and the existing
   catch path (discard + continue) recovers the run.
4. **§v4 render finalize dies under worker pressure and strands state.** `dna-expand` returned
   546 `WORKER_RESOURCE_LIMIT` intermittently (concurrent dna-decompose load on the same worker
   pool); scene-9's first render streamed fully but its prose never persisted, and the
   `ai_calls` rows stayed `running` forever (7347, 7352). A manual re-render succeeded. Fixes:
   retry/backoff on 546 in the client apply path; watchdog should sweep stuck `running` ai_calls;
   ideally the stream's node-write should not depend on a second worker call. OPEN.

**Structural limit surfaced by "build all":** the whole-book build is *client-driven* — prose
streams in the browser, applies are client clicks, chain advances come from the tab. Closing the
driving tab (which happened twice, naturally) silently freezes the build. A hands-free "build
all" needs §v2+§v3 fixed at minimum (so the author's own open tab drives itself), and
longer-term a headless/server driver or resumable build queue. Build state at stop: beats 1–3
fully prosed (9 scenes, ~9.7K words), beat 4 broken into 3 scenes (sketches pending), beats 5–10
not yet broken.

---

## Remaining items

### §4a — batch independent edits in auto mode  *(medium risk — auto-mode control flow)*
- **Where:** `book-agent/index.ts` `<autonomous_mode>` prompt (~line 1422) mandates "Make ONE change per turn
  with propose_node_ops". Each turn is a full model call with the full system prompt — whose tree block mutates
  every turn, guaranteeing a cache miss on the biggest block — plus a client round-trip.
- **What:** let auto mode put **multiple independent** ops in one `propose_node_ops` call (it already carries an
  `ops[]` array). "Fix all 12 flagged beats" drops from 12 cycles toward 1–2. Keep serial ONLY when a later
  edit depends on an earlier result (e.g. add a node then reference it).
- **Why it matters:** cost + wall-clock. In auto (whole-book) runs the per-turn overhead dominates; the tree
  block is the cache-miss driver, paid once per turn.
- **Approach:** loosen the `<autonomous_mode>` instruction to "batch independent changes into one
  `propose_node_ops`; split only when an edit depends on a prior one." The apply path already handles multi-op
  proposals (`applyNodeOps` loops `validation.ok`), and P2.3's auto-verify only triggers on `propose_prose_render`,
  so batched node ops don't interfere. Prose renders stay one-per-turn (each is a separate browser stream).
- **Risk:** it's a prompt change to the hot auto loop, so behaviour shift is real but bounded (the apply path is
  unchanged). Watch that a batched op set doesn't include a dependent pair the model misjudged as independent —
  `validateOps` rejects the bad one and the agent gets a repair turn, so it's self-correcting.
- **Test:** hard to unit-test (prompt-driven). Verify in the app on a "fix all flagged beats" run: turn count
  drops, tree still consistent.

### §4b — beatsheet truncation-aware continue/repair  *(low-medium risk)*
- **Where:** `dna-expand/index.ts` beatsheet call (`max_tokens: 8000`, ~line 601). A 40-beat sheet with
  threads/needs/establishes/realizes per beat flirts with the cap; a truncated response → `JSON.parse` throws →
  the whole expensive call retries from zero (browser-side `MAX_ATTEMPTS`).
- **What:** stop losing the whole call to one truncation. Options, cheapest first:
  1. **Raise the cap** (e.g. 8000→12000) — one-liner, buys headroom, but doesn't *solve* truncation.
  2. **Truncation-aware repair:** on `JSON.parse` failure, detect a cut-off array and issue a `continue` call
     ("resume the JSON from `<last complete beat>`"), then splice — no full regeneration.
  3. **Per-act generation** against a global plan — biggest change, best scaling, but loses the single-pass
     whole-arc view that makes causality coherent (the reason it's one call today). Avoid unless (1)+(2) prove
     insufficient.
- **Why it matters:** a truncated beatsheet is the single most expensive retry in the pipeline, and it's
  silent (looks like a transient failure).
- **Approach:** ship (1) immediately; add (2) as the real fix — the P2.1 repair machinery already parses +
  re-sanitizes a beat array, so a continue-splice reuses `sanitize()`.
- **Test:** feed a deliberately truncated JSON fixture to the parse/continue path (extractable as a pure helper).

### §3a — transcript per-message rows / compaction  *(BIG — schema migration + Realtime; its own task)*
- **Where:** `book_agent_runs.transcript` jsonb is rewritten WHOLE every chain link (`index.ts` `advance`, and
  now P2.3's inject). It rides Realtime. A 50-turn auto run over a large book does O(n²) DB traffic on one hot
  row — the exact pathology already fixed once for sessions
  (`migrations/20260701150000_book_agent_sessions_table.sql`).
- **What:** two coupled problems:
  1. **Write amplification** — move to per-message rows (a `book_agent_messages` table) or periodic compaction,
     so a turn appends one row instead of rewriting the whole blob.
  2. **No context compaction (quality)** — an old thread carries stale `read_node` dumps that can contradict the
     fresh digest, and the model can't tell which snapshot to trust. Summarize/strip old `tool_result`s
     (context editing) so the live digest is the single source of truth.
- **Why deferred:** it's a schema migration + a Realtime subscription rework + touching every `advance` write
  path (including P2.3's transcript injection, which appends to the last message — that logic moves to
  row-append). Highest blast radius of anything remaining. Model it on the sessions-table migration
  (`project_agent_sessions_table`): new table, backfill, flip readers/writers, then drop the column.
- **Test:** the row-append + reconstruct is unit-testable (pure), like §3b's simulation; the Realtime wiring
  needs the app.

---

## Suggested order
1. **Exercise the loop in the app** (the gap above) — validate 9 commits before adding more.
2. **§4b (1)** raise the cap — trivial, immediate.
3. **§4a** batch independent edits — real cost win, but do it *after* watching an auto run so you're tuning a
   loop you've seen behave.
4. **§4b (2)** truncation-repair — when a real truncation is observed.
5. **§3a** — schedule as its own focused task; don't tack it onto a session.

## Also parked (from the analysis, lower priority)
- **§2b→scene-edge verify depth / §2d semantic search** — `search_nodes` is field-aware now (Phase 0); semantic
  (embedding) search is a bigger, separate feature.
- **§2d prose A/B (`propose_options` for prose)** — a two-render pick-one channel; net-new capability.
- **§2d `record_craft_note`** — persist an `ask_author` answer into `books.craft_notes` so editorial memory
  survives chat archival. Small, independent; a good warm-up item.
