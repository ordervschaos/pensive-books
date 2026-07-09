# ROADMAP — now / next / later

> Ranked by one rule (NORTH_STAR §9): **what most moves read-through depth, generation ease, or
> intuitiveness.** Snapshot date: **2026-07-09**. Now ≤ 2 items — WIP limit, finish before pulling.

## 🔵 Now

1. **Re-exercise the live full-book build.** §v1/§v4 agent-loop fixes (payoff-thread scoping,
   retry/backoff) shipped 2026-07-09 but haven't been re-run on a live "build all." This tests
   M1's bar directly — ranked ahead of EPUB/revalidation, which are adjacent (import quality,
   publish pipe), not M1-blocking. Ratified 2026-07-09 PM review.
2. **Monetization rails v1 (GTM R1).** Stripe checkout + webhook → entitlement model → feature
   gating at existing chokepoints + pricing page on the SSG marketing site. First rung of the
   monetize-ASAP ladder (GTM.md); sells the *mature* pillar, so it doesn't wait on M1. Owner
   directive 2026-07-09.

## 🎯 Next big milestone

> **M1 — The First Read.** One self-generated book that the builder reads end-to-end without the
> edit-reflex firing. (NORTH_STAR §2 bar; baseline is ~4 pages.)
>
> Everything in Now/Next must argue its case as "this removes a known read-through stopper."

Milestones after M1 (directional, not committed):
- **M2 — Someone else's read.** A non-builder reads a generated book end-to-end.
- **M3 — The series proof.** Book 2 generated under book-1 canon, still readable (O5).
- **M4 — Paid generation.** Only after M1/M2 — nobody pays to generate slop (NORTH_STAR §7).

> **Revenue milestones run in parallel** (owner directive 2026-07-09, see GTM.md ladder):
> **R1 — first paying customer** (Pro sub on the mature pillar) and **R2 — first per-unit sale**
> (paid import wedge) are NOT gated on M1; only generation pricing (R3 = M4) is.

> **Live-run defects §v1–§v4 all fixed** (2026-07-08/09, `docs/agent-improvement-remaining.md`) —
> moved to STATE.md. Re-exercising §v1/§v4 on a live "build all" is now the sole Now item (above).

**Structure Miner v1 shipped** (2026-07-08, via `dna/structure-miner` — merged 2026-07-09):
R1/R2 graduated, moved to STATE.md.

> **Brief→Mandate propagation fix** — checked 2026-07-09, already shipped (mechanism live in
> `dna-expand`, C1/C2/C4 done); moved to STATE.md. Dropped from this list.

> **Obligation ledger completion** — checked 2026-07-09, already shipped (journey gate, waive
> gesture, endgame objective all live + parity-locked, predate `pm/`). Moved to STATE.md.

## Next

1. **Unblock publish revalidation** — set REVALIDATE_SECRET (small ops task; now a GTM
   precondition — artifact-as-ad needs the publish → marketing pipe live; also unblocks C5b).
2. **Import-funnel productization (GTM R2)** — free-import limit + per-book/credit checkout on
   the R1 Stripe rails + import landing page (before/after) + bundled editor's-read report.
   Prereq: measure decompose COGS via the gen-cost method.
3. **EPUB Layer B follow-through** — scene enrichment + act re-segmentation (Layer B core
   shipped 2026-07-08; these finish the import → readable-plan story and raise R2's quality).

> **Pattern note:** 3 of 4 Next items checked this session were already shipped before `pm/`
> existed (Structure Miner, Brief→Mandate, Obligation ledger) — the file was built from a stale
> mental model, not a code audit. Treat everything below as unverified until checked against git.

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

- ~~Paid tier shape~~ → now committed in GTM.md (R1/R2/R3 ladder, 2026-07-09); only R3
  generation pricing remains M1-blocked
- Multi-user Studio (primary user is the builder until M1)
- True-agent verify-loop graph phase (`docs/true-agent.md` — verify-loop first, graph second)

## How to use this file

- Pull from **Next** only when a **Now** slot frees.
- Rank fights are settled against the milestone, then NORTH_STAR §2.
- When an item ships: move its row to STATE.md, one line in DECISIONS.md if the scope changed.
