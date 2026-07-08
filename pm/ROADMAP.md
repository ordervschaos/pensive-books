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

> **Live-run defects §v1–§v4 all fixed** (2026-07-08/09, `docs/agent-improvement-remaining.md`) —
> moved to STATE.md. §v1/§v4 fixed 2026-07-09 have NOT yet been re-exercised on a live "build all"
> run — that's the natural next check before calling the hands-free build path solid. Both Now
> slots are free.

**Structure Miner v1 shipped** (2026-07-08, via `dna/structure-miner` — merged 2026-07-09):
R1/R2 graduated, moved to STATE.md.

> **Brief→Mandate propagation fix** — checked 2026-07-09, already shipped (mechanism live in
> `dna-expand`, C1/C2/C4 done); moved to STATE.md. Dropped from this list.

1. **EPUB Layer B follow-through** — scene enrichment + act re-segmentation (Layer B core
   shipped 2026-07-08; these finish the import → readable-plan story).
2. **Obligation ledger completion** — journey gate + waive gesture, endgame objective.
3. **Unblock publish revalidation** — set REVALIDATE_SECRET (small ops task, unblocks the
   book → marketing pipe; also unblocks C5b content-type gating).

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
