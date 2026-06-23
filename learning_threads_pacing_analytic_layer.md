# Learning — threads + pacing + the analytic layer

Named concepts that showed up folding `Systematic Novel Writing Methods.md` into the Novel DNA contract.

## Story-craft frameworks (the source doc)
- **Snowflake Method** — *named for a fractal snowflake.* Expand a story symmetrically from one node (logline → 5 sentences → paragraphs → scenes). In this task: it *is* our `expand` verb / the ladder — confirmed our generation order, no change needed.
- **Save the Cat (15-beat)** — *the screenwriting "save the cat" likeability beat.* Beats locked to % positions. Here: the source of "structural gravity" — turning points cluster at 25/50/75%, which became our `pacing_drift` lint.
- **Structural gravity** — the empirical convergence (Snyder/Hauge/Weiland) that turns land at ~.25/.50/.75 of the book. In this task: the constant the pacing axis checks `target_pct` against.
- **Story Grid Five Commandments** — every story unit (book/act/scene) needs inciting/complication/crisis/climax/resolution. Here: validated our self-similar tree; "crisis = best-bad-choice" noted but deferred.
- **Value shift / polarity** — Coyne: a working scene flips a life-value's sign (+→− or −→+); a flat scene is inert. Here: added `value_shift.polarity` + kept the `flat_scene` lint; polarity feeds the topography graph.
- **Scene & Sequel (Swain)** — fiction alternates proactive Scene (goal/conflict/disaster) and reactive Sequel (reaction/dilemma/decision); the decision *becomes* the next goal. Here: recognized our `connector: therefore/but` as that handoff; `scene.mode` deferred.
- **MRU (Motivation-Reaction Unit)** — sentence-level order: stimulus → involuntary → reflex → action → speech. Here: classified as PROSE-layer craft → belongs in `craft_notes`, NOT a node.

## Architectural / data-modeling terms
- **Promise registry** — a set of "open loops" the book must close. In this task: the new `thread` entity (5th entity kind); setup & payoff scenes both *reference* the same thread node.
- **Reference edge vs parent edge** — parent edges = the ladder/reading order; reference edges = cross-links carrying meaning (scene→thread, scene→character). A late payoff is a reference edge *reaching forward* in reading order — never a reordered beat.
- **Derived projection** — a value computed from the tree on read, never stored (like `chapters()`). All three analytic axes (pacing/promises/topography) are projections over scenes-in-reading-order.
- **Three-axis analytic layer** — one engine, three questions: pacing (*when*), promises (*what*), topography (*charge*). Each turns the tree into a shape and emits lints. The structural analogue of the prose "gate."
- **Lint** — *from C "lint" static analysis.* A non-blocking warning about a craft failure (dangling promise, pacing drift, sagging middle). In this task: `validate()` returns them alongside render blockers.
- **Two-pass resolution** — collect all setups + payoffs first, then compare indices. Needed because a single forward pass can't tell "payoff-before-setup" (misordered) from "payoff with no setup" (unearned).
- **Sagging middle** — a run of same-polarity scenes = flat emotional charge. Detected by run-length scan over `topography()` (≥4 consecutive).

## Process terms
- **Contract-first** — change the two spec docs (`novel-dna-schema.md` = fields, `novel-dna-flow.md` = generation graph) *before* code, because the docs are the load-bearing contract.
- **Audit before build** — checked the live schema/engine against the doc to separate *real* data-structure gaps (thread entity, `target_pct`) from analytics/craft that need no new storage.
