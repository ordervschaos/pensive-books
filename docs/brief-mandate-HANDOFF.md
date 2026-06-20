# Brief→Mandate effort — HANDOFF / next steps

**Last updated:** 2026-06-20. Read this first, then `docs/brief-mandate-propagation.md` (the full spec).

## TL;DR

Generated books conformed on *voice* but broke their *brief* on heat, length, and comedy. Root
cause: every generation stage injected the brief labeled "the voice contract", so non-voice
deliverables were treated as flavor and laundered out across the compression chain. Fixed at the
mechanism (the brief now travels as a binding MANDATE), reframed the heat dial as a publishing-first
content type, and added a conformance backstop that confirms a finished book against its brief.

**Everything below is committed but NOT deployed and NOT yet QA'd in a real browser.**

## Done (committed, on branch `feat/craft-notes`)

| Commit | What |
|---|---|
| `4f771d9` | C1–C4: brief → binding MANDATE (VOICE+MANDATE split, anti-launder in compression, per-page length budget). Verified by an A/B runtime test. |
| `9da9390` | C5 v1: Heat → Content type (publishing-first; AI heat **derived** from it). `brief.heat`→`brief.content_type`, `HeatLevelPicker`→`ContentTypePicker`. |
| `f478be1` | Gate (a) core: `_shared/mandate-gate.ts` + `mandate-gate/index.ts` edge fn + `/mandate-gate/:bookId` bridge route. Verified it flags 1150's misses. |
| `348e505` | Gate surfaced: `lib/mandateGate.ts` + `MandateReport.tsx` + auto-trigger in `WriteAllPages`. |

Verification done: web `tsc` clean, bridge `node --check` clean, deno-check of the gate core clean
(only the pre-existing `EdgeRuntime` ambient error in `task.ts`), bridge route boots + returns 403
auth gate. A/B test proved the mechanism carries heat (fade=0/onpage=5 vs fade=1/onpage=2), 2.2×
length, comedy preserved. Gate independently reproduced 1150's diagnosis (length FAIL 49%, heat FAIL
"laundered to a subordinate clause", genre/success PARTIAL).

## NOT done — pick up here

### 1. Deploy + prod A/B (highest priority — nothing is live)
- `supabase functions deploy` the new `mandate-gate` fn AND redeploy every fn whose `_shared` import
  changed: `beat-core`, `generate-unit-core`, `spine-to-objectives`, `foundations-core` consumers
  (i.e. `generate-book`, `generate-page`, `build-revision`, `spine-to-objectives`, etc.). Standing
  authorization exists to `db push` + `functions deploy` (see memory `feedback_supabase_deploy_ok`).
- **No DB migration needed** — `content_type` lives in the `books.brief` jsonb.
- Re-run the A/B (`/tmp/verify_heat.mjs`, harness still on disk) against the **prod model tier**
  (OpenRouter Qwen/DeepSeek, not Sonnet) — the dev test ran on `claude -p`/Sonnet. The mechanism
  should hold, but the cheaper models may comply less; confirm before trusting it in prod. See memory
  `project_model_stack_openrouter`.

### 2. Manual browser QA of the gate
- Set a book's content type to Explicit + a word target, run "Build the draft", confirm the
  `MandateReport` card renders inline with sensible verdicts. Untested in a real authenticated session.

### 3. Gate report persistence + manual re-check (the v1 gaps)
- Report is **ephemeral component state** in `WriteAllPages` — gone on revisit. Mirror the
  `book_evaluations` pattern: a `book_mandate_reports` table (or reuse `book_evaluations` with a
  `kind`), insert on run, watch over Realtime, surface on load. Add a manual "Check against brief"
  button (re-run after manual edits).

### 4. C5b — wire `content_type` into the PUBLISHING gate (the reason it's "content type")
- This is the *non-AI* consumer the reframe exists for. Surface `content_type` in the publish flow /
  marketplace as a maturity gate: age-gating, content warnings, filtering. See memory
  `project_publish_revalidation` for the publish pipeline. Spec: `brief-mandate-propagation.md` §7.5.

### 5. Optional hardening
- Gate currently fires only from `WriteAllPages` (write-all path). Consider also offering it from the
  Studio's draft/review surface for books written page-by-page.
- The judge axis "beat called for X but prose delivered ¬X" (per-page skip detection) is named in the
  spec but not built — the current gate judges the whole manuscript, not beat-vs-prose deltas.

## Gotchas / invariants (don't trip on these)

- **Bridge-mirror tax:** every generation-prompt change must land in BOTH the edge `_shared` files
  AND `scripts/eval-bridge.mjs` (a full reimplementation for dev) AND web types. Memory:
  `project_dev_bridge_mirror`. The gate already mirrors both sides.
- **Heat is derived, never authored.** Authors set `brief.content_type`; `mandateContext` (edge +
  bridge + web `briefToPromptContext`) derives the heat sentence via `HEAT_LEVEL_SENTENCES`. Legacy
  `brief.heat` is honored as a read-only fallback (`content_type ?? heat`) — don't remove that yet.
- **The gate reports, never blocks.** Keep it that way; a re-roll can consume the report later.
- **Uncommitted files NOT part of this effort:** `BuildStudio.tsx`, `ReviseChat.tsx`, `SpineStep.tsx`
  were modified by other/parallel work — leave them alone.

## Key files

- Spec: `docs/brief-mandate-propagation.md`
- Renderer: `supabase/functions/_shared/brief.ts` (`briefContext`, `mandateContext`, `HEAT_LEVEL_SENTENCES`)
- Gate core: `supabase/functions/_shared/mandate-gate.ts`; edge: `mandate-gate/index.ts`
- Web: `apps/web/src/lib/mandateGate.ts`, `apps/web/src/components/book/MandateReport.tsx`,
  `apps/web/src/components/book/WriteAllPages.tsx`, `apps/web/src/lib/brief.ts`,
  `apps/web/src/components/book/ContentTypePicker.tsx`
- Bridge mirror: `scripts/eval-bridge.mjs` (`mandateContext`, `runMandateGate`, `/mandate-gate/` route)
- Verification harnesses (disposable, in /tmp): `/tmp/verify_heat.mjs` (A/B), `/tmp/verify_gate.mjs`
  (gate vs 1150). Both drive `claude -p`. The book-1150 fixtures are `/tmp/b1150_{meta.json,prose.txt,beats.txt}`.

## Housekeeping
- Stray root files from this effort to relocate/remove: `learning_book1150_critique.md`,
  `learning_length_budget_carrier.md`, `learning_mandate_propagation.md` (subagent learning files;
  the repo root already has ~40 of these from prior work — a separate cleanup).
