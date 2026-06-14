# Beat-sheet revision — context for any session

> **The premise.** Beats are the load-bearing layer. They decide whether the outline (and even the
> brief) makes sense; prose is replaceable. So the author should spend the most time *here*, and AI
> should be able to restructure *here* — not just tweak one beat at a time. This is the surface +
> machinery for revising the **whole beat sheet** as one object.

## The ladder it sits on

`brief → spine → objective → beat → prose`. Objectives and beats both live in `pages.metadata`
(`{ objective, beat, sync: { objective_beat, beat_prose }, … }`). Structure is the ordered page list
(`page_index`); `section` pages are chapter/part dividers. Edge hashes (`_shared/plan-provenance.ts`
↔ `apps/web/src/lib/planProvenance.ts`) track staleness, so the system already knows "this beat
changed → its prose is stale."

## What it does (three parts)

```
The Beat Sheet (whole-book view, inside the Beats step)
   movements → pages: { title · objective · beat }   inline-edit + drag-reorder
   [ Revise with AI ]  → instruction + a knowledge-base LENS (Save the Cat / Fichtean / …)
        │ revise-beats  (edge fn — mirrors revise-outline, beat-aware, plan_only)
        ▼
   a reviewable PLAN (a diff): add / delete / move / retarget objective / rewrite beat
   + character-intro pages + pace notes  (all expressed in the existing RevisionPlan shape)
        │ author approves
        ▼
   build-revision (plan_only) — version snapshot → archive deletes → create adds →
        retarget objectives → WRITE BEATS (stampBeat) → reorder.  NO prose written.
        Downstream prose goes stale automatically → Draft step regenerates on command.
```

### Decisions (locked 2026-06-14)
- **Full structural** AI reviser (add/cut/move pages, chapters, character-intros, pace) — not beats-only.
- Lives **inside the Beats step** (`steps/BeatsStep.tsx`); bulk-generate stays the cold-start.
- On apply: **mark prose stale, don't rewrite** ("prose is replaceable"). The Draft step handles re-render.

## The reuse story (why this is small)

The structural apply path already exists: `build-revision`'s `runStructure` in **`plan_only`** mode
does snapshot + delete + add + retarget + reorder and writes *no prose*. The reviser already exists in
spirit: `revise-outline` → a `RevisionPlan`. We add **one optional field** to the plan contract and
**one write pass** to the apply:

| piece | file | change |
|---|---|---|
| plan contract | `_shared/revision-plan.ts` | `PlanPage.beat?: string` — carried through `sanitizePlan` for keep/add/retarget |
| the reviser | `revise-beats/index.ts` (new) | mirrors `revise-outline`: brief+spine+foundations+full beat sheet+lens → plan with a `beat` per page. Always `plan_only`. |
| knowledge base | `_shared/lens.ts` (new) | maps a structure id → a condensed **beat template** injected into the prompt. Reusable by bulk beat-gen + evaluator later. |
| the apply | `build-revision` `runStructure` | new pass: for each resolved page, if `p.beat` changed → `stampBeat(pageId, objective, beat)` (writes beat + stamps `objective_beat`; leaves prose stale). `add` pages get their beat too. |
| client transport | `apps/web/src/lib/beatSheet.ts` (new) | `reviseBeats({bookId, instruction, lens})` (bridge/edge) + `applyBeatPlan` (opens a `book_revisions` row, `source:'beats'`, `plan_only:true`, kicks `build-revision`). |
| the surface | `steps/BeatsStep.tsx` (+ a `BeatSheet.tsx`) | whole-book editable sheet; mounts the beat editor; the plan diff review. |

`book_revisions.source` is free text (no CHECK) → `source:'beats'` needs **no migration**.

## The beat editor (conversational agent)

Beyond a one-shot reviser, the sheet has a **conversation**: a story editor that holds the whole beat
sheet + foundations + the **fiction criteria** and does three things per message — TALK (summary,
Q&A), EVALUATE (against the criteria), or PROPOSE A CHANGE (a beat revision). "Action vs talk" falls
out of whether the turn returns a plan.

- The whole sheet fits in one context, so **no `revise-agent` tool-loop** — each author message is ONE
  model call. The model replies in **plain markdown prose**, and appends a **trailing ` ```json ` block
  holding the plan ONLY when proposing a change** (`splitReplyAndPlan` in edge + bridge parses
  identically) — *not* Anthropic tool-use, and *not* prose-inside-JSON. Keeping prose out of the JSON is
  why a long/markdown/truncated reply can never corrupt the message (it earlier leaked the raw
  `{"reply":…}` when `JSON.parse` choked on a newline). `BeatChat` renders the reply with `react-markdown`.
- **`beats-agent`** edge fn (+ bridge route) is the **single writer** of a durable thread; the client
  sends a message and projects the row live.
- The 5 structure lenses + "Summarize" / "Evaluate" are quick-action chips that just send templated
  messages. The conversation **subsumed** the old standalone instruction+lens reviser box.

| piece | file | does |
|---|---|---|
| thread | `beat_chats` (migration `20260615000000`) | one row/book: `messages` jsonb + `pending_plan` jsonb + status; RLS=editors; in `supabase_realtime` |
| criteria | `_shared/beat-criteria.ts` | beat-relevant slice (§Character/Plot/Pacing/Genre/Theme) of `fiction-evaluation-criteria.md`, distilled for the prompt |
| the agent | `beats-agent/index.ts` (+ `eval-bridge.mjs` `/beats-agent`) | per-message turn; envelope → `sanitizePlan` → `pending_plan` |
| client | `lib/beatChat.ts` (`sendBeatMessage`/`clearPendingPlan`) + `studio/BeatChat.tsx` | conversation + the PlanReview (apply → `applyBeatPlan`) |

`reviseBeats` (the one-shot fn `revise-beats` + bridge route) stays as the underlying capability but the
UI now routes through the agent.

**The hand-edit sheet (`BeatSheet.tsx` → `Sheet`/`PageRow`)** paginates **one chapter (movement) at a
time** with prev/next so it never sprawls. Each `PageRow` can **regenerate its beat** — the same durable
single-beat run as the cold-start flow (`useAIRun` kind `beat_candidates`, keyed by page, `enabled`
only while regenerating so non-active rows don't subscribe). A fresh result seats into the field
**unsaved** (review, then blur to keep) — never auto-overwrites a hand-written beat.

## The knowledge-base lens

`knowledgebase/creation/structures/*.md` can't be read from a deployed edge fn (not bundled), so
`_shared/lens.ts` holds **condensed beat skeletons** distilled from those docs (Save the Cat 15 beats
w/ % markers, Story Circle 8, Hero's Journey 12, Fichtean, Romancing the Beat 6). The lens is a
*diagnostic frame*, not a straitjacket — the prompt says "use it to find what's missing/sagging, not
to force the book into the template." `lens: null` = pure instruction-driven revision.

## Invariants to preserve
- **Never drop a page silently** — `sanitizePlan` appends any uncarried page as `keep` (keeps beat).
- **Threads** — open setups/payoffs must not be orphaned by deletes/moves (fed into the prompt; same
  guardrail as `revise-outline`). v1 does not re-anchor `book_threads` rows — noted as follow-up.
- **Version snapshot** before any mutation (free via `build-revision`) = the undo.
- **Prose stays** on apply; only its staleness flips. Verify in the Resolution Map / page pips.

## Related
- `docs/build-studio.md` (the Beats step), `docs/multiresolution-outline.md` (the dirty graph),
  `docs/pinned_method.md`. Memory: `project_multiresolution_outline`, `project_build_studio_redesign`,
  `project_revise_with_ai`, `project_sota_roadmap`.
</content>
</invoke>
