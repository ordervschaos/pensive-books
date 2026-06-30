# True Agent — roadmap & todo index

Master doc: `docs/true-agent.md`. Thesis: a story is a bunch of choices; the agent makes them (generate) and
checks they cohere (verify). Pillar 1 = the verify loop; Pillar 2 = world/cast/relationship.

## Status
- ✅ **Step 1** — plan-vs-intent meter diff (`target_drift`, dashed target line). Shipped.
- ✅ **Step 2** — observed meter read (`read-meters` → dotted trace, `read_gap`). Shipped, **not live-verified**.
- ✅ **Step 3** — continuity ledger (`read-facts` → `observed_establishes`, `continuity_break`). Shipped, **not live-verified**.
- ⏳ The three are **batch dashboards beside generation**, hand-sending findings to `revise-agent`. Not yet a loop, not yet inside prose-gen.

## Remaining (in recommended order)
1. **[01]** Live-verify Steps 2 & 3 — `01-verify-true-agent-loop.md` *(switch it on once)*
2. **[02]** Per-page verify inside prose-gen — `02-per-page-verify-in-prose-gen.md` *(the micro-verify at generation time)*
3. **[03]** Ledger compaction — `03-ledger-compaction.md` *(keep the canon bounded → truly O(n))*
4. **[04]** Close the loop (verify → revise → re-read → taste gate) — `04-close-the-loop.md` *(makes it an agent)*
5. **[05]** Pillar 2: world / cast / relationship graph — `05-world-cast-relationship-graph.md` *(independent fresh build)*

## Chores
- **[06]** Fix `DnaOverview.tsx:21` missing `meter` stage-map key — `06-fix-dnaoverview-meter-stage.md` *(pre-existing, breaks full build)*

## Sequencing note
1→2→3→4 makes the verify loop *real* before adding surface. 5 (the graph) is independent and was sequenced
second on purpose — reorder to it only if the visible/demo value is wanted sooner. 6 is a one-liner, do anytime.
