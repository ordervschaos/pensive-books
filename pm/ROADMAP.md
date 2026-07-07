# ROADMAP — now / next / later

> Ranked by one rule (NORTH_STAR §9): **what most moves read-through depth, generation ease, or
> intuitiveness.** Snapshot date: **2026-07-08**. Now ≤ 2 items — WIP limit, finish before pulling.

## 🎯 Next big milestone

> **M1 — The First Read.** One self-generated book that the builder reads end-to-end without the
> edit-reflex firing. (NORTH_STAR §2 bar; baseline is ~4 pages.)
>
> Everything in Now/Next must argue its case as "this removes a known read-through stopper."

Milestones after M1 (directional, not committed):
- **M2 — Someone else's read.** A non-builder reads a generated book end-to-end.
- **M3 — The series proof.** Book 2 generated under book-1 canon, still readable (O5).
- **M4 — First paid surface.** Only after M1/M2 — nobody pays to generate slop (NORTH_STAR §7).

## Now (in-flight — finish these)

1. **Exercise the agent loop end-to-end** (`docs/agent-improvement-remaining.md` — the
   load-bearing gap): P0–P4 are unit-tested/parity-locked but *never run on a live book*. One
   auto build, watching for objective re-derivation, auto-verify FAIL handling, beatsheet
   repair, canonical state keys. Validates 9 commits before building §4a/§4b/§3a on top.
2. **Structure Miner v1** (`docs/structure-miner.md`)
   — 4th verify leg: mine prose for axes the plan missed; feeds the "locate the break" loop.

## Next (committed, not started — pull order proposed, to be ratified)

1. **Brief→Mandate propagation fix** (`docs/brief-mandate-propagation.md`) — known systematic
   quality bug: heat/length/comedy don't survive the pipeline. Cheap, spec written.
2. **EPUB Layer B follow-through** — scene enrichment + act re-segmentation (Layer B core
   shipped 2026-07-08; these finish the import → readable-plan story).
3. **Obligation ledger completion** — journey gate + waive gesture, endgame objective.
4. **Unblock publish revalidation** — set REVALIDATE_SECRET (small ops task, unblocks the
   book → marketing pipe).

## Later (valuable, deliberately not now)

- Clean generation-cost rerun on the next finished book (spec + first numbers in GTM.md —
  promote the scratchpad script to `scripts/gen-cost.mjs`, close the per-word denominator gap)
- Thread tracking UI (backbone shipped)
- Meters vertical-fit cascade
- Timeline UI + promote-to-thread
- Scene ledger P3 consumers (`ledgerAt` wiring)
- Incremental digest bridge twin (only if bridge path becomes load-bearing again)
- Scene images via MuleRouter (pending URL/model)

## Icebox / open questions (undecided, revisit at review)

- Paid tier shape (see GTM.md — blocked on M1 anyway)
- Multi-user Studio (primary user is the builder until M1)
- True-agent verify-loop graph phase (`docs/true-agent.md` — verify-loop first, graph second)

## How to use this file

- Pull from **Next** only when a **Now** slot frees.
- Rank fights are settled against the milestone, then NORTH_STAR §2.
- When an item ships: move its row to STATE.md, one line in DECISIONS.md if the scope changed.
