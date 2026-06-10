# Learning: SOTA Milestone 1 — the build

Named concepts that showed up while implementing the beat-first build + voice anchor. (Design-phase
concepts are in `learning_sota_gap_doc.md` / `learning_pipeline_architecture.md`; this file is the
ones that became code.)

- **Therefore/but causality (Trey Parker–Matt Stone rule)**
  - Literal: scenes should join with "therefore" or "but", never "and then".
  - What it is: a test that each beat is *caused by* (therefore) or *opposes* (but) the previous one — not merely next in time.
  - Here: the upgraded beat prompt in `beat-core.ts` is fed the *previous* page's beat and ordered to connect by therefore/but; the build plans beats in reading order so the antecedent exists.

- **Value flip (Robert McKee)**
  - Literal: a "value" = a charged stake (trust, safety, hope…) that has a + or − sign.
  - What it is: a scene earns its place by turning one value's sign across it; a flat-sign scene is dead.
  - Here: every beat must name one value that flips and which way — a required element of the beat paragraph.

- **Subtext / said-vs-meant**
  - What it is: the gap between a line's literal words and its real meaning; texture a reader feels.
  - Here: the beat must plan at least one moment where what's said ≠ what's meant — pushes beats past event-listing.

- **Promise/payoff ledger (open loops)**
  - What it is: a setup is a promise; the book must keep it at a deliberate distance (foreshadowing).
  - Here: `book_threads` rows drive a per-page instruction — **seed** (setup page), **withhold** (in the air), **pay off** (payoff page) — injected into the prose context by `buildOpenLoops()`.

- **Anchor-status lifecycle reuse**
  - What it is: derive ledger behavior from an existing table's status column instead of new schema.
  - Here: `book_threads.status` (planned→open→closed) already fit; the prose cascade's `maintainThreads()` flips it as seed/payoff pages get written — zero migration.

- **Few-shot voice anchoring**
  - Literal: few-shot = teach by examples in the prompt.
  - What it is: an exemplar passage produces a voice; instructions ("be lyrical") don't.
  - Here: `generate-voice` drafts 3 samples, the author picks one → `books.bible.voice_sample` → injected into the cached `stablePrefix` of every render, paired with an AI-tell blocklist.

- **Self-Refine loop (Madaan et al., 2023)**
  - What it is: a model critiques its own output against criteria, then revises it.
  - Here: `spine-to-objectives` now does draft → critique (vs Plot Logic / Character Arc / Genre Contract) → revise once; the critique is surfaced in the review dialog as "what the editor pass caught".

- **Shared-core extraction**
  - What it is: pull the pure worker (context+prompt+call) out of an HTTP handler into `_shared/` so a sync endpoint and an async orchestrator run byte-identical logic.
  - Here: `beat-core.ts` mirrors `generate-unit-core.ts`; `objective-to-beat` (sync) and `generate-book`'s beat stage share one beat implementation.

- **Phased / staged self-chaining orchestrator**
  - What it is: one durable task that walks named phases, persisting the phase so a dead worker resumes in the right one.
  - Here: `generate-book` grows `stage: 'beats' | 'prose'`; beats batch ~5/invocation (fast), prose stays 1/invocation (the wall-clock-bound unit).

- **Derived gate / pause-as-state**
  - What it is: a checkpoint expressed as a *data state*, not a separate state machine — the row sitting at `status='ready', phase='beats_done'` IS the pause.
  - Here: the "pause after beats" checkbox; an authenticated `resume` flips the same row back to `running` and re-kicks the chain. The journey rail reads the row to show Continue.

- **Provenance edge stamping (dirty graph)**
  - What it is: store `{p:hash(parent), c:hash(child)}` per ladder edge so a node goes "stale" when its source moves.
  - Here: server `stampBeat()` writes the `objective_beat` edge for build-time beats; `ScaffoldGenerator` now stamps `spine_objective` at apply time (the C1 fix) so objectives stale against a rewritten spine.

- **Idempotent batch retry**
  - What it is: a batch unit that can re-run safely because each item rechecks its own done-state.
  - Here: a beat batch killed mid-flight re-runs; already-beated pages are skipped (the "already has a beat" guard), so no double work and no infinite loop.

- **Prompt-cache stable prefix vs variable part**
  - What it is: split the prompt so the unchanging head (book/brief/voice/bible/outline) is cached and only the per-page tail varies.
  - Here: the voice sample went into `stablePrefix` (cached, amortized across every page); open loops went into the per-page `variablePart`.
