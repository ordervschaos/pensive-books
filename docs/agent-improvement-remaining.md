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

## ⚠️ The load-bearing gap: nothing has run end-to-end

**Every item above is unit-tested, parity-locked, or simulated — none has been exercised on a live
book + model.** The whole Phase 2 eval loop (render→verify→fix), the beatsheet repair + canonicalization on a
real generation, and the P1.2 objective re-derivation advancing an auto run all need a running app to observe.

The judges (`plan-gate`, `mandate-gate`) and every generation call need a real model; the edge modules that
call them can't be `vitest`-imported (they pull `llm`/`task`/Deno). So the deterministic scaffolding is proven,
but the *behaviour* is not.

**This is the highest-leverage next action — do it before building §4a/§4b/§3a on top:**
1. Open a book's Studio (`/books/:slug/dna`), run an **auto build** (the ∞ auto-accept toggle in AgentRail).
2. Watch for: the objective advancing past a rendered scene (P1.2); a `🔎 AUTO-VERIFY` block appearing after a
   render and the agent acting on a FAIL (P2.3); the beatsheet repair firing when a generated sheet has a
   hollow `therefore` (P2.1); canonical state keys in the tree (P3/§3c).
3. Confirm `/admin/settings` per-role selectors save and take effect (P4/§4c — the one item with UI and no test).

Can be driven from here via the Chrome tools, or by the author directly.

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
