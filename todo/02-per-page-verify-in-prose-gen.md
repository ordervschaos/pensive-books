# TODO 02 — Per-page verify inside prose generation

Status: **not started** · Depends on: 01 (loop verified) · Doc: `docs/true-agent.md` Step 3 ("Generation as a guarded scan")

## Why
Today the meter read (Step 2) and continuity ledger (Step 3) are **batch buttons** run after the fact. The
original idea is to verify **each page as it's written**: read the new prose against the bounded "story so
far" for coherence (facts) + resonance (meters), at generation time. Turns the machinery from inspector into
guardrail, and makes the per-page check O(n) (bounded digest), not O(n²) (re-read the book each page).

## The guarded scan (per scene, at prose-gen)
1. **Read** `ledgerBefore(sceneId)` as bounded context (replaces raw prev-page text — already the digest in `dna-expand`).
2. **Emit** prose.
3. **Extract** the delta via `read-facts` (facts asserted + contradictions vs `ledger_in`); write `observed_establishes` + `continuity_flags` on the scene.
4. **Check** resonance: the scene's observed meter reading vs the planned `target` here (`observedGap`).
5. **Fold** forward → next scene sees the updated canon. Causal (no future leak).

## Scope / where it touches
- `dna-expand` prose branch (edge) **and** the `eval-bridge.mjs` `/dna-expand` prose handler (4th-mirror rule — both, or it breaks in dev only).
- `lib/dnaExpand.ts` (`expandNode`) and/or `lib/generateBook.ts` (bulk path) — call the fact extraction after each scene's prose lands, and surface a contradiction as a **flag, not a hard block** (author/agent arbitrates at the gate).
- Reuse `lib/factLedger.ts` (`invokeReadFacts`, the fold) — don't re-implement.

## Decisions to settle first
- **Inline vs after:** fold the extraction into the prose call's return, or a cheap follow-up `read-facts` call per scene? (Step 3 already chose a **separate extraction pass** for reliability — keep that.)
- **Bulk path (autopilot/generate-book):** does per-page verify run there too, or only on single-scene regen? (Bulk = N extra cheap calls; gate behind a flag.)
- **On a contradiction mid-generation:** flag + continue, or pause for the gate? (Default: flag + continue; the macro gate collects them.)

## Success criteria
- Generating/regenerating a scene's prose also writes its `observed_establishes` (and any `continuity_flags`) with no extra user action.
- `ledger_before` is fed as the prose context (verify in `bridge-calls.log` if needed).
- No spurious staleness; bulk generation still completes within worker/stream limits.
