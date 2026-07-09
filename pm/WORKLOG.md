# WORKLOG — append-only catalogue of work

> The **firehose**. Every completed unit of work lands here as one dated entry, newest first.
> Where `STATE.md`/`ROADMAP.md` are the *curated projection* (one row per project, ranked),
> this is the *raw event log* (one entry per task). Think event-sourcing: cheap appends here,
> a hand-curated read-model there.
>
> **Never loaded whole into an agent session — grep, never load.** It can grow forever at zero
> context cost. Don't summarize it, don't `Read` it end-to-end, don't rank it. Just append. A
> *targeted* lookup is fine and encouraged — `grep -A3 '<topic>' pm/WORKLOG.md` to answer "when
> did we touch X and what happened?" costs a few hundred tokens; a full load costs the whole file.
> The rule is point-lookups yes, full scans never.
>
> Written by the **`/wrap`** ritual at the end of a task. Impact tags:
> `ship` (landed → promote to STATE) · `decision` (→ DECISIONS) · `park` (→ STATE/ROADMAP) ·
> `wip` (in progress, no promotion) · `chore` (housekeeping, no promotion).

<!-- NEWEST ENTRIES GO DIRECTLY BELOW THIS LINE (prepend, do not append at the bottom) -->

## 2026-07-09 — Session touched no project files (VS Code tab-naming question) `[chore]`
- **What:** User asked an environment/tooling question (how to auto-rename VS Code integrated-terminal
  tabs / Claude Code sessions via a hook) unrelated to the pensive-books codebase. No files in the repo
  were edited by this session; the pre-existing uncommitted diff (proseProxy/llm/book-agent/DNA changes,
  pm/* edits) predates this session and belongs to prior work already in flight.
- **Files/commits:** none touched this session.
- **PM impact:** none — logged only to satisfy the Stop-hook catalogue requirement.

## 2026-07-09 — MuleRouter takeover switch for model spend `[ship]`
- **What:** OpenRouter ran dry mid-run (402 "Prompt tokens limit exceeded" — their prompt cap scales with balance), killing the agent's lint-fix run. User has MuleRouter balance, so: `_shared/llm.ts` now routes slashed OpenRouter ids with a bare-id MuleRouter equivalent (qwen3.7-plus, deepseek-v4-*, gpt-5.5 + full catalogue allowlist) to `api.mulerouter.ai/vendors/openai/v1/chat/completions` whenever the `MULE_ROUTER_API_KEY` secret is set — unset it to flip back. Twin mapping in `apps/web/api/_proseProxy.ts` for prose streaming. Tool calling verified on MuleRouter before cutover. NOT covered (no Mule equivalent, still OpenRouter): qwen3-235b-a22b (digest model), qwen3-8b (low tier), kimi/glm/minimax tiers. Secret set in Supabase edge env + Vercel prod/dev (preview skipped — old CLI loops); all 10 llm.ts-importing edge fns redeployed.
- **Files/commits:** supabase/functions/_shared/llm.ts, apps/web/api/_proseProxy.ts (uncommitted). Discovered en route: pensive Vercel project has NO OPENROUTER_API_KEY in prod — prod prose streaming was likely already broken.
- **PM impact:** memory project_model_stack_openrouter updated with the takeover switch; no STATE row (infra/spend switch, not a product project).

## 2026-07-09 — Node inspector: surface computed-but-hidden per-node/relational signals `[ship]`
- **What:** Follow-up to the lint-visibility audit: user asked to surface every signal the DNA
  engine already computes but never renders, "even if not actionable" — e.g. `ledgerAt` (what's
  true entering a scene), `causality` (a beat's needs/produces/reversed chain, today only a
  pass/fail glyph), per-beat meter values (only ever shown aggregated), a scene's own raw prose
  stats (dialogue %, em-dash rate, sentence-length CV — computed then discarded by the lints),
  and fields already stored on nodes with zero UI readers (`prose_digest`,
  `observed_value_carrier`, `observed_fingerprint`, `observed_shape_fit`, `observed_craft`).
  Extended the existing per-node "view details" modal (`NodeDetailsModal`, already reachable from
  every tree row) with a new kind-conditional "Analysis" section: scene/beat/act/pillar/premise
  each get their own block, built from mostly-existing pure functions plus two small new ones
  (`sceneProseStats`, `beatMeterReadings`). Plan approved via EnterPlanMode
  (`~/.claude/plans/fizzy-doodling-eich.md`, overwritten from the earlier Meters-merge plan).
  Typechecked clean. **Visually confirmed** by the user via screenshot: opening a scene node's
  "view details" now shows the new "PROSE STATS" section (words / dialogue share, with em-dash
  rate + sentence CV below the fold) directly under the existing prompt/output provenance —
  beat/act/pillar sections not individually screenshotted but share the same code path.
- **Incident, logged for the record:** while navigating to find a scene node to test, a click
  intended for a Tree-tab breadcrumb pill instead landed on a live AgentRail "next step" card —
  that book (1229) already had auto-accept armed from an earlier session. This kicked off an
  autonomous agent run that applied two real prose-echo fixes (scenes 6 and 25) before hitting an
  OpenRouter 402 (out of credits) and halting on its own. Surfaced this to the user immediately
  before continuing; user reviewed and said leave both edits (they're legitimate echo fixes).
  Note for future sessions: this book has auto-accept ON — breadcrumb/stage-pill clicks near the
  rail carry real side-effect risk, navigate carefully or check the rail's mode first.
- **Files/commits:** `apps/web/src/features/dna/lib/novelDna.ts` (2 new exported functions),
  `apps/web/src/features/dna/components/tree/modals.tsx` (`NodeAnalysis`/`Section`/`Row` +
  `NodeDetailsModal` gains a `nodes` prop), `apps/web/src/features/dna/pages/DnaTreePage.tsx`
  (pass `nodes` at the call site). Not committed yet.
- **PM impact:** none filed — a visibility feature, not a roadmap-tracked project.

## 2026-07-09 — De-serialized the agent loop (batching, fan-out, cache-stable prompt) `[ship]`
- **What:** Implemented the 4-part speed fix from today's analysis: (1) `<autonomous_mode>` + post-apply ack now mandate batching INDEPENDENT edits into one propose_node_ops (was "ONE change per turn"); (2) new "Working efficiently" system-prompt section tells the model to issue all independent read_node/search_nodes calls in the SAME turn; (3) toolResults refactored to execTool + Promise.all fan-out (contract check's plan+mandate judges also concurrent), auto-verify's per-scene judges parallelized; (4) threadSystem split into byte-stable `instructions` (cached system prompt) + volatile `bookState` injected request-time at the tail of the latest user message via new `withBookState` (never persisted) — the prompt-cache prefix now survives auto-mode applies instead of missing every turn. Deployed; deno check clean vs baseline (28 pre-existing EdgeRuntime errors only).
- **Files/commits:** supabase/functions/book-agent/index.ts (uncommitted); analysis in doc_1783588839417.md.
- **PM impact:** new "Agent speed (de-serialize the loop)" row in STATE §Agent, shipped (code) — success bar recorded there; verify on the next live auto run (ai_calls cache-read tokens + turn count).

## 2026-07-09 — Diagnosed the agent's slowness: four compounding serializations `[wip]`
- **What:** Analysis only (no code yet). The AgentRail agent fixes lints one at a time because of: (1) the `<autonomous_mode>` "ONE change per turn" rule applied even to independent fixes (propose_node_ops already accepts batched ops); (2) no prompt instruction to batch parallel read_node calls in one turn; (3) serial `for…await` in toolResults/maybeInjectRenderVerify (LLM judge calls back-to-back); (4) the live tree digest inside the system prompt invalidates the whole prompt-cache prefix every auto-mode apply. Fix plan ranked: prompt edits → Promise.all → move volatile state to request-time injection after the transcript. Bar: 7-lint run in ≤4 model calls.
- **Files/commits:** doc_1783588839417.md (analysis; uncommitted). No source changes.
- **PM impact:** none (awaiting go-ahead to implement).

## 2026-07-09 — DNA tab-strip chrome cleanup `[chore]`
- **What:** User flagged the errors/warnings pip duplicated in both the below-tabs bar and the
  Tree tab's journey strip — removed it (Analytics tab still has the full breakdown). Moved the
  "More" overflow menu (json/fork/history) out of those per-tab rows into the tab strip itself,
  right-aligned, so it's now one consistent control across all tabs instead of shifting per-tab.
  Also removed the horizontal rule under the tab strip per a follow-up screenshot, so the active
  tab now fuses directly into its content with no seam. Verified live via chrome-devtools MCP
  against the running dev server (book 1229, Analytics + Tree tabs).
- **Files/commits:** `apps/web/src/features/dna/pages/DnaTreePage.tsx` (uncommitted).
- **PM impact:** none — pure chrome polish, no roadmap/decision change.

## 2026-07-09 — Blended Meters into Analytics; added the missing Ledger trigger `[ship]`
- **What:** Follow-up to explaining the lint system: user pointed at the Meters tab's working
  Shape/Craft/Cold-read/emotional-trace buttons and asked for one comprehensive "what's wrong +
  every trigger" surface. Extracted `LedgerPane.tsx` (new, mirrors `MetersPane`'s pattern) from
  `DnaLedgerPage.tsx`'s body — the continuity-ledger/`read-facts` trigger that previously had no
  UI anywhere in the studio tab bar, only an orphaned standalone `/dna/ledger` route. Restyled it
  off hardcoded hex onto the shared `T` tokens so it renders correctly embedded in Analytics (both
  Paper/Terminal themes). In `DnaTreePage.tsx`, folded `MetersPane` + the new `LedgerPane` into the
  `analytics` tab body (after the lint list, before pacing/promises/topography) and removed
  "meters" as a separate top-level tab (type union, path ternary, tab-bar entry, its own render
  block). `DnaLedgerPage.tsx` slimmed to a thin wrapper exactly like `DnaMetersPage.tsx`. Plan
  approved via EnterPlanMode first (`~/.claude/plans/fizzy-doodling-eich.md`).
- **Files/commits:** `apps/web/src/features/dna/components/tree/LedgerPane.tsx` (new),
  `apps/web/src/features/dna/pages/DnaLedgerPage.tsx`, `apps/web/src/features/dna/pages/DnaTreePage.tsx`.
  Typechecked clean (`tsc -p apps/web/tsconfig.app.json`). Verified live in-browser by the user on
  book 1229 (`fork-of-fork-of-mastering-freedom-v3`) — screenshots confirm the merged Analytics
  tab renders lints → Shape → Craft → Cold read → Ledger (new) → pacing/promises/topography, tab
  bar no longer shows Meters. Not committed yet.
- **PM impact:** none filed yet — this closes part of the gap the "DNA UI self-explanatory pass"
  Next item flagged (`pm/ROADMAP.md`); worth a follow-up decision line once committed.

## 2026-07-09 — AgentRail Stop button: cut real + perceived latency `[ship]`
- **What:** User-reported bug: clicking Stop on the AgentRail chat didn't free the UI for the next
  message. Traced root cause: Stop is COOP-cancel (`stopRun.ts` only flips `cancel_requested`);
  the composer's `disabled` is gated on server-authoritative `status`, which only flips to
  `cancelled` once `book-agent`'s in-call poll notices the flag — that poll ran every **5s**, so
  worst case the textarea sat dead with zero feedback for up to 5s. Investigated whether the
  composer could unlock immediately instead (skip the wait entirely): no — `book_agent_runs` has
  one thread row per book with no DB mutex, only an app-level one (client `active` guard + server
  409 on `status IN (running, awaiting_input)`); sending before the row reaches `cancelled` would
  just 409 silently, so unlocking Send early is unsafe. Shipped the two safe wins instead: (1)
  `supabase/functions/book-agent/index.ts` poll interval 5000ms → 1000ms — cuts the real
  worst-case abort latency 5x; (2) `AgentRail.tsx` — new local `stopping` state flips synchronously
  in `stop()` before the network round-trip, so the Stop button's spinner/tooltip reflects the
  click instantly instead of waiting on `stopRun()`'s await + a refetch SELECT to land
  `row.cancel_requested`; resets via `useEffect` once `running` goes false. Textarea itself stays
  gated on `active` (unchanged — correctly so, per the mutex above).
- **Files/commits:** `supabase/functions/book-agent/index.ts` (poll interval), `apps/web/src/features/dna/components/AgentRail.tsx` (`stopping` state + button conditions). Deployed `book-agent` via `supabase functions deploy`. Typechecked clean (`tsc -p apps/web/tsconfig.app.json`). Not yet exercised live in-browser (Claude-in-Chrome extension wasn't connected this session) — verify on next live AgentRail use, tied to the Now #1 "re-exercise the live full-book build" item.
- **PM impact:** none — small bugfix, not a roadmap-tracked project; no STATE/ROADMAP row to move.

## 2026-07-09 — DNA UI self-explanatory pass: audited + ratified + Analytics fix designed `[decision]`
- **What:** User asked (via `/pm`, two screenshots of Tree + Analytics tabs) to make the whole
  DNA Studio self-explanatory. Audited the real code (not just the screenshots) — found the gap
  is mostly hover-only content (real copy exists, e.g. `KIND_EXPLAINER`, but is undiscoverable),
  with Analytics/lints as the one place with a genuine content gap (no why/fix copy) plus a
  narrower `dangling_ref` field-clarity gap. Corrected a first-pass mistake along the way: the
  screenshot's lint list is actually rendered by a hand-rolled block in `DnaTreePage.tsx`, not
  `DnaAnalysis.tsx`'s lints section (which is dead code, always hidden) — click-to-jump already
  works, contrary to the first read. User ratified: new Next item, comprehensive scope (all 6
  tabs). Then designed the first slice (Analytics tab fix) in detail — no code written yet.
- **Files/commits:** `pm/ROADMAP.md` (new Next #1), `docs/dna-ui-self-explanatory.md` (new —
  audit + Analytics implementation design), `doc_1783585977440.md` / `doc_1783586926444.md`
  (session docs, local-only, not part of the change-set to commit).
- **PM impact:** `pm/ROADMAP.md` Next list updated (ratified); `pm/DECISIONS.md` entry added for
  the scope/priority call. `pm/STATE.md` untouched — nothing shipped yet.

## 2026-07-09 — Investigating lint auto-clear + LLM-based lints (in progress) `[wip]`
- **What:** Follow-up to the Analytics-lint-staleness explanation: user asked (1) whether a lint
  clears once its cause is fixed in prose/tree, (2) whether any lints are LLM/semantic (not just
  deterministic) — per memory, the "DNA verify layer" added cold-read/synopsis-read/craft_flag
  which sound semantic. Forked an agent to verify against `novelDna.ts` / `_shared/novel-dna.ts`;
  result not yet back. No code changes made. Also noted (not authored by this session) two
  pre-existing untracked scratch docs (`doc_1783581935000.md`, `doc_1783585977440.md`) from
  earlier unrelated PM/DNA-UI tasks — local-only by convention, not part of this change-set.
- **Files/commits:** none this turn; investigation only.
- **PM impact:** none yet — will follow up once the fork returns.

## 2026-07-09 — Explained Analytics-tab lint staleness (no code change) `[chore]`
- **What:** User asked how to know if the DNA tree's Analytics tab lints (dangling_ref,
  prose_echo, static_relationship, etc.) are up to date. Traced the pipeline: `dnaHealth(nodes)`
  runs uncached in the render body of `DnaTreePage.tsx`, over `nodes` kept live by a Supabase
  Realtime subscription — no edge fn, no LLM call, no DB round-trip at lint time, so the report
  can't go stale relative to the tree. Wrote up findings + architecture vocabulary for the user.
- **Files/commits:** no repo changes; wrote `doc_1783585656834.md` +
  `learning_1783585656834_analytics-lint-staleness.md` (both local-only, not committed).
- **PM impact:** none — investigation/explanation only, no ship/decision.

## 2026-07-09 — PM-system essay: two editorial passes (front-load, then sell-value + how-to) `[chore]`
- **What:** Refined `doc_1783581935000.md` (the "PM out of five markdown files" essay). Pass 1:
  inverted-pyramid opening (inventory + 3-of-4 receipt first). Pass 2: benefit-led second-person
  vignette opening, deleted the "honest gap list" meta-section, folded its fixes (HEAD-stamped
  sentinel, SessionStart injection, grep-never-load) into the how-to as current behavior; snippet
  re-verified against the real `pm-worklog.sh`.
- **Files/commits:** `doc_1783581935000.md` (uncommitted, untracked; user's essay draft).
- **PM impact:** none.

## 2026-07-09 — Builder loop iter 10: dedupe triplicated live-sync effect; scope closed `[chore]`
- **What:** Read the last unexplored corner, `features/dna/pages/` (`DnaTreePage.tsx` 839 lines,
  `DnaJsonPage.tsx`, `DnaMetersPage.tsx`, `DnaLedgerPage.tsx`, `DnaArchitecturePage.tsx` 750 lines).
  `DnaTreePage.tsx`'s per-key localStorage persistence pattern (rail/timeline/search/brief) repeats
  4-5 times but each has different semantics (bool/tri-state/array) on the single highest-traffic
  page in the product — judged not worth the risk for the gain, left alone. Found a real one: the
  exact same debounced Realtime `book_nodes` subscription (400ms debounce, identical cleanup) was
  hand-copied verbatim across THREE pages (`DnaTreePage`/`DnaMetersPage`/`DnaLedgerPage`, differing
  only by channel-name prefix). Extracted `useBookNodesLiveSync(bookId, prefix, setNodes)` —
  deliberately narrow (owns only the subscription, not each page's differing initial load) to limit
  blast radius on `DnaTreePage`. `DnaArchitecturePage.tsx` is a static hand-authored content page
  (no data fetching) — content-accuracy-vs-code is a different task, not touched.
  **This closes the loop's original scope** (`features/dna/` web + `supabase/functions/_shared`
  edge kernel) — every file has now been read at least once across 10 iterations.
- **Files/commits:** `useBookNodesLiveSync.ts` (new), `DnaTreePage.tsx`, `DnaMetersPage.tsx`,
  `DnaLedgerPage.tsx` — commit `916c913`. Verified: `tsc -p tsconfig.app.json` clean, vitest
  (930 tests) green.
- **PM impact:** none (housekeeping). Full loop recap owed to the user now that scope is closed.

## 2026-07-09 — Builder loop iter 9: rename DnaOverview's private TreeRow → ShapeRow `[chore]`
- **What:** Read `DnaOverview.tsx` (336 lines, the studio's dashboard), `DnaStageDiagram.tsx`
  (252 lines, `DnaFullDiagram` — the whole-tree pipeline visualization), and `AgentRail.tsx`'s
  display-only sub-components (`SessionHistory`/`StepBubble`/`ResolvedCard`/`ProposalCard`; its
  main 490-line `AgentRail()` function itself stayed off-limits per the standing live-agent-loop
  caution). Found one real thing: `DnaOverview.tsx` had a private, unexported `TreeRow` helper —
  a simple clickable shape-map row — with the exact same name as `components/tree/TreeRow.tsx`'s
  exported component (the full recursive tree renderer), two unrelated things sharing a name in
  the same feature folder. No functional collision (purely local, never imported) but genuinely
  confusing to grep. Renamed to `ShapeRow`. Considered but skipped a smaller duplication (the
  up/down/flat polarity color mapping repeated across `DnaStoryMap`/`DnaAnalysis`/
  `DnaStageDiagram`) — the "flat" fallback color differs per surface, so extracting it would need
  a parameter for marginal benefit; not worth the abstraction. Everything else in this pass was
  clean, consistent with iters 6-8's read of the current DNA/Studio layer.
- **Files/commits:** `DnaOverview.tsx` — commit `2df7c15`. Verified: `tsc -p tsconfig.app.json`
  clean, full vitest suite (930 tests) green.
- **PM impact:** none (housekeeping).

## 2026-07-09 — Builder loop iter 8: extract duplicated hollow-causal-link test `[chore]`
- **What:** Read the top-level `features/dna/components/` files not yet covered (`DnaStoryMap.tsx`,
  `DnaAnalysis.tsx`, sizes checked on the rest — `AgentRail.tsx` is 788 lines but is the single
  agent-thread surface with one big exported component + private sub-components below it, a normal
  shape, not touched given the standing caution on live-agent-loop code). Found a genuine small
  duplication: `DnaStoryMap`'s `BeatRow` and `DnaAnalysis`'s causality strip each hand-rolled the
  identical "hollow causal link" test (connector says `therefore`/`but` but the causality row
  doesn't back it up) — `DnaStoryMap`'s own comment even flagged it ("the same hollow-link test
  the analysis panel uses"), just never extracted. Pulled it into `isHollowCausalLink()` in
  `nodeDisplay.ts` (the tree's pure-display-derivations file, alongside `beatGlyph`/`proseRollup`).
- **Files/commits:** `nodeDisplay.ts`, `DnaStoryMap.tsx`, `DnaAnalysis.tsx` — commit `218add9`.
  Verified: `tsc -p tsconfig.app.json` clean, full vitest suite (930 tests) green.
- **PM impact:** none (housekeeping).

## 2026-07-09 — Builder loop iter 7: read dnaSchema.ts + useAutoAccept.ts (clean); STATE.md gap row `[chore]`
- **What:** Continued the loop after the diminishing-returns pause. Read `dnaSchema.ts` (the SSOT
  content schema — field specs, validation, sanitize, the prompt-guide artifact renderer) in full:
  well-designed, no dead code or duplication found. Read `useAutoAccept.ts` (the live agent-apply
  loop) in full: dense but deliberate — single-flight ref, exactly-once skip-set, abort deadlines —
  left untouched per the loop's own standing caution about live agent-loop correctness. Both
  confirm the current DNA/Studio layer (unlike the pre-pivot layers cleaned in iters 1-4) hasn't
  accumulated cruft yet. One real finding: STATE.md's "Onboarding & import/export" table never
  picked up the 45-legacy-book migration gap from iter 3 — DECISIONS.md had it, STATE.md's map
  didn't. Added a `gap` row.
- **Files/commits:** `pm/STATE.md` (new row) — uncommitted (pm/ docs, not code).
- **PM impact:** STATE.md now reflects the migration gap as ongoing product state, not just a
  historical decision.

## 2026-07-09 — Article on the PM system + shipped the 5 gaps its audit surfaced `[ship]`
- **What:** Wrote a publishable article (`doc_1783581935000.md`, local-only) describing this PM
  system end-to-end; the audit surfaced 6 gaps, and 5 were fixed this session (6th, multi-session
  races, consciously accepted — a concurrent builder loop was in fact active this session).
  Fixes: (1) **enforcement hole** — the Stop hook exited on a clean tree, so committed-but-
  uncatalogued work bypassed the nudge. Now the sentinel stores HEAD too (2-line, old ones
  auto-migrate) and the hook nudges on uncommitted changes OR commits-since-stamp that touched
  non-`pm/` files but never `pm/WORKLOG.md` (catalogue commits + pure `/pm` commits stay exempt →
  no false-nudge; verified across 7 scenarios). (2) **`pm/METRICS.md`** — new outcome ledger
  (read-through log + COGS table) so output-vs-outcome stops being memory-held. (3+4) new
  **SessionStart hook** (`pm-session-start.sh`) injects ROADMAP→Now every session + a >7-day
  staleness nudge toward `/pm review`. (5) WORKLOG rule relaxed to "grep, never load" (point
  lookups OK). README updated to document all of it.
- **Files/commits:** `.claude/hooks/pm-worklog.sh`, `.claude/hooks/pm-session-start.sh` (new),
  `.claude/settings.json`, `pm/METRICS.md` (new), `pm/README.md` — committed. `pm/WORKLOG.md`
  header edit + this entry left uncommitted (a parallel builder-loop owns this file). Article +
  `learning_*` local-only.
- **PM impact:** the PM system's own enforcement/read layer; no product-facing change. `docs/adr/`
  not warranted — the hook's header comments carry the "why."

## 2026-07-09 — Reader export now paginates by beat, not chapter `[ship]`
- **What:** `renderPages` (novelDna.ts) used to emit one concatenated TEXT page per chapter (all its scenes joined). Changed to emit one TEXT page per beat (scenes within a beat joined with a "***" scene-break marker); chapter SECTION (title) pages unchanged. Only the first beat-page in a chapter carries the chapter title heading. `reconcileDna` needed no change (nodeId is opaque to it). Triggered via the "read in reader →" button (StoryPane → renderAndRead → reconcileDna → /books/:slug).
- **Files/commits:** apps/web/src/features/dna/lib/novelDna.ts (renderPages), novelDnaRender.ts (comment), novelDna.test.ts (2 tests rewritten/added) — commit `244876b`.
- **PM impact:** `pm/STATE.md` "Structure-as-render" row note updated.

## 2026-07-09 — Builder loop iter 5: edge fns clean; added local deno-check tooling `[chore]`
- **What:** Shifted the loop to `supabase/functions/_shared` (the untouched half of its original
  scope). Reachability-swept `_shared/*.ts` against the 19 surviving edge fns — my first-pass grep
  (substring search for `_shared/x`) false-flagged `plan-provenance.ts`/`mandate-gate.ts`/
  `plan-gate.ts`/`words.ts` as orphaned; they're live via relative `./x.ts` imports the pattern
  missed. Verified by call-site (not just import-site): `mandate-gate.ts`/`plan-gate.ts` are
  actively called from `book-agent`'s prose-judging pipeline. No dead `_shared` code found.
  Then tried `deno check` per fn as the edge-side equivalent of `tsc --noEmit` — every fn calling
  `EdgeRuntime.waitUntil` (a Supabase-runtime-only global) false-positived as "Cannot find name
  EdgeRuntime." Added a type-only ambient shim (`_shared/deno-ambient.d.ts` — not imported by any
  function, so Supabase's per-function bundling never picks it up, zero deploy risk) that clears
  it. With the shim, all 19 edge fns check clean. Wrapped it in `scripts/check-edge-functions.sh`
  + a new `pnpm functions:check` — the first time edge fns have been typecheckable locally without
  a deploy.
- **Files/commits:** `supabase/functions/_shared/deno-ambient.d.ts` (new),
  `scripts/check-edge-functions.sh` (new), `package.json` (`functions:check` script) —
  commit `57bfceb`. Verified: `pnpm functions:check` green across all 19 fns.
- **PM impact:** none (dev tooling, no product-facing change).

## 2026-07-09 — Builder loop iter 4: sweep novelDna.ts's ~150 exports, remove dead setStatus `[chore]`
- **What:** Finished the export-usage sweep planned at the end of iter 3, this time on
  `novelDna.ts` (the core pure tree engine, ~150 exports). Cross-checked internal call count (does
  the file use its own export?) against external importers. Only `setStatus` had zero of both —
  a one-line pure helper (`lock`, defined right above it, is actively used; the two look like they
  were added as a pair but only one got wired up). Removed it. Everything else with a low external
  count turned out to be content-union member types (`SeedContent`, `CharacterContent`, etc.) used
  throughout the file's own logic even where nothing outside imports them — internal-only, not
  dead. Left those `export` keywords alone; stripping ~30 of them for no behavioral gain isn't
  worth the churn.
- **Files/commits:** `apps/web/src/features/dna/lib/novelDna.ts` — commit `c0f13e8`. Verified:
  `tsc -p tsconfig.app.json` clean, full vitest suite (929 tests) green.
- **PM impact:** none (housekeeping).

## 2026-07-09 — Builder loop iter 3: delete orphaned migrateBookToDna; 45 legacy books flagged `[decision]`
- **What:** Audited unused exports across `features/dna/lib/*.ts` (export-name usage-count sweep,
  not just whole-file reachability this time). Found `migrateBookToDna` — 0 callers, lost its
  trigger when the old DnaStudio "Migrate" button was deleted 2026-07-03. Unlike iter 1/2's finds,
  this was a live working capability, not code calling an already-dead edge fn, so stopped and
  asked before touching it. Queried the DB (read-only, `supabase db query --linked`): 45 books
  have real pages + foundations/spine but 0 `book_nodes` rows — this was their only migration
  path. Reported the count; user's explicit call was to delete anyway. Removed the async wrapper,
  kept the pure `buildDnaFromStack` (still used by `importEpub.ts` Layer A). DECISIONS entry
  records the tradeoff. No other flagged candidates this iteration (rest of the export sweep —
  `dnaProposals.ts`, `treeVersions.ts`, `dnaDecompose.ts`, `importEpub.ts`, `novelDnaRender.ts` —
  came back clean; `novelDna.ts`'s ~150 exports not yet swept, too large for one iteration).
- **Files/commits:** `apps/web/src/features/dna/lib/migrateToDna.ts` — commit `42ff2fa`.
  `pm/DECISIONS.md` entry added. Verified: `tsc -p tsconfig.app.json` clean, vitest (929) green.
- **PM impact:** DECISIONS entry added (the 45-book stranding is the consequential part).

## 2026-07-09 — Builder loop iter 2: delete lib/ladder.ts (orphaned resolution-ladder client) `[chore]`
- **What:** Reachability-swept `apps/web/src/lib/`, `hooks/`, `components/book/shared/`, and all
  of `features/dna/` for zero-importer files (same method as the edge-fn prune). Found
  `lib/ladder.ts`: `transforms.*` + `saveSpine`/`saveObjective`/`saveBeat`/`readNode`/`readProse`
  called edge fns already deleted 2026-07-09 (`objective-to-beat`, `beat-to-prose`, `prose-to-beat`,
  `revise-node`, `objective-options`), and had 0 call sites — the Resolution Map UI that used it
  (`NodeEditor`/`GraphActions`/`PageWorkshop`/`BookSpine`/`BookJourney`) was already deleted in the
  2026-06-30 DNA pivot; this client was the missed remainder. Deleted the file. Updated the stale
  `project_multiresolution_outline` memory (SUPERSEDED banner + MEMORY.md index line) to match —
  it still described the ladder as partially-shipped, live design. No other orphans found in this
  sweep (features/dna/ itself was already clean — the "one studio" consolidation had caught it).
- **Files/commits:** `apps/web/src/lib/ladder.ts` (deleted) — commit `5186c31`. Memory files
  updated (not part of the repo). Verified: `tsc -p tsconfig.app.json` clean, vitest (929) green.
- **PM impact:** none (housekeeping, continuation of the 2026-07-09 edge-fn prune).

## 2026-07-09 — Owner directive: monetize ASAP — GTM.md rewritten to committed plan v1 `[decision]`
- **What:** GTM.md promoted from thinking-surface to committed plan: a three-rung monetization
  ladder (R1 Pensive Pro subscription on the mature Writing pillar, R2 paid import wedge, R3
  metered generation — unchanged, still M1-gated). The old "no pricing before M2" gate now scopes
  to generation pricing only. ROADMAP Now intentionally busts WIP≤2 to add "Monetization rails v1
  (GTM R1)" alongside the live-build re-exercise; M4's description narrowed from "First paid
  surface" to "Paid generation."
- **Files/commits:** `pm/GTM.md` (rewritten), `pm/ROADMAP.md` (Now #2 added, M4 relabeled,
  parallel-revenue-milestones note), `pm/DECISIONS.md` (entry already present) — all uncommitted.
- **PM impact:** DECISIONS entry present. ROADMAP Now = 2 items (WIP≤2 deliberately overridden).

## 2026-07-09 — Builder loop iter 1: prune orphaned revision-chat client code `[chore]`
- **What:** First iteration of an open-ended "understand + consolidate the DNA surface" builder
  loop. Read `features/dna/FEATURE.md` fully; found it still listed `beats-agent`/`revise-node` as
  DNA-feature siblings after both were deleted in the 2026-07-09 edge-fn prune — fixed. Then
  finished that same prune's client-side half: `revisionChat.ts` (sendRevisionMessage/
  applyProposal/etc.) and `beatSheet.ts`'s reviseBeats/applyBeatPlan/LENSES only called the now-
  deleted `revise-chat`/`revise-beats`/`build-revision` edge fns, and traced back to zero live
  call sites (their one caller, `GenerateInChat` in `studioUi.tsx`, was itself unused — dead since
  `ReviseChat.tsx`, the listener side of its pub-sub bell, was deleted in the DNA pivot). Deleted
  `revisionChat.ts`; stripped `beatSheet.ts` to just the `RevisionPlan`/`PlanPage` types
  `outline.ts` still needs. Confirmed `scripts/eval-bridge.mjs` deliberately still mirrors the old
  pre-pivot edge fns per standing memory (do not sync) — left untouched.
- **Files/commits:** `apps/web/src/lib/revisionChat.ts` (deleted), `apps/web/src/lib/beatSheet.ts`,
  `apps/web/src/components/book/shared/studioUi.tsx`, `apps/web/src/features/dna/FEATURE.md` —
  commit `8d7d5ac`. Verified: `tsc -p tsconfig.app.json` clean, full vitest suite (929 tests) green.
- **PM impact:** none (housekeeping, continuation of an already-recorded chore).

## 2026-07-09 — Add stamp step to /pm (close hook-nudge gap) `[chore]`
- **What:** A `/pm` session catalogues via the curated files but didn't stamp the sentinel, so the
  Stop hook re-nudged on already-catalogued PM work. Added a "stamp before ending" standing rule to
  `.claude/commands/pm.md` mirroring `/wrap`'s step 3 — now both entry points acknowledge the
  change-set identically.
- **Files:** `.claude/commands/pm.md` (uncommitted).
- **PM impact:** none (tooling).

## 2026-07-09 — PM review: drift check + rank fight, live-build re-exercise promoted to Now `[decision]`
- **What:** Ran `/pm` (empty input → full three-hats pass). Drift check: found the prior
  session's edge-fn cleanup + pm doc edits had landed as commits already (builder hat clean, no
  action). PM hat: both Now slots were free while ROADMAP's own text buried the highest-leverage
  next step (re-exercising the §v1/§v4 agent-loop fixes on a live "build all") as a footnote
  under two adjacent-but-not-M1-blocking Next items (EPUB Layer B, REVALIDATE_SECRET). User
  ratified pulling it into Now. Owner hat: no new cost/GTM findings, REVALIDATE_SECRET's Next
  ranking confirmed against GTM.md's stated pre-M2 gap.
- **Files/commits:** `pm/ROADMAP.md` (Now section added, stale "both slots free" note fixed,
  Next renumbered under its own heading), `pm/DECISIONS.md` (rank-change entry) — uncommitted.
- **PM impact:** ROADMAP Now = live full-book build re-exercise. DECISIONS entry added.

## 2026-07-09 — Prune dead edge functions (post-DNA-pivot cleanup) `[chore]`
- **What:** Reachability audit of `supabase/functions/` (import-closure from live roots =
  client-invoked + watchdog-invoked fns). Deleted 22 orphaned function dirs + 20 unused
  `_shared` modules (43 files, ~7.4k lines). All orphaned by the DNA substrate pivot: whole-book
  build now runs through `dna-expand` (not `generate-book`), eval runs via the `/evaluate-book`
  command (not the edge fn), the revise-* cluster + Build Studio fns are unreached. Grouping into
  subfolders is impossible (Supabase deploys one fn per top-level dir) — deletion was the only
  real refactor. Survivors: 19 fn dirs, 18 `_shared` files.
- **Files:** `supabase/functions/{ai-run,beat-*,build-revision,evaluate-book,generate-book,
  generate-page,generate-scene-image,generate-character-portrait,mandate-gate,objective-*,
  prose-to-beat,revise-*,spine-to-objectives,send-to-kindle}/` + 20 `_shared/*.ts` deleted;
  `config.toml` (dropped generate-book/build-revision blocks); `FEATURE.md` (stale access.ts note
  fixed). Staged as `git rm`, not committed. Deleted stale memory `project_generate_book_chokepoint`.
- **PM impact:** none (housekeeping). Legacy watchdog SQL still names generate-book/build-revision
  — harmless (no starter ⇒ never fires); left for a future migration.

## 2026-07-09 — PM work-routing system: WORKLOG + /wrap + Stop hook `[decision]`
- **What:** Built the mechanism to route all work through the PM. New append-only firehose
  `pm/WORKLOG.md` (one entry per task, write-only — never loaded into context). New `/wrap`
  command as the end-of-task chokepoint: catalogue → promote ships/decisions to STATE/ROADMAP/
  DECISIONS → stamp. A Stop hook (`.claude/hooks/pm-worklog.sh`) enforces it — nudges once per
  dirty, uncatalogued change-set; idempotent via a gitignored fingerprint sentinel. Fixed a
  trailing-newline bug that made stamp/hook hashes never match.
- **Files/commits:** pm/WORKLOG.md, .claude/commands/wrap.md, .claude/hooks/pm-worklog.sh,
  .claude/settings.json (Stop hook), .claude/settings.local.json, .gitignore, pm/README.md
  (all uncommitted).
- **PM impact:** DECISIONS entry added (process/tooling change). No STATE product-board row —
  it's infra for how we work, not a product project.

## 2026-07-09 — Kindle settings: instruct user to whitelist hello@pensive.me `[ship]`
- **What:** Send-to-Kindle emails from hello@pensive.me were silently dropped by Amazon unless the
  user pre-approves the sender in their Personal Document Settings. Added an instructional card to
  the Kindle settings page (above the email/verification form) linking Amazon's Approved Personal
  Document E-mail List settings and telling the user to add hello@pensive.me.
- **Files/commits:** apps/web/src/pages/settings/KindleSettings.tsx — commit `2fc68e8` on branch
  `pm/work-routing`.
- **PM impact:** none — minor UX fix on an already-shipped feature, not tracked as its own
  STATE/ROADMAP row.
