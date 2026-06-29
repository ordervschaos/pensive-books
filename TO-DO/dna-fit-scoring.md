# TODO — DNA fit scoring (the vertical family)

The horizontal **meters** layer is shipped (docs/novel-dna-meters.md, Phase 1). This is its companion: the
**vertical** family — a number per ladder rung for how well each rung honors the one above it. NOT built yet.

## Decisions locked (2026-06-29)

- **What it measures: per-rung PARENT fidelity.** Does each rung honor its *immediate parent rung* — does the
  logline serve the premise, do the beats serve the pillar, etc. NOT fidelity to the top-level brief mandate
  (that's what `_shared/mandate-gate.ts` already does for the whole manuscript). Parent-fidelity is the truer
  "fit" and localizes drift to the exact edge that broke.
- **Where it lives: folded into the meters page** (`DnaMetersPage`, /books/:slug/dna/meters) as a vertical
  section/column alongside the horizontal meter graph — the §7 matrix (rungs × axes).
- **When it runs: on-demand.** A button per rung (or "judge all"), NOT auto-re-judged on every node change.
  Avoids cost + staleness churn. (Staleness badge later is a fast-follow, reusing the inputHash machinery.)

## Open (decide at build time)

- **Score shape** — per-axis `pass | partial | fail` + evidence (mandate-gate's style) vs a single 0..1 vs
  both. Lean: per-axis verdicts rolled up to a 0..1, so a low score points at *which* aspect of the parent
  the child dropped.
- **The axes per edge** — what "honoring the parent" means differs by rung (logline→premise = dramatic
  question preserved? 5-part shape implied?; pillar→beats = controlling idea earned across the arc?). Likely a
  small per-edge rubric, distilled like `_shared/lens.ts`.
- **Storage** — on the node (`authoring.fit` / `content.fit`) vs a separate `book_fit` row. On-node is
  simplest and rides existing realtime; a row is better if we want history.

## Reuse (most of the machinery exists)

- `_shared/judge.ts` — the LLM-as-judge harness (scores output vs context, returns scores + findings +
  evidence). The fit judge is a sibling of this.
- `_shared/mandate-gate.ts` — the proof-of-pattern: scores a finished book against the brief per-axis with
  pass/partial/fail. Fit = the same idea applied at *each rung* instead of only the final manuscript.
- `_shared/brief.ts` `mandateContext()` — the binding mandate block (context for the top rungs).
- `_shared/lens.ts` — per-structure diagnostic frames; model for the per-edge rubric distillation.
- **Dev bridge** (`scripts/eval-bridge.mjs`) — MUST mirror any new judge route, per
  [[project_dev_bridge_mirror]] / always-use-dev-bridge. In dev all AI calls go through localhost:8787.

## The edges to judge (plan layer only — not every leaf)

brief → logline (seed) · logline → premise · premise → pillar · pillar → movements · movement → beats.
~5 judge calls per book. Scenes (the render layer) are out of v1.

## Why it's not pure-engine (unlike meters)

"Does the logline honor the premise" is semantic — every cell is an LLM call. That's why it's a durable
eval pass (task row + bridge mirror + storage + UI), not the ~60-line arithmetic the meters engine was.

## Related

docs/novel-dna-meters.md §5c (the vertical fulfillment cascade) + §7 (the rungs × axes matrix) already
specify this — that doc is the design contract; this file is the build checklist + the locked decisions.
Memory: project_dna_meters, project_brief_mandate_propagation, project_ai_call_logging, project_dev_bridge_mirror.
