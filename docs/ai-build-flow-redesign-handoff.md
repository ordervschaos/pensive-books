# Handoff — implementing the AI build-flow redesign

Companion to **`docs/ai-build-flow-redesign-brief.md`** (the design-facing *why/vision*). This doc is
the *how/where* for the **coding** session that will rebuild the UI. Read the brief first for the
intent; read this to know exactly what to touch, what to preserve, and what will bite you.

**Scope of the redesign:** the `ai` tab of the book page — the build studio + the resolution graph.
Everything else (manuscript editor, reader, prompts, models) is out of scope.

> ⚠️ The design brief is slightly stale on one point: the **Beats** step is now **serial, human-pick**
> (3 takes per page, author picks/edits one, page by page), not "AI plans all beats + judge picks."
> See §5 below. When reconciling, this handoff is the source of truth for current behavior.

---

## 1. Where it lives (file map)

Host / tab shell
- `src/pages/books/show/BookDetails.tsx` — the tabbed workspace. Tabs:
  `brief | manuscript | threads | bible | ai` (`WorkspaceTab`, persisted to localStorage). The `ai`
  tab (around line 715) renders `<JourneyStudio …/>` then `<ResolutionMap …/>`. `briefSet`,
  `book.journey`, `pages`, `isPublic` are computed here and passed down. **This is the mount point any
  redesign plugs into.**

The studio (top half — the "game")
- `src/components/book/JourneyStudio.tsx` — **the orchestrator.** Pinned step rail
  (`brief→spine→outline→voice→beats→draft→read→revise→publish`) + one inline `StepPanel` for the open
  step. Owns all derived step state + the approve() write. **This is the centerpiece to redesign.**

Per-step leaf tools (rendered inside `StepPanel`, switched on `stepKey`)
- `BookBriefSection.tsx` — brief form (step 1)
- `SpineGenerator.tsx` — brief→spine generate+edit (step 2); `onStatusChange(boolean)` reports "spine exists"
- `ScaffoldGenerator.tsx` — outline generation, creates pages w/ objectives (step 3); `onCreated`
- `VoiceGenerator.tsx` — 3 voice samples, pick one (step 4); `onStatusChange`, `onChosen`
- `SerialBeats.tsx` — **serial human-pick beats** (step 5); `onChanged`  ← see §5
- `DraftProse.tsx` — prose generation from beats (step 6); `remaining`, `onChanged`
- `BookEvaluationSection.tsx` — editor's read / critique (step 7); `onStatusChange`, `onRevise`
- `AutoRevise.tsx` — auto-fix critical+major (step 7); `onRevised`
- `ReviseWithAI.tsx` — free-text re-plan/rework (step 8); `prefill`, `onApplied`
- `AIActionRow.tsx` — generic icon+title+desc action row (publish step uses it)
- `RunControls.tsx` — shared **Cancel/Restart** for stuck background runs; embedded in the generators
- `AnimatedEllipsis.tsx` — the "…" loading affordance

The graph (bottom half — the workspace)
- `src/components/book/ResolutionMap.tsx` — the dense `BRIEF→SPINE` + per-page
  `OBJECTIVE→BEAT→PROSE` grid with a "% in sync — N gaps" header; clicking a card opens a side drawer
  to read/edit/regenerate that node. (Large; read it directly when you touch it.)

Shared client logic (DO NOT fork — reuse)
- `src/lib/ladder.ts` — **the only place** that calls the transform endpoints + persists nodes and
  stamps edge hashes. `transforms.*` (briefToSpine, beatCandidates, beatToProse, …), `saveSpine`,
  `saveObjective`, `saveBeat`, `readNode`, `readProse`. Any redesign reuses these verbatim.
- `src/lib/bridge.ts` — `BRIDGE` flag + `bridgeFetch`; dev calls hit the local node bridge, prod hits
  Supabase edge functions. Every `ladder.ts` call branches on this.
- `src/lib/planProvenance.ts` — `metaHash` (cyrb53) + `stampEdge`; mirrored server-side in
  `_shared/plan-provenance.ts`. Hashes must match across the boundary — don't touch casually.
- `src/lib/brief.ts` — `Brief` type + `computeCompletion` (drives `briefSet`).

Dead / orphaned (safe to ignore or delete; not rendered): `BookJourney.tsx`, `PlanBeats.tsx`
(superseded by SerialBeats), `GraphActions.tsx`/`GuidedBuild.tsx` (already deleted).

---

## 2. The data model (what state actually is)

Four real stores. **Everything the UI shows is derived from these — there is no separate UI state
machine.** A redesign must keep reading from exactly these.

| Artifact | Stored at | Shape |
|----------|-----------|-------|
| Brief | `books.brief` (jsonb) | `Brief` (genre/audience/premise/tone/scope.word_target…) |
| Spine | `books.spine` (jsonb) | `{ text, brief_hash }` |
| Voice | `books.bible.voice_sample` | a prose sample string |
| Outline / page | `pages` rows | `page_type: 'text'\|'section'`, `metadata.objective`, `metadata.beat`, `content` (prose) |
| Approvals | `books.journey` (jsonb) | `Partial<Record<'brief'\|'spine'\|'outline'\|'voice'\|'beats'\|'draft', ISO-string>>` |
| Provenance | `pages.metadata.sync[edge]` | `{p,c}` hashes per edge (objective_beat, beat_prose) for staleness |

**Approval is the ONLY non-derivable state.** Existence of a spine, whether every page has a beat,
whether prose is written — all computed from `books`/`pages`. `books.journey[step] = timestamp` is the
one stored "the author signed off" flag. Migration `20260610030000` added `books.journey`.

---

## 3. The derived-state rules (LOAD-BEARING — preserve these)

From `JourneyStudio.tsx` — a redesign can re-skin these but must reproduce the logic, or steps will
unlock/lock wrong:

```
counts        = over non-section pages: objective (has objective, no prose),
                written (has prose body), beats (has metadata.beat)
hasScaffold   = counts.objective > 0 || counts.written > 0
hasWritten    = counts.written > 0
beatsRemaining= max(0, objective + written - beats)
proseRemaining= counts.objective

ready.brief   = briefSet
ready.spine   = hasSpine            (from SpineGenerator.onStatusChange)
ready.outline = hasScaffold
ready.voice   = hasVoice            (from VoiceGenerator.onStatusChange)
ready.beats   = hasScaffold && beatsRemaining === 0 && counts.beats > 0
ready.draft   = hasWritten && proseRemaining === 0
```

Per-step `StepState`:
- BUILD steps (brief…draft): `done` if `journey[k]` set; else `locked` if prior step not approved;
  else `awaiting` if `ready[k]` (Approve button lights); else `active` (tool shown, not yet ready).
- Post-draft: `read` available once `hasWritten`; `revise` available once `hasScaffold`; `publish`
  available once `hasWritten` (`done` when `isPublic`).
- `current` = first BUILD step that's active/awaiting, else read/publish/draft fallback.

`approve(k)` re-reads `books.journey`, sets `journey[k] = now()`, writes back, advances the open panel,
calls `onChanged()` (parent refetch → counts re-derive → next step lights). **Approval flow must stay
this shape.** Note `hasSpine`/`hasVoice`/`hasRead` are reported up via child `onStatusChange` callbacks
(they can't be cheaply derived from `pages`), so any new shell must keep wiring those callbacks.

---

## 4. Backend constraints (so the redesign stays buildable)

- **Dual backend.** Dev (`BRIDGE` on) → `scripts/eval-bridge.mjs` (local Claude CLI, free, **long-lived
  node process, NO auto-reload — must be restarted to pick up route changes**). Prod → Supabase edge
  functions. All routed through `ladder.ts`. A redesign that adds a new call must add it to BOTH.
- **Durable background jobs.** Scaffold, voice, draft prose, evaluate, auto-revise run as
  `book_generations` rows: self-chaining, survive refresh/tab-close, watched live, cancel/restart via
  `RunControls`. The UI must keep showing in-progress + stuck states (brief design §8 states 3–4).
- **Beats are synchronous + client-driven** (a beat is one paragraph) — NOT a durable job. `SerialBeats`
  calls `transforms.beatCandidates` then `saveBeat`, in the browser. No row to watch.
- **Provenance hashes** must agree client/edge (`planProvenance.ts` ↔ `_shared/plan-provenance.ts`).
  Saving a node stamps its edge; the graph's "% in sync / N gaps" reads those stamps. Don't break.

---

## 5. The Beats step today — serial human-pick (current truth)

The design brief still describes the old "AI plans every beat, judge keeps best." **Reality now:**

- `SerialBeats.tsx` walks objective-bearing `text` pages **one at a time, in reading order**. For the
  current page it drafts **3 un-judged takes** (`transforms.beatCandidates(bookId, pageId, objective, 3)`),
  shows them as pick-cards + an editable textarea, the author picks/edits one and hits **"Use this beat
  & continue"** → `saveBeat` → advance to the next beatless page.
- **Forward causal grounding:** because each beat is saved *before* the next page's takes are requested,
  page N+1's takes are generated grounded on the beat the author actually approved for page N
  (`precedingBeat`). This is why takes can't be pre-generated ahead — it's intentionally serial.
- Resumes at the first beatless page; `reqRef` drops stale responses so takes never land on the wrong
  page; a page that already has a beat is seated for review (no re-draft).
- Backend: `_shared/beat-core.ts` exposes `beatCandidates()` (un-judged) alongside `objectiveToBeat()`
  (still judged best-of-n, used by the unattended `generate-book` batch fallback).
  `objective-to-beat/index.ts` + bridge `runObjectiveToBeat` accept `candidates: n` → `{candidates:[]}`.
- **Fallback intact:** `generate-book`'s batch beat stage still judge-picks beats for any page the
  author skips, so jumping straight to Draft never leaves a beatless page. Don't remove it.

**Redesign implication:** the Beats step is a *sequential mini-flow inside one step*, unlike the other
single-shot steps. Whatever new shell you build must host this page-by-page picker (progress "Beat N of
M · X done", per-page objective context, 3 cards, edit box, back/redraft). Status `learning_serial_beats.md`
has the named-concepts breakdown.

---

## 6. The author's complaints driving the redesign (from the brief §6)

1. "What's next" is whisper-faint in the graph (empty beat = faint italic, no momentum).
2. Too much context-switching (brief/spine edits jump tabs; beats open a separate drawer).
3. Rail (sequential, clear) vs. graph (dense, flat) feel like two products, not one surface.
4. Plan vs. prose, whole-book vs. per-page not visually distinct.
5. Stuck/empty/new/done states underdesigned.

North star (brief §7): one coherent surface, obvious next move, **cards that unfold / levels that open**,
review-anything-in-place, legible ladder, game-like-but-calm. States to cover: brief §8.

---

## 7. Suggested first moves for the next session

1. Read the design brief (§5–§9) and this doc's §3 + §5 — the load-bearing logic.
2. Decide the redesign's structural unit. The brief's pull is toward **unfolding cards / opening levels**
   replacing "rail bolted above grid." The cleanest seam: `JourneyStudio` keeps owning derived
   state + approve(), and you reshape only its *presentation* (rail+panel → unfolding stack), keeping
   the per-step leaf tools as-is (they already work). The graph (`ResolutionMap`) is the candidate to
   either fold INTO the per-page cards or keep as the "zoom out" view.
3. Confirm with the user whether ResolutionMap merges into the new surface or stays a separate "map" —
   that's the biggest open structural question and changes the scope a lot.
4. Keep all `ladder.ts` calls, the `book_generations` job/RunControls pattern, and the §3 derived rules.
5. Reskin freely: tokens are `pv-*` (serif, mono, muted ink-on-cream, `--pv-accent`). Tailwind.

**Verify loop:** `npx tsc --noEmit` + `npx eslint <changed>` from `apps/web`; visually check the four
lifecycle states (new book / mid-ladder / running / drafted) on localhost (BRIDGE on; restart the bridge
after any route change).

---

## 8. Open structural questions for the user (resolve before building)

- ResolutionMap: merge into the new card surface, or keep as a separate "map" view?
- Does the unfolding-cards metaphor replace the chip rail entirely, or coexist (rail as a minimap)?
- Per-page scale: a book is 5–150 pages. How do beats/prose cards stay scannable at 150 pages — a
  collapsed-by-chapter accordion? virtualized list?
- Should completed steps collapse to a one-line summary (calm) or stay expandable in place?
