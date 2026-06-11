# Learning: Closed eval→revise loop (Milestone 2, piece 2)

The "loops, not better first drafts" thesis made automatic: a book gets read, fixed, and re-read
without a human in the inner loop.

- **Closed generate→evaluate→revise loop (Self-Refine at book scale)**
  - What it is: an actor (the draft) circulated through a critic (the eval) and back through a reviser, instead of trusting one forward pass.
  - Here: `auto-revise` runs eval → revise critical/major pages → one re-eval. One round.

- **Critic-actor / LLM-as-judge feeding LLM-as-reviser**
  - What it is: one model call judges (produces structured issues); another consumes those issues to act (revise). The judge's output is the actor's input.
  - Here: `evaluate-core`'s map-reduce emits `{severity, note, evidence, suggestion, page_ref}`; `revisePage` consumes them as `ReviseIssue[]`.

- **Severity-tiered auto-remediation**
  - What it is: automation only touches issues above a threshold; the rest are left to human judgment.
  - Here: only `high` (critical) + `medium` (major) page-anchored issues are revised; `low`/whole-book notes wait for the human gate-5 read so the reviser doesn't sand off voice chasing nits.

- **Issue→page routing (anchored findings)**
  - What it is: the judge cites a real page id (`page_ref.id`) per issue, so fixes route to exactly the page that drew them.
  - Here: `buildQueue()` groups high/medium issues by `page_ref.id`, keeps text pages in reading order, caps the round (MAX_PAGES).

- **Shared-core extraction (again)**
  - What it is: lift the pure worker out of an HTTP handler so multiple callers run byte-identical logic.
  - Here: `_shared/evaluate-core.ts` (`runEvaluation` + the map-reduce) now backs BOTH the user-triggered `evaluate-book` and the loop — same editor's read, same `book_evaluations` rows.

- **Map-reduce evaluation (reused, not rebuilt)**
  - Literal: map = per-dimension passes that each read the whole book; reduce = a verdict synthesized from their findings.
  - Here: triage (warms the manuscript cache) → 3 parallel dimension groups → verdict; splits the REPORT, never the book, so global judgments stay whole-book. The loop inherits it for free.

- **Phased self-chaining orchestrator (recap, new phases)**
  - What it is: one durable task walking named phases, persisting the phase so a dead worker resumes correctly.
  - Here: `auto_revise` row walks `eval → revise → reeval → done`; eval/reeval each run inline (~120s, fits the worker cap), revise does one page per invocation and chains. Poison-page guard reused.

- **Watchdog parity**
  - What it is: any new self-chaining kind must be added to the pg_cron reviver, or a dead link strands the job.
  - Here: the migration widened the kind CHECK AND taught `revive_stalled_chains` to re-kick `/auto-revise` running rows.

- **Opt-in vs auto-fire (cost gate)**
  - What it is: an expensive automated loop is exposed as a deliberate action rather than chained onto every build.
  - Here: `auto-revise` is a button in the editor's-read step, not yet wired to generate-book completion — wiring is a one-line reinvoke when desired.
