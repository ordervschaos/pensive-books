# ROADMAP — now / next / later

> Ranked by one rule (NORTH_STAR §9): **what most moves read-through depth, generation ease, or
> intuitiveness.** Snapshot date: **2026-07-09**. Now ≤ 2 items — WIP limit, finish before pulling.

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

1. **Fix the live-run defects** found by the 2026-07-08 loop exercise + build-all attempt
   (`docs/agent-improvement-remaining.md` §v1–§v4). ~~§v2 no-proposal stall~~ and ~~§v3 wedged
   auto-accept watcher~~ FIXED + deployed 2026-07-08. Remaining: **§v1** verify judge
   over-scopes threads (alarm fatigue — partially defeats P2.3) and **§v4** 546
   WORKER_RESOURCE_LIMIT strands renders + stuck `running` ai_calls rows. These are why "build
   the whole book" can't run hands-free — the M1 path.

**Structure Miner v1 shipped** (2026-07-08, via `dna/structure-miner` — merged 2026-07-09):
R1/R2 graduated, moved to STATE.md. Now slot #2 is free — see Next below.

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
