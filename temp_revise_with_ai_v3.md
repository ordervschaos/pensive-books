# v3: "Revise with AI" — generic, conversational, durable revision tasks

Date: 2026-05-29
Type: code change

## What the author asked for
Move past the eval-locked one-click rewrite. Needed:
1. **Generic intent** — a free-text "describe the change you want" box, not just the editor's notes.
2. **Conversational + transparent** — propose a plan, let the author choose, surface *what each
   page-change achieves* before building.
3. **Durable, resumable tasks** — if the modal/tab closes, stop cleanly or resume from the book
   page; never waste AI work; results visible on book details.

## Decisions (user)
- **Client-driven** build (not a headless server worker) — keeps the free local `claude -p`
  bridge path working in dev; the cloud edge can't reach localhost.
- **Single round** (intent → editable plan → build), not multi-turn chat (follow-on later).
- Shared architect: free text and editor's notes both feed the SAME `replan-from-notes` /
  `/replan` endpoint via an `instruction` param.
- Placement: **own top-level "Revise with AI" section** on book details, above the editor's read.

## Durability model (and the one caveat)
The task lives in a new `book_revisions` row on Realtime — generalizes `book_evaluations`.
- Completed pages persist immediately (drafts); `progress` records per-page state.
- Reopen the book → if a row is `building`, the UI shows live status + **Resume** / **Cancel**.
- Resume is idempotent: structural steps record `addedIds` + `structureDone`; the prose cascade
  skips pages already `done`.
- **Caveat (accepted):** closing the tab wastes at most the single in-flight page, which Resume
  redoes (free on the bridge). Making even that survive would need prose-persistence moved into
  the workers — deliberately not done (minimum code).

## Files
- `supabase/migrations/20260529000000_create_book_revisions.sql` — NEW table + touch-updated_at
  trigger + RLS (user_can_edit_book; client INSERT/UPDATE) + Realtime publication. **Applied to
  remote** via `supabase db push`.
- `supabase/functions/replan-from-notes/index.ts` — architect now takes `{ bookId, evaluation?,
  instruction? }`; requires at least one; AUTHOR'S INSTRUCTION block is the primary directive.
- `scripts/eval-bridge.mjs` — `/replan` mirror: `runReplan(bookId, evaluation, instruction)`,
  generalized REPLAN_INSTRUCTIONS, route passes `body.instruction`.
- `apps/web/src/components/book/ReviseWithAI.tsx` — NEW. Owns the whole lifecycle off the row:
  input form (textarea + attached-eval chip), planning, review dialog (per-page op + objective +
  why), resumable/cancellable build cascade with a live per-page changelog, Realtime watch.
- `apps/web/src/components/book/BookEvaluationSection.tsx` — dropped the inline v1/v2 buttons;
  added an `onRevise(result)` prop → a single "Revise with AI →" hand-off.
- `apps/web/src/pages/books/show/BookDetails.tsx` — renders `<ReviseWithAI>` (top-level) +
  `revisionPrefill` state wiring eval → revise; `onApplied` refreshes via `fetchBookDetails`.
- `apps/web/src/lib/inlineMarkdown.ts` — comment touch-up (buildDoc consumer rename).
- **Removed** (folded into ReviseWithAI): `ApplyEditorNotes.tsx`, `ReviseStructure.tsx`.

## Verification
- web `tsc --noEmit`: clean (exit 0). bridge `node --check`: clean.
- `book_revisions` round-trip (service role): insert + jsonb `progress` + UPDATE + updated_at
  trigger fire + delete — all OK.
- Migration applied to remote (db push; idempotent guards noticed, no errors).
- Instruction-only architect path (new free-text, no eval) via the rebuilt bridge: **PASS** —
  HTTP 200 in 100s; honored "no new chapters" (add:0, deletes:0); surgical (35 keep / 2 retarget
  / 13 revise); every page carried (50/50, no silent drop); `why` tied to the author's directive.
- **Parity fix (found by the test):** the bridge's `runReplan` auto-loaded the last stored
  evaluation as a fallback even for a pure instruction — folding old editor's notes into "tighten
  the opening." The edge fn never did this. Fixed: bridge now uses the stored report ONLY when
  there's no instruction (`evaluation ?? (instr ? undefined : loadReport(...))`). node --check clean.

## Still to verify live (in-browser, needs a running dev app + bridge)
- Full flow: type instruction → Plan → review dialog → Build → drafts; reload mid-build shows
  Resume/Cancel; cancel stops between pages; resume finishes.
- Edge path (prod) parity: deploy `supabase functions deploy replan-from-notes generate-unit`.

## Known limitations
- Concurrency: Resume is manual; two tabs resuming the same row simultaneously would race
  (acceptable for single-author MVP — not guarded).
- Bridge is slow (~minutes/page, fresh `claude -p` per call); the edge/API path is the realistic
  one for large rebuilds.
