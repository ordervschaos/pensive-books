# Learning: Build Pipeline Architecture Planning

New concepts this round (earlier ones in `learning_state_axis.md`, `learning_sota_gap_doc.md`).

- **Derived state vs explicit state machine**
  - What it is: a workflow's "current stage" can be stored (a status column to keep in sync) or computed from the artifacts that exist (spine set? pages written?)
  - Here: `BookJourney.tsx` already derives every gate from real data; we kept that — approvals ARE artifacts existing, so there's no second source of truth to drift

- **Gate rail / stepper**
  - What it is: a vertical progression UI where each step computes its own locked/actionable/done status and hard-locks actions until prerequisites exist
  - Here: BookJourney's staircase becomes the five-gate product surface; two steps added (Spine, Voice), one upgraded (Build)

- **Shared-core extraction**
  - What it is: pulling the pure worker logic (context + prompt + call) out of an HTTP handler into a `_shared/` module so a sync endpoint and async orchestrators reuse byte-identical behavior
  - Here: `generate-unit-core.ts` is the precedent; `beat-core.ts` repeats it so `objective-to-beat` (sync) and `generate-book`'s new beat phase share one implementation

- **Phased orchestrator**
  - What it is: one durable task that moves through named phases (`beats` → `prose` → eval → revise), persisting the phase in its progress JSON so a dead worker resumes in the right phase
  - Here: `generate-book` grows a beat phase before its prose phase; pause-for-review = ending a phase with `status='ready'` and letting an authenticated client call resume the chain

- **Progressive trust / opt-in gate**
  - What it is: making a review checkpoint a per-run author choice (checkbox) instead of a fixed gate — default automated, control available
  - Here: the "pause for beat review" checkbox on the build CTA; resolves the unattended-vs-gated tradeoff without adding standing friction

- **Cross-function chaining**
  - What it is: durable functions invoking each other on completion via a shared secret (`reinvoke`/CHAIN_SECRET), each keeping its own task row for observability and watchdogs
  - Here: milestone 2's closed loop — `generate-book` → `evaluate-book` → `revise-prose` → re-eval is pipes between existing functions, not new infrastructure

- **Severity-tiered auto-remediation**
  - What it is: automation fixes only issues above a severity threshold; the rest are deliberately left for human judgment
  - Here: auto-revise handles critical+major in one round; minor/polish notes wait for the gate-5 editor's read so the reviser doesn't sand off voice

- **Anchor-status lifecycle reuse**
  - What it is: deriving ledger behavior from an existing table's lifecycle instead of new schema
  - Here: `book_threads` already encodes planned→open→closed with setup/payoff page anchors — the promise ledger needed zero migrations, only status maintenance + context injection

- **Before/after eval as regression harness**
  - What it is: using the same automated judge on output built before and after a change to verify the change moved the target dimensions
  - Here: success criterion 6 — same brief, pre- vs post-milestone build, expecting gains specifically on Plot Logic, Character Arc, Voice
