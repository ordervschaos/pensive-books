# State-of-the-art story generation — what's present, what's missing, what to build

**Goal**: stories that are impactful, page-turning, and relevant — where readers don't care
whether it's AI-generated.

**Companions**: `docs/book-generation-flow.md` (the flow + its flaws C1–C10),
`docs/state-axis-implementation.md` (the three-ledger design),
`docs/multiresolution-outline.md` (the ladder model).

**The one-line diagnosis**: the system has three organ systems — a planner (the ladder), a
judge (the eval rubric), and revision paths — but no circulation between them. Everything is a
single forward pass with author-triggered revision bolted on. State-of-the-art output is not a
better first draft; it is loops. The infrastructure for loops (durable tasks, self-chaining,
watchdog, $0.33 whole-book eval) already exists and is the hard part; the wiring is the easy part.

```
        Brief → Spine → Objectives → Beats → Prose      (ladder: down in resolution)
                  │         │          │       │
  ledgers ──── character / promise / causality ┤        (forward in story time)  ← MISSING
                  ↑         ↑          ↑       │
  rubric ─────────┴─────────┴──────────┴───────┘        (backward as pressure)   ← EXISTS, UNWIRED
```

---

## 1. What's present

| Asset | Where | Status |
|---|---|---|
| Resolution ladder (brief→spine→objective→beat→prose) | edge fns + `lib/ladder.ts` | ✅ solid, but the beat rung is bypassed by default writes (flaw C2) |
| Durable task pattern (task row + Realtime + self-chain + watchdog) | `_shared/task.ts`, `self-chain.ts`, pg_cron | ✅ genuinely solid — this is the chassis every loop below runs on |
| Continuity context (outline + story-so-far summaries + prev-2-pages prose) | `_shared/generate-unit-core.ts` → `buildUnitContext()` | ✅ works; the single chokepoint for injecting any new state |
| Eval rubric ("editor's read") | `evaluate-book/rubric.ts` | ✅ strong — already measures arc-as-diff, proactivity, foreshadowing payoff, subtext, voice ("what would change with a different writer?") |
| Bible (characters/world/style as static markdown) | `generate-bible`, `books.bible.text` | ⚠️ has want/wound per character, but static text — never updated as the story moves |
| Threads (promise/payoff plan: setup/payoff page, target distance) | `spine-to-objectives` scaffold output, `scan-threads` | ⚠️ planned at scaffold time, then **never injected into any render**; anchors drift on reorder (C7) |
| Revision machinery | `revise-prose`, `revise-node`, `revise-outline`, `build-revision` | ✅ exists; author-triggered only |
| Provenance / dirty graph (edge hashes mark stale rungs) | `lib/planProvenance.ts` | ⚠️ dead at the top — spine→objective never stamped (C1) |
| AI call logging + LLM-as-judge per call | `ai_calls`, `ai_call_evals`, `_shared/claude.ts` | ✅ observability for everything below |
| Prompt-cache discipline (stablePrefix/variablePart split) | `generate-unit-core.ts` | ✅ preserve it — new per-page state goes in the variable part |

**Net**: coherence plumbing is mostly built; quality pressure is entirely absent.

## 2. What's missing

Ordered by how much each one separates "competent" from "doesn't read as AI."

### M1 — Nothing pressures the plan (the ceiling problem)
Prose can never be better than the beats it renders, and `spine-to-objectives` is a single
sample from a formula-prompted model ("Save the Cat or the Hero's Journey…"). One sample = the
*modal* story for the premise, and the modal story is exactly what reads as AI. No critique
pass, no best-of-n, no "is any of this surprising-yet-inevitable?" check before 100 prose calls
are spent rendering it.

### M2 — No voice artifact (the biggest single AI tell)
The style contract is a few brief bullets + a `## Style & Voice` section buried in bible
markdown. Instructions don't produce voice; **exemplars** do. There is no calibration sample —
no 300–500 words of "this is what this book sounds like" carried into every render.

### M3 — No closed eval→revise loop
`generate-book` finishes and stops. The $0.33 editor's read, the issue-shaped `revise-prose`
input, and the self-chaining chassis all exist — they're just never chained: write → eval →
revise → re-eval is four existing pieces with no pipe between them.

### M4 — The state axis (three ledgers; full design in `state-axis-implementation.md`)
- **Character ledger**: characters reset every page; want/wound exist as static bible text but
  no per-page state (knows/feels/has/believes) flows forward. Arc = diff(initial, final) is not
  representable.
- **Causality rule**: `objective-to-beat` never sees the preceding beat, so beats connect by
  "and then" — episodic drift is structurally guaranteed.
- **Promise enforcement**: threads are planned then ignored; nothing tells the prose renderer
  "this loop is open — withhold" or "this page is the payoff — resolve."

### M5 — Beats plan events, not subtext or texture
The beat schema is "what happens, in order." The rubric demands subtext (characters speak
*around* what they mean) and telling detail — but the renderer has to invent both, so it states
emotions on the nose and furnishes scenes generically (AI tells #2 and #3 after voice).

### M6 — Pre-existing flaws that the above will stand on (from `book-generation-flow.md`)
C2 (beat rung bypassed — **must fix first**: every ledger and causality change lives in beats,
so beats must become a real step in the default write path), C1 (spine drift invisible),
C7 (thread anchors drift), C4 (out-of-order writes silently lose continuity).

## 3. What's implementable (tiers, with cost and files)

The chassis (durable tasks + self-chain) means **none of these need new infrastructure** — they
are prompts, context-loading, and chaining of existing pieces.

### Tier 1 — days, cents per book, no schema change
| # | Change | File | Notes |
|---|---|---|---|
| 1.1 | **Make beats a real step**: "generate all beats" pass before prose in `generate-book` (resolves C2; prerequisite for everything below) | `generate-book/index.ts`, `objective-to-beat` | beats are 1-paragraph Sonnet calls — cheap |
| 1.2 | **Causality + value-flip in beat prompt**: pass preceding beat; require therefore/but, never "and then"; require one value flipped | `objective-to-beat/index.ts` | ~30 lines; biggest coherence win per line of code |
| 1.3 | **Subtext + texture in beat schema**: beat also names "said vs. meant" and one concrete image | same file, same edit | rides along with 1.2 |
| 1.4 | **Plan critique loop**: after scaffold, run rubric Plot+Character sections against the *plan* (few-k tokens), revise scaffold once, then show the author | `spine-to-objectives/index.ts` | the highest leverage in the whole list — errors compound downward |
| 1.5 | **Open loops into prose context**: load threads, mark reveal/withhold per page | `generate-unit-core.ts` → `buildUnitContext()` | requires thread status tracking (1 column) |

### Tier 2 — a week-ish, ~$1–3 per book, small schema additions
| # | Change | Notes |
|---|---|---|
| 2.1 | **Voice sample artifact**: generate 3 candidates at high effort, author picks, store in bible, carry in stable prefix of every render as few-shot anchor + banned-cliché list | new field in `books.bible`; touches `stablePrefix()` |
| 2.2 | **Character state ledger**: seed initial states at scaffold; cheap Haiku pass after each beat extracts updated states into `pages.metadata.character_states`; inject prior states into beat + prose context | per `state-axis-implementation.md` P3 |
| 2.3 | **Closed write→eval→revise loop**: `generate-book` chains into `evaluate-book`, auto-feeds critical/major issues into `revise-prose` per page, re-evals as regression check | pure plumbing of existing fns |
| 2.4 | **Beat best-of-3**: sample 3 beats, judge picks (beats are a paragraph — cents) | `objective-to-beat` |

### Tier 3 — structural, do after the loops prove out
3.1 Thread anchors as durable FKs with status lifecycle (fixes C7) · 3.2 chapter-scale tension
curve encoded at spine level · 3.3 parallel fan-out for beats (order-independent, unlike prose)
· 3.4 voice-drift detector across chapters (embedding or judge-based).

**Sequencing rule**: 1.1 → 1.2/1.3 (one edit) → 1.4 → 1.5 → 2.x in any order. Don't start
Tier 2 polish before Tier 1 — a beautiful voice on an episodic plot is lipstick.

## 4. Human involvement & collaboration pattern

### The principle
Author attention is the scarcest resource in the system. Spend it **where errors compound**
(top rungs: premise, plan, voice) and **where taste is irreplaceable** (what story is worth
telling, what it should sound like, which eval findings actually matter). Automate where the
rubric can judge (line-level prose). The failure mode to avoid: 50 per-page approval dialogs —
the author becomes a line editor, fatigues, and rubber-stamps. The role is **editor-in-chief,
not line editor**.

### Review gates today (uneven — see C5)
| Artifact | Today | Verdict |
|---|---|---|
| Brief | author types it | ✅ correct — the one purely human artifact |
| Spine | diff in node sheet | ✅ correct |
| Scaffold | review/edit dialog before pages exist | ✅ correct — the strongest gate, keep it |
| Beats | reviewed only if hand-made in graph | ❌ inconsistent |
| Prose | `WriteNextPage` auto-writes; `ProseNodePanel`/workshop propose-first | ❌ two trust models on one surface (C5) |
| Eval | read-only report; author triages into revise | ✅ correct shape |

### Target pattern — five gates, everything else automated

```
GATE 1  Brief + premise        author WRITES (relevance & "why this story" cannot be delegated)
          ↓ auto: brief→spine
GATE 2  Spine                  author approves/edits the throughline (1 paragraph, 1 minute)
          ↓ auto: scaffold → plan-critique loop (1.4) → revised scaffold
GATE 3  Plan                   author reviews ONE post-critique plan: pages + threads + initial
                               character states. Approving here authorizes the whole build.
          ↓ auto: voice candidates (2.1)
GATE 4  Voice                  author PICKS from 3 samples — a taste call, not a review chore
          ↓ auto: beats (causality-checked, best-of-n) → prose (ledger-fed)
          ↓ auto: eval → auto-revise critical/major → re-eval        ← no human in this loop
GATE 5  Editor's read          author reads the FINISHED book + the eval report; triages
                               remaining issues into revise passes; reads as a reader, flags
                               what the rubric can't feel (the Longinian "will this stay with
                               me" test — the judge approximates it, the human owns it)
```

Roles: **author = showrunner** (premise, plan approval, taste calls, final read) ·
**AI = writers' room + line editor** (beats, prose, self-revision) · **rubric = story editor**
(automated pressure at every rung).

### Collaboration rules of thumb
- Review **low-resolution artifacts** (spine, plan, voice sample — small, high-leverage,
  pleasant to read); never gate on high-resolution ones page-by-page during a bulk build.
- Every gate must survive a refresh — proposals live in `book_generations` rows, never React
  state (already the pattern; extend it to gates 3–4).
- Between gates 4 and 5 the author can still intervene anywhere via the graph (node-level
  regenerate/revise) — gates are defaults for the bulk path, not locks.
- What stays human forever: choosing what story to tell, the voice pick, deciding which eval
  findings matter, and the final is-this-actually-good read. Everything else is a candidate for
  the loop.

---

## 5. Decided architecture (planning session 2026-06-10)

Decisions made: build runs unattended by default with a **per-build "pause for beat review"
checkbox**; auto-revise handles **critical + major, one round**, minors wait for gate 5;
**milestone 1 = Phase A + voice**; **WriteNextPage upgrades to beat-first** (one trust model,
no second class of book).

### Product: BookJourney is the gate rail

`BookJourney.tsx` already derives every step's status from real data and hard-locks AI actions
until prerequisites exist. **Keep that pattern — approvals are artifacts existing, never a
parallel state machine.** The evolution:

```
1 Create            (unchanged)
2 Brief      GATE 1 (unchanged)
3 Spine      GATE 2 NEW step — status: books.spine.text set; fixes C3 (spine becomes real)
4 Plan       GATE 3 upgraded — scaffold self-critiques before the author sees it (same dialog)
5 Voice      GATE 4 NEW step — pick 1 of 3 samples; status: voice_sample saved in books.bible
6 Build             upgraded — ONE action: beats → prose → eval → auto-revise → re-eval;
                    checkbox "pause for beat review" (default off) stops after the beat phase
7 Editor's read GATE 5 (unchanged — the human read; the build's internal eval is machinery)
8 Revise            (unchanged — the post-gate-5 loop)
9 Publish           (unchanged)
```

Build progress is composed client-side from the task rows (`useLatestTaskRow`) and shows the
phase: "Planning beats 12/40 → Writing 3/40 → Editor pass → Revising 2 pages".

### Technical: milestone 1 work breakdown (Phase A + voice)

| # | Work | Where | Notes |
|---|---|---|---|
| 1 | Extract `_shared/beat-core.ts` | from `objective-to-beat/index.ts` | mirrors `generate-unit-core.ts`; sync endpoint keeps `{beat}` contract |
| 2 | Beat prompt upgrade | `beat-core.ts` | inputs: preceding beat + threads on this page; requires therefore/but, one value flip, said-vs-meant, one concrete image; output stays ONE paragraph |
| 3 | `generate-book` phases | `generate-book/index.ts` | `progress.phase: 'beats'\|'prose'`; beats sequential (causality needs order), ~5/invocation; pause: if `input.pause_after_beats`, set `status='ready'` + `phase='beats_done'`; client "Continue" re-kicks (authenticated, verifies access, reinvokes chain) |
| 4 | Plan critique loop | `spine-to-objectives/index.ts` | draft → critique vs rubric Plot+Character+genre-contract → revise once; `result = {structure, pages, threads, critique}`; dialog can show "what the critique caught" |
| 5 | Open loops into context | `generate-unit-core.ts` → `buildUnitContext()` | `book_threads` lifecycle already fits (planned→open→closed, zero schema): setup page = "seed", open elsewhere = "withhold", payoff page = "resolve"; cascade prose phase maintains status |
| 6 | Stamp `spine_objective` | `ScaffoldGenerator.tsx` (client creates pages, so client stamps at apply) | one-line C1 fix |
| 7 | `WriteNextPage` beat-first | client + shared cores | beat (causality-checked) then prose; stays the attended non-admin default |
| 8 | Voice artifact | new `book_generations kind='voice'`; `books.bible` JSONB grows `voice_sample`; journey gate-4 picker; inject in `stablePrefix()` as few-shot exemplar + banned-cliché list | independent of cascade work — parallelizable |
| 9 | Journey rail edits | `BookJourney.tsx` | add Spine + Voice steps; step 6 becomes "Build the draft" with the pause checkbox |

Milestone 2 (Phase B remainder): character ledger (`books.characters` migration + per-beat Haiku
state extraction into `pages.metadata.character_states`), the closed eval→revise chain
(`generate-book` → `evaluate-book` → critical/major issues → `revise-prose` → one re-eval, all
via the existing `reinvoke`/CHAIN_SECRET mechanism, each activity its own task row), beat
best-of-3.

### Implementation status (built 2026-06-10)

Shipped + deployed (prod project `qiqeyirtpstdjkkeyfss`); web typechecks clean, all functions boot:

| # | Item | Status |
|---|---|---|
| 1 | `_shared/beat-core.ts` extracted; `objective-to-beat` delegates, keeps `{beat}` | ✅ |
| 2 | Beat prompt upgraded (prev-beat + threads in; therefore/but, value flip, subtext, concrete image) | ✅ |
| 3 | `generate-book` two-stage (`stage: beats\|prose`); beats ≤5/invocation in order; pause→`status='ready'`+`phase='beats_done'`; authenticated `resume` re-kicks | ✅ |
| 4 | Plan-critique loop in `spine-to-objectives` (draft→critique→revise once; `result.critique`) + shown in scaffold dialog | ✅ |
| 5 | Open loops into `buildUnitContext()` (seed/withhold/payoff, zero schema); prose cascade `maintainThreads()` flips planned→open→closed | ✅ |
| 6 | `spine_objective` stamped at apply in `ScaffoldGenerator` (C1) | ✅ |
| 7 | `WriteNextPage` beat-first (drafts+saves a beat before prose) | ✅ |
| 8 | `generate-voice` (kind `voice`, 3 samples) + `VoiceGenerator` picker + `books.bible.voice_sample` injected in cached `stablePrefix` w/ AI-tell blocklist | ✅ |
| 9 | Journey rail: **Voice** step added (gate 4, before Write); Build CTA gets the pause checkbox + Continue panel + phase label | ✅ |

**Deferred (deliberate, flagged):**
- The **Spine rail step** (doc's gate 2) — spine is still set via the Resolution Map, not the journey; C3 only partly closed. Voice was prioritized (it carries a success criterion; spine has an existing surface).
- **Dev bridge parity** (`scripts/eval-bridge.mjs`) — not updated: no `generate-voice` route, and its `objective-to-beat`/`spine-to-objectives` prompt mirrors now lag the edge prompts. Prod is the source of truth; dev voice-gen no-ops. Re-sync before trusting the bridge for offline eval.
- **Migration version**: voice-kind is `20260610010000_voice_kind.sql` (the `…000000` slot was taken by `revert_page`).

### Success criteria (verify before calling milestone 1 done)

1. A bulk build on a fresh test book produces a beat on **every** text page before any prose
   exists (C2 dead rung is alive).
2. Spot-check 5 consecutive beats: each names its connection to the previous (therefore/but)
   and a value flip — no "and then" pair.
3. `ai_calls` rows for prose renders show open-loop blocks and the voice sample in the prompt;
   thread rows flip planned→open→closed as their anchor pages are written.
4. Scaffold result rows contain a non-empty `critique`; the post-critique plan differs from the
   draft (the loop did work).
5. The pause checkbox actually pauses (row `status='ready'`, `phase='beats_done'`) and Continue
   resumes the same row.
6. Before/after eval scores on the same brief: one book built pre-milestone vs post — the
   editor's read should improve specifically on Plot Logic, Character Arc, and Voice.
