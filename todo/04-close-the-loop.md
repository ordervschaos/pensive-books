# TODO 04 — Close the loop (verify → revise → re-read → taste gate)

Status: **not started** · Depends on: 01, 02 · Doc: `docs/true-agent.md` ("granularity policy", "the actual agent", open Q: taste-gate termination)

## Why
Steps 1–3 are three **separate inspectors** producing findings the author hand-sends to `revise-agent`. The
thesis is the **cycle**: one pass gathers findings → the agent acts → re-read → a **taste gate** decides
stop-or-loop. That's what makes it an *agent* rather than three dashboards.

## The loop
1. **Gather** — run the verify passes appropriate to the scope (see granularity below): meter read + ledger + the pure lints (`validate`) → one ranked finding set.
2. **Revise** — hand findings to `revise-agent` (already consumes them). It proposes `book_revisions` the author/auto-mode applies.
3. **Re-read** — re-run the relevant verify pass on the changed slice (cheap, scoped — not the whole book).
4. **Gate** — stop when the taste gate passes, else loop (bounded iterations).

## Granularity policy (cost discipline)
- **Micro** (single scene edit/regen): local verify only — `validate()` + `ledgerBefore` coherence + that scene's `observedGap`. Cheap, runs often. (Mostly = TODO 02.)
- **Macro** (act/book complete): the full reads (Step 2 meter trace + Step 3 ledger scan). Rare, deliberate.

## The open question to resolve: the taste-gate stop condition
Candidates (pick / combine):
- **Threshold:** no `error`-severity lints; `read_gap`/`target_drift` maxAbs under band on the worst meter; zero `continuity_break`.
- **No-progress:** stop when an iteration produces no new findings (loop-until-dry).
- **Budget:** hard cap on iterations / tokens (reuse the durable-task + iteration counters; see `lib/stopRun.ts`).
- **Human gate:** for macro, always end at author review (the existing `book_revisions awaiting_review` gate) — don't auto-commit a structural revision.

## Scope / touches
- A thin orchestrator (client loop like autopilot, or a durable run row) that sequences gather→revise→re-read.
- Reuse: `revise-agent`, `lib/stopRun.ts` (unified stop), the durable-task pattern, `validate()`/`observedGap`/`ledger` findings.

## Success criteria
- A single "verify & revise" action runs the cycle to a defined stop, with the author gating macro commits.
- Re-read is **scoped** to the changed slice, not the whole book, each iteration.
- Bounded — never thrashes; the stop condition is explicit and logged.
