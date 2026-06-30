# TODO 03 — Continuity ledger compaction (keep the canon bounded)

Status: **not started** · Depends on: 01 (and ideally 02) · Doc: `docs/true-agent.md` Step 3 ("lifecycle + compaction")

## Why
v1 folds facts with **last-write-wins** and keeps the **full set** forever. That's fine for a short book but
re-introduces the O(n²) token problem at scale: the canon fed into each per-page check grows unbounded. The
lever that keeps it genuinely O(n) is **compaction** — live facts ride forward; settled/superseded ones fall
out of the *digest* (but stay in the audit trail for the macro re-read).

## Lifecycle to add
- **assert** — durable canon (current behavior).
- **supersede** — re-asserting a key retires the old value (current: last-write-wins; make the retirement explicit/visible).
- **resolve / retire** — a fact that no longer needs tracking (a tracked question answered, an object destroyed) drops out of the fed-in canon. Connect to thread setup→payoff + causality `needs` consumption.

## Design questions
- **What marks a fact "settled"?** Explicit `retire` op from `read-facts`, or derived (e.g., a thread payoff fires → its setup facts retire)? Prefer derivation where it maps to existing lifecycle (threads/causality), explicit `retire` otherwise.
- **Two views:** `ledgerActive(sceneId)` (compacted, fed to generation) vs `ledgerFull(nodes)` (everything, for the audit/`/dna/ledger` view). Keep both; only the active set is bounded.
- **Bound:** a soft cap + an eviction rule (recency? thread-open? referenced-by-upcoming-beat?). Start simple: drop explicitly-retired + superseded-and-old.

## Success criteria
- `ledgerActive` size stays roughly flat across a long book while `ledgerFull` grows.
- A retired/superseded fact stops appearing in the per-page context but remains visible in `/dna/ledger`.
- No regression to the fold's last-write-wins semantics for live facts.
