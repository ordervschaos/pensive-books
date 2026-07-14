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
## 2026-07-14 — Traced + removed orphaned scene-image/portrait edge fns behind stray `google/gemini-3-pro-image-preview` OpenRouter calls `[chore]`
- **What:** User saw a Gemini-3-Pro *image* model ("nano-banana-pro") in OpenRouter logs for a feature we no longer have. Traced it: the old scene-image / character-portrait stack (deleted from the repo in `1643c3c` on 2026-07-09) was **still ACTIVE on Supabase** — `generate-scene-image` (v38) + `generate-character-portrait` (v26), last deployed 2026-07-08. `git rm` deletes source but does NOT undeploy; the public fn URLs stayed live and any hit fired a billed Gemini image call. The `gemini-3 → google/gemini-3-pro-image-preview` map lived in the deleted `_shared/image.ts`. **Fixed:** `supabase functions delete`'d both (verified gone from `functions list`); stripped the dead image-look block from `apps/web/src/lib/foundations.ts` (`art_direction`/`art_theme`/`image_model` fields + `ART_THEMES`/`ArtTheme` + `IMAGE_MODEL_OPTIONS`/`ImageModelOption`/`DEFAULT_IMAGE_MODEL` — no consumers outside the file; `tsc -p tsconfig.app.json` clean).
- **Files/commits:** `apps/web/src/lib/foundations.ts` (uncommitted). Two Supabase fns undeployed (no repo change — already deleted in git).
- **PM impact:** none (chore). Lesson worth carrying: repo-delete of an edge fn ≠ undeploy — audit `functions list` vs the repo periodically for orphans.
## 2026-07-14 — Route the whole high tier (not just agent) to claude-local in local dev; fix 3 stacked sketch/prose bugs `[wip]`
- **What:** Driving scene sketch+prose gen on book 1250 surfaced `Sketch generation returned unparsable JSON`. Root-caused to THREE stacked bugs and fixed each: (1) **routing** — `resolveRoleModels` only defaulted the *agent* role to `claude-local` when the shim is up; `structure`/`prose` still hit the admin provider (DeepSeek), which bills reasoning inside `max_tokens` at default-high effort → the 1200-tok sketch was 100% reasoning, empty output, unparsable. Now all three high roles default to `claude-local` under `localBridgeUp` (per-role overrides still win); tests updated (12/12 pass). (2) **shim** — `claude-local-shim.mjs` demanded a `{tool}/{text}` envelope, but no-tools calls (sketch/prose) return raw domain JSON/prose. Now passes non-tool completions through verbatim as a text block; `buildUserPrompt` no longer tells no-tool calls to "follow the JSON reply format". (3) **prose streaming** — `_proseProxy.ts` had no `claude-local` route (would misroute to Anthropic); added a non-streaming shim branch. But the shim blocks ~74s with zero bytes and the browser's `streamText` aborts at 45s idle → every prose render got DISCARDED by auto-accept. Added 20s heartbeats while the shim runs. **Verified on 1250:** scene 9 sketch (call 9889), scene 8 sketch (9893), scene 8 prose (9908, 74.7s, 11.2k chars) all on `claude-local`. **Remaining:** persist scene 8/9 prose through the agent with the heartbeat fix live (browser extension dropped when Vite restarted for the proxy change — needs reconnect to finish); prose nodes not yet re-saved.
- **Files/commits:** `supabase/functions/_shared/model-config.ts` (+ `.test.ts`), `scripts/claude-local-shim.mjs`, `apps/web/api/_proseProxy.ts` (all uncommitted). Local-only `doc_1783962985209.md` + `nohup.out` untouched; pre-existing `scripts/dna-analyze-1171.mjs` deletion carried over, not mine.
- **PM impact:** none yet (wip). Flagged for a follow-up ROADMAP line: the SAME DeepSeek reasoning-truncation breaks sketch generation **in production** (localBridgeUp false → structure role = deepseek-v4-pro, 1200 tok, no effort cap) — every prod sketch currently returns unparsable JSON. User explicitly deferred the prod fix this session (chose "not now"); the local-dev routing was the chosen fix.
## 2026-07-13 — Diagnosed post-fix dna-expand 502; traced to digest-fold wall-clock, not the auth fix `[wip]`
- **What:** After the auth fix landed, user retried the render flow and hit a 502 (not 401) plus a burst of `claude exited 1` errors in the shim log. Diagnosed both from `docker logs supabase_edge_runtime_pensive-books`: (1) the `claude exited 1` burst coincided with the user's `/login` ("Remote Control disconnected") disrupting the shim's spawned `claude -p` auth state — transient, self-recovered (shim succeeding again by end of log). (2) The 502 is `dna-expand`'s prepare-mode continuity-digest fold (`FOLD_BUDGET_MS = 100_000`, per-prior-page, via DIGEST_MODEL/qwen) exceeding the LOCAL Docker edge-runtime's wall-clock limit before it can hand off to the off-worker `/api/stream-prose` path — unrelated to today's auth/JSON fixes. Each fold is persisted immediately (`authoring.prose_digest`) so retries warm the cache incrementally (3/7 → 4/7 pages observed) — recommended the user retry a few more times to let book 1250's digest fully warm rather than treating it as a new bug. No code changed this turn; also cleaned up a stray `nohup.out` left from an earlier `nohup node scripts/claude-local-shim.mjs` invocation.
- **Files/commits:** none (investigation only).
- **PM impact:** none yet — if the wall-clock ceiling turns out to be a recurring local-dev blocker (not just cold-cache latency), it'd be a follow-up worth a ROADMAP line; flagging here for now, not promoting.

## 2026-07-13 — Restarted claude-local-shim.mjs `[chore]`
- **What:** Killed and relaunched the local shim process (nohup, backgrounded) after user request; no code changes.
- **Files/commits:** none (process-only). Pre-existing uncommitted diff (`pm/WORKLOG.md`, deleted `scripts/dna-analyze-1171.mjs`) carried over from before this session, untouched.
- **PM impact:** none.

## 2026-07-13 — Committed the claude-local + local-dev-auth fixes `[chore]`
- **What:** Landed the three preceding entries' work (claude-local shim JSON-extraction fix, config.toml verify_jwt gap, 10-function userClient fix) in one commit. Left out `scripts/dna-analyze-1171.mjs` (pre-existing unrelated deletion) and the local-only `doc_*.md` ritual file.
- **Files/commits:** `b303b27` — "Fix claude-local tool-call parsing and local-dev auth for 10 edge functions".
- **PM impact:** none.

## 2026-07-13 — Fix root cause of dna-expand 401: 10 functions hand-rolled the wrong Supabase project `[chore]`
- **What:** The earlier config.toml `verify_jwt=false` fix (previous entry) got the request PAST the local gateway, but the user retried and still hit 401 — a second, deeper bug. `dna-expand` (and 9 siblings: `dna-chat`, `evaluate-ai-call`, `read-confusion/facts/logline/meters/premise/shape/synopsis`) each hand-built their own user-scoped Supabase client from the raw `Deno.env.get("SUPABASE_URL"/"SUPABASE_ANON_KEY")` — the platform-reserved vars, which are always the LOCAL project when running under `supabase start`. So `auth.getUser()` tried to validate the browser's HOSTED-project session JWT against the LOCAL project's auth server — always fails. `book-agent` already had this right: it uses `_shared/task.ts`'s `userClient()` helper, which resolves through `hostedEnv()` (honoring `LOCAL_DEV_HOSTED_SUPABASE_*` in `supabase/functions/.env`) to the SAME hosted project that minted the token. Switched all 10 functions to that shared helper, removed the now-unused direct `createClient` imports, verified `deno check`/`deno lint` clean (only pre-existing unrelated `EdgeRuntime` ambient-type noise), restarted the local stack. Awaiting the user's live retry to confirm end-to-end.
- **Files/commits:** `supabase/functions/{dna-expand,dna-chat,evaluate-ai-call,read-confusion,read-facts,read-logline,read-meters,read-premise,read-shape,read-synopsis}/index.ts` (uncommitted).
- **PM impact:** none — local-dev-only correctness bug, no roadmap/state change.

## 2026-07-13 — Fix local-dev 401s on dna-expand + 9 sibling functions `[chore]`
- **What:** Live repro while testing the claude-local fix: applying a dna-expand proposal in the browser threw "Couldn't apply — dna-expand 401." Root cause: `apps/web/src/lib/localFn.ts` (the VITE_LOCAL_FUNCTIONS_URL dev bridge) sends the app's session token — signed by the HOSTED/production project, since `integrations/supabase/client.ts` always points there — to the LOCAL edge gateway. Local Kong's default `verify_jwt=true` validates against the LOCAL JWT secret, which never matches a production-signed token, so it 401s before the function runs. `book-agent`/`dna-decompose` already solved this (gateway verify_jwt=false + the function's own getUser() against the hosted project via `_shared/task.ts` hostedEnv); `dna-expand` and 9 other functions the local bridge also redirects (`dna-chat`, `evaluate-ai-call`, `read-confusion/facts/logline/meters/premise/shape/synopsis`) were missing that same config.toml entry — a wiring gap from whenever they joined the bridge list, not a regression from today's work. Added `verify_jwt = false` for all 10, restarted the local stack, and confirmed via response-shape diff (Kong's `{"msg":"Error: Missing authorization header"}` vs. the function's own `{"error":"Unauthorized"}`) that dna-expand now reaches its own auth check instead of being gated at the gateway.
- **Files/commits:** `supabase/config.toml` (uncommitted).
- **PM impact:** none — local-dev-only config gap, no roadmap/state change.

## 2026-07-13 — Fix claude-local shim: raw tool-call JSON leaking into AgentRail chat `[chore]`
- **What:** User reported `propose_prose_render` (and presumably other) tool calls occasionally rendering as a literal wall of JSON in the chat instead of a proposal card, only on the `claude-local` tier. Root cause: `claude-local-shim.mjs`'s `extractEnvelope` used `indexOf("{")`/`lastIndexOf("}")` to scrape the prompted JSON tool-call envelope out of `claude -p`'s raw stdout; any narration the model appended after the JSON with its own stray `}` made `lastIndexOf` grab the wrong brace, the slice failed to parse, and `book-agent/advance.ts`'s "any text block is genuine narration" assumption (safe for native tool-calling providers, not safe for this prompted-JSON path) surfaced the raw JSON as a chat note. Replaced the naive match with a balanced-brace scanner (`extractBalancedObject`) that tracks nesting depth and ignores braces inside JSON string literals; verified against the failing case plus fenced/nested-brace cases with a standalone repro script.
- **Files/commits:** `scripts/claude-local-shim.mjs` (uncommitted); `doc_1783962985209.md` + `learning_1783962985209_claude-local-json-leak.md` (local-only, gitignored).
- **PM impact:** none — dev-tooling bugfix, no roadmap/state change.

## 2026-07-13 — Shipped Vision→Structure (all phases of docs/vision-to-structure.md) `[ship]`
- **What:** The vision now grounds the derivation engine and gets audited back. P1: `MeterKind` + `mystery`/`violence`/`levity` in both novelDna twins, dnaSchema select, `METER_KINDS` whitelist, dna-schema.json regenerated via its artifact lock. P2: all 4 `briefContext` calls in dna-expand gain `vision:true`; contract v2 prompt derives from BRIEF+MANDATE+VISION (vision outranks genre), two-source tentpoles with `source:"genre"|"vision"` provenance (post-parse default "genre"), 2–5 meters with vision-shaped target curves; client `contractDelta`/`persistContract`/ops-exit now carry full tentpole content objects (name+source — previously even `name` was dropped, only summary persisted); `source` registered in dnaSchema (genOnly select) so get_schema documents it and the tree editor renders it. P3: pillar/contract/cast/beats recipes appended with vision guidance (verbatim in both dna-journey twins); SYSTEM_THREAD's vision item now also teaches the living-document rule + audit_vision checkpoints. P4: new `_shared/vision-craft.ts` exporting `VISION_RUBRIC` (structural-carrier sufficiency test); `vision-fulfillment` skill embeds it; `audit_vision` non-terminal LLM-judge tool (tools.ts schema + exec-tools handler: vision sections vs a compact foundations/structure digest incl. per-tentpole PLACED/UNPLACED, meters' target-set flags; 120s signal, effort medium). P5: contract STEP_TEACH copy mentions the vision; meters page verified kind-agnostic. Gates: web tsc clean, full vitest 1227 passed/0 failed, parity+journey tests green, deno check clean (pre-existing EdgeRuntime noise only); `dna-expand` + `book-agent` deployed. Honest scope note: dna-expand's shared ctx also feeds its prose/sketch prepare path, so streamed prose prompts now carry the vision (within D1's ratified wording, flagged in the plan doc). NOT done: the live e2e exercise on a real book (interview → contract → audit) — flagged in the plan header.
- **Files/commits:** `supabase/functions/_shared/{novel-dna,agent-skills,vision-craft,dna-schema.json,dna-journey}.ts|.json`, `supabase/functions/dna-expand/index.ts`, `supabase/functions/book-agent/{tools,exec-tools,prompts}.ts`, `apps/web/src/features/dna/lib/{novelDna,dnaSchema,dnaExpand,dnaJourney}.ts`, `apps/web/src/features/dna/components/agentRail/journeyContent.ts`; uncommitted.
- **PM impact:** decision already in DECISIONS.md (prior entries); plan doc header flipped to IMPLEMENTED with the live-e2e gap named. STATE: rides the guidance-system line.

## 2026-07-13 — Shipped D9: state-injected vision-interview skill (fixes the mid-interview craft hole) `[ship]`
- **What:** Implemented + deployed Phase 3b of `docs/vision-to-structure.md` ahead of the rest of that plan because the hole was live: the shipped three-state injection omits the objective (and `STEP_RECIPE.interview` with it) on concrete messages — and an interview ANSWER is a concrete message — while its story nouns ("protagonist") tripped character-craft's node-editing playbook mid-interview. Added the `vision-interview` skill (elicitation funnel, capture-as-you-go, author's-words-first) to `agent-skills.ts`; in `threadSystem`, a `discovering` predicate (vision neither compiled nor skipped + building not started — mirrors the journey twins' interview gate incl. the widened grandfather) pins that skill every turn and suppresses ask-triggered skills. First STATE-injected skill — establishes the fourth skill channel (index · ask-triggered · objective-fallback · state-pinned). Verified via a mocked-threadSystem harness (4 cases: discovery injects interview + suppresses character-craft; compiled/skipped/grandfathered all restore ask-triggered skills — ALL PASS); `deno check` clean (pre-existing EdgeRuntime noise only); `book-agent` deployed.
- **Files/commits:** `supabase/functions/_shared/agent-skills.ts`, `supabase/functions/book-agent/context.ts`, `docs/vision-to-structure.md` (Phase 3b marked shipped); uncommitted.
- **PM impact:** none new — D9 was already promoted to DECISIONS in the prior entry; STATE unchanged (rides the guidance-system row).

## 2026-07-13 — Shipped the guidance system: interview-first discovery + three-state objective `[ship]`
- **What:** Implemented `docs/agent-guidance-system.md` end to end. The journey's premise stage now opens
  with an **Interview** rung (Interview → Seed → Premise) whose artifact is `books.brief.vision` (a jsonb
  section, no migration), written by a new **non-terminal, direct-write `update_vision` tool** — the first
  deliberate break from proposals-only, because it records the author's own words. `<current_objective>` is
  now injected in **three states**: omitted on a concrete typed ask (the intent-pollution fix), injected on
  the Next-nudge / an empty ask, and ALWAYS injected in auto mode (it's auto's work queue). The vision
  renders into the agent's `<brief>` only behind a new `briefContext` opt (`vision:true`), so every other
  prompt in the codebase stays byte-identical. Live-verified on a scratch book: interview asked, captured 5
  sections, compiled, journey advanced to Seed on its own, and the logline it then proposed carried the
  vision. Verified in `ai_calls` that all three injection states behave.
- **Scope change en route:** the plan's grandfather clause (`seedDone` ⇒ interview moot) was too narrow —
  a live drafted book (1235, 141 scenes) whose seed was never *accepted* regressed into an interview.
  Grandfather now keys on "any non-seed node exists" (a fresh book is minted with the seed alone).
- **Files:** `_shared/brief.ts` (+`BriefVision`/`VISION_SECTIONS`/`vision` opt), both dna-journey twins
  (+interview substep, `STEP_RECIPE.interview`, `brief` param), `book-agent/{context,tools,exec-tools,
  prompts}.ts`, `apps/web/src/lib/brief.ts`, `AgentRail.tsx`/`DnaOverview.tsx` (+skip affordance)/
  `TreeOverviewTab.tsx`/`DnaTreePage.tsx`/`journeyContent.ts`; parity + journey tests extended (751 green).
  `book-agent` deployed. Committed `f66c831` (bundled the concurrent D9 vision-interview follow-on,
  which had layered onto the same `context.ts`/`agent-skills.ts` and was inseparable; combined tree
  typechecks + journey/parity green before commit).
- **PM impact:** new STATE row (Agent section); DECISIONS amended with the grandfather widening.
## 2026-07-13 — Ratified + spec'd Vision→Structure (executable plan) `[decision]`
- **What:** Second guidance-system rung, decision-maker session (owner delegated choices). The vision now grounds the derivation ENGINE, not just the agent chat: every `briefContext` call in dna-expand gets `vision:true`; contract v2 compiles vision plot points into `source:"vision"` tentpoles (enforced free by the existing `tentpole_unplaced` lint) and derives 2–5 meters (palette + `mystery`/`violence`/`levity`; heat = sexual content with `content_type` as ceiling) with vision-shaped target curves; a new non-terminal `audit_vision` LLM-judge tool closes the loop at recipe checkpoints. No journey changes; recipes carry the nudging. Key planning discovery: the meter cascade (`target_drift`/`read_gap`/`targetGap`) already exists — the plan feeds it, doesn't rebuild it. 6 phases with gates, written for a smaller-model implementer.
- **Files/commits:** `docs/vision-to-structure.md` (new, uncommitted); promoted to `pm/DECISIONS.md`.
- **PM impact:** DECISIONS.md entry added. Implementation queued behind the guidance-system implementation; not slotted into Now (Now ≤ 2 holds).

## 2026-07-13 — Merged feat/ai-provider-switch to main; fixed the prod build break it exposed `[ship]`
- **What:** Executed the merge decided in the prior entry (one deployed SSOT instead of two divergent branches). Committed the incident-response fix (dna-chat restore + dna_chats migration), then pushed straight to `main` — the pre-push hook (typecheck+tests) caught 2 failures, traced to a concurrent session's uncommitted WIP polluting the shared working tree (not anything in the 73 commits being merged); verified clean via an isolated `git worktree` checkout of just the target commit. That surfaced one real pre-existing failure: `bookAgentDigestFields.test.ts` had a hardcoded path to `book-agent/index.ts`, broken since an earlier refactor moved `DIGEST_FIELDS` to `context.ts` — fixed the path rather than bypass the hook. Pushed clean (fast-forward, `main` now at the same commit as this branch). Immediately after, the user reported the actual production build error the stale `main` had been hiding: `api/stream-prose.ts` failing `TS2835` (relative import needs an explicit extension) — `apps/web`'s `"type": "module"` makes Vercel compile `api/*.ts` as native Node ESM (node16/nodenext resolution), which requires `.js` on relative specifiers even for `.ts` sources. This is very likely why production deploys had been erroring for 5+ days (unrelated to any of today's work — pre-existing on `main`, just never fixed since main wasn't being pushed to). One-line fix (`"./_proseProxy"` → `"./_proseProxy.js"`), verified clean typecheck, pushed the same isolated-worktree way.
- **Files/commits:** `1185604` (test path fix), `fdbede1` (stream-prose.ts fix) on `main` (= `feat/ai-provider-switch`). Also lands `99578e6` (dna-chat restore, already logged in the prior entry) since it rode the same push.
- **PM impact:** `main` and this branch are now identical — the branch-divergence root cause from the near-miss entry above is resolved. Open: confirm the next Vercel prod deploy actually goes green (not verified in-session — Vercel builds asynchronously); `dna_chats` recovery from backup still open.

## 2026-07-13 — Fixed: DNA→pages chaptering was per-beat, not per-act `[ship]`
- **What:** `renderPages` (novelDna.ts) was already correctly designed as section-per-chapter + one text page per beat + "***" scene breaks — but `realizeScenesFromBeat` (dnaExpand.ts) stamped `chapter_start` on EVERY beat's first scene (its `startPosition === 0` guard was dead: every caller always passed literal `0`), so every beat rendered as its own chapter instead of one section per act. Fixed by keying off `beatNode.position` (0-indexed per act already, via `persistBeatSheet`) instead of the unused `startPosition` param, and by sourcing the chapter title from the ACT's own `title` field (new `chapterTitleFromAct`) rather than the first beat's summary, since the chapter now represents an act. Verified: `tsc -p tsconfig.app.json --noEmit` clean; `vitest run dnaExpand.test.ts novelDna.parity.test.ts novelDna.test.ts` — 858/858 pass (3 new tests added covering act-boundary + no-op-for-non-first-beat + act-title-wins).
- **Files/commits:** `apps/web/src/features/dna/lib/dnaExpand.ts`, `apps/web/src/features/dna/lib/dnaExpand.test.ts` — uncommitted, not yet committed (user hasn't asked to commit).
- **PM impact:** STATE.md "Structure-as-render" row corrected (its "paginates by beat, not chapter" note described the bug, not the intent).

## 2026-07-13 — Near-miss: "zero callers" audit trusted the wrong branch; dna_chats data lost `[decision]`
- **What:** Continuing the eval-bridge dead-fn audit, discovered the real methodology gap: `main` (43 commits behind this branch) is what Vercel `pensive` actually deploys to production (confirmed via the `pensive-git-main-...` alias on the last successful prod deploy, 16 days old; several more recent prod deploy attempts have been erroring). My "zero live callers" check only grepped THIS branch's client code — but this branch has already deleted UI (`ladder.ts`, `revisionChat.ts`, `beatSheet.ts`) that unmerged `main` still ships. Checked actual `ai_calls` invocation timestamps (the real evidence, not static analysis) and found `dna-chat` was called 2026-07-10 and `revise-chat` as recently as 2026-07-11 22:08 — both real, multi-book traffic. Impact: `dna-chat` had already been deleted + undeployed in an earlier session-turn — **restored** (`git show` the last committed version, redeployed, confirmed ACTIVE again, version reset to 1). `revise-chat` was on the candidate list but not yet executed — caught in time, untouched. The `dna_chats` **table drop from the prior turn is NOT recoverable in place** — checked non-empty (15 rows) before dropping but never checked recency; given the 07-10 dna-chat calls, some rows were likely days old, not historical junk. PITR is disabled on this project (confirmed via `supabase backups list`); only daily logical backups exist, latest 2026-07-13 08:30 (this morning, likely pre-drop). Recovery requires the Supabase Dashboard's backup-restore flow to a NEW project (to avoid clobbering current data) — not attempted, handed to the author. Halted the remaining ~21-function audit entirely pending a corrected methodology (check `ai_calls` recency per candidate, not just branch-local grep). Root cause is being addressed separately: merging this branch to `main` so there's one deployed SSOT instead of two divergent realities.
- **Files/commits:** `supabase/functions/dna-chat/index.ts` restored + redeployed (uncommitted, version 1); `supabase/migrations/20260713180000_drop_dead_dna_chats.sql` (already applied, table gone — data loss risk, not reverted).
- **PM impact:** promoted to `pm/DECISIONS.md` (methodology lesson: verify against real invocation logs + the actually-deployed branch, not static grep on the branch in front of you). Open item for the author: recover `dna_chats` from the 07-13 08:30 backup or accept the loss.

## 2026-07-13 — Ratified + spec'd the guidance-system redesign (executable plan) `[decision]`
- **What:** Owner delegated the four open design decisions ("you are the decision maker"); all ratified with leans (vision at `books.brief.vision`, direct-write `update_vision` tool, visible+skippable Interview substep with grandfather clause, full objective omission on concrete asks — with an AUTO-mode exception added: auto always injects, the objective is its work queue). Wrote the executable plan for a smaller-model implementer: 6 phases with per-phase verification gates, verbatim `STEP_RECIPE.interview` + tool schema drafts, exact file paths, and a gotchas fence (twin parity, prompt byte-stability, non-terminal tool semantics, StepBubble rendering).
- **Files/commits:** `docs/agent-guidance-system.md` (new, uncommitted); promoted to `pm/DECISIONS.md`.
- **PM impact:** DECISIONS.md entry added. Implementation is a new work item — candidate for a Now slot after the live full-book build re-exercise; not slotted yet (Now ≤ 2 holds).

## 2026-07-13 — Guidance-system design session (interview-first agent rail) `[wip]`
- **What:** Design-only session, no code. Proposed the agent-rail guidance redesign: two axes (book REGIME: discovery vs build; turn INITIATIVE: author-led vs agent-led), an interview-first discovery phase capturing a structured vision doc at `books.brief.vision`, interview as a new premise-stage substep (Interview → Seed → Premise) with its own STEP_RECIPE + skill brief, three-state `<current_objective>` injection (omit on concrete ask · directive on Next-nudge/`context_follow_objective` · proactive interview opener on fresh discovery threads), and a direct-write `update_vision` tool. Four decisions pending author ratification (vision location, direct-write vs proposal, JourneyStrip visibility, full omission vs status line). Design doc in session scratchpad only (`doc_1783943126220.md`) until ratified.
- **Files/commits:** none (also in tree: `docs_12.txt` conversation export, untracked; `scripts/dna-analyze-1171.mjs` deletion from another session).
- **PM impact:** none yet — promote to `decision` + `docs/` spec once the author ratifies.

## 2026-07-13 — Deleted the dead dna-chat edge function (code + deploy) `[chore]`
- **What:** Follow-up to the eval-bridge cleanup: with `sendDnaMessage` and its `dna_chats` session wrapper already deleted client-side (zero callers), the `dna-chat` edge function itself was confirmed to have zero live callers anywhere too. Deleted `supabase/functions/dna-chat/index.ts` and ran `supabase functions delete dna-chat` — confirmed removed from the deployed project. Deliberately did NOT drop the `dna_chats` Postgres table: it holds 15 real rows (actual historical per-stage-chat conversations pre-dating the AgentRail pivot), checked via a direct REST count before touching anything. A table drop destroys data irreversibly where a code/deploy deletion is git-reversible, so that's parked pending the author's call (keep as inert dead weight, export-then-drop, or drop). Also surfaced, not investigated: ~20 other deployed edge fns (`beats-agent`, `revise-chat`, `revise-scaffold`, `objective-options`, `ai-run`, `spine-options`, `beat-to-objective`, `objectives-to-spine`, `revise-node`, `generate-voice`, `auto-revise`, `spine-to-objectives`, `beat-to-prose`, `revise-prose`, `revise-outline`, `objective-to-beat`, `prose-to-beat`, `brief-to-spine`, `revise-beats`, `generate-book`, `generate-page`, `build-revision`, `flesh-out-book`) look like the same class of Build-Studio-pivot leftover as dna-chat, from eyeballing `supabase functions list` — none individually verified for zero-callers yet; that's a real audit, not a hunch-based deletion.
- **Files/commits:** `supabase/functions/dna-chat/index.ts` deleted (uncommitted); Supabase deploy: `dna-chat` function deleted (live, not git-tracked). No DB migration.
- **PM impact:** none yet. Two open decisions for the author: (1) drop `dna_chats` table or leave it, (2) greenlight a full zero-caller audit across the ~20 other candidate fns.

## 2026-07-13 — Committed the objective-driven skill fallback fix `[chore]`
- **What:** Committed the change described in the entry immediately below (already deployed prior to this commit).
- **Files/commits:** `b365ac7` on `feat/ai-provider-switch` — same 9 files as the entry below. (`docs_12.txt`, an unrelated leftover terminal-transcript dump in the working tree, left untracked/uncommitted.)
- **PM impact:** none beyond what's already promoted to `pm/STATE.md`.

## 2026-07-13 — Gated objective-driven skill fallback behind the explicit "Next" click `[ship]`
- **What:** Shipped (supersedes the "in-progress"/wip entry immediately below, which undersold it as read-only — this session wrote and deployed the change). Root cause: server-side, `liveObjective` is recomputed fresh from the tree on EVERY turn regardless of what the client sends (by design, for auto-mode resume fidelity) — so `matchSkills`'s fallback (`askSkills.length ? askSkills : matchSkills(liveObjective)`) was injecting a playbook on essentially every turn where the ask's own text missed the trigger regexes, including free-typed messages unrelated to the guided flow. Fixed by threading an explicit signal end-to-end: the client's "Next" nudge click now passes `isNextStep: true` (`AgentRail.tsx` `send()`/`sendAgentMessage()`); the server persists it as `book_agent_runs.context_follow_objective` (new column, same per-turn-persisted pattern as `context_objective`/`context_auto` so it survives auto-mode's chain links); `context.ts`'s skill-match fallback now only fires when `followObjective` is true. A free-typed composer message that misses every trigger now gets NO skill brief (the agent can still self-serve via `read_skill`) instead of silently inheriting whatever the current guided-flow rung matches. Scope, per the author's explicit calls: auto-mode chain links are NOT exempted (they inherit whatever flag started that arc, same as manual mode); the `<current_objective>` prompt block itself stays unconditional — only the skill-brief fallback is gated. Migration applied (`supabase db push`) + `book-agent` redeployed (`supabase functions deploy`); not yet committed to git.
- **Files/commits:** uncommitted — `supabase/migrations/20260713165731_agent_runs_follow_objective.sql` (new), `supabase/functions/book-agent/{index,advance,context,shared}.ts`, `apps/web/src/features/dna/lib/agentThread.ts`, `apps/web/src/features/dna/components/AgentRail.tsx`.
- **PM impact:** promoted to `pm/STATE.md` under "Agent instruction-following (task anchor + intent hydration)".

## 2026-07-13 — In-progress: `context_follow_objective` threading (agent_runs_follow_objective) `[wip]`
- **What:** Uncommitted, in-progress feature: thread a new `book_agent_runs.context_follow_objective` column end-to-end so the client can signal "this turn was explicitly started by the Next-objective nudge" vs a free-typed ask. In `context.ts`'s `threadSystem`, this gates whether skill-brief matching falls back to the live objective's text when the author's ask itself doesn't hit a skill trigger — narrower than "does the agent follow the objective," it's specifically about which skill playbook gets pre-injected. This session did no code changes — only read/explained the existing diff (advance.ts/context.ts dispatch + prompt-assembly logic) in answer to a question; wrote local, gitignored `learning_*`/scratchpad docs only.
- **Files/commits:** uncommitted — `supabase/functions/book-agent/{advance,context,index,shared}.ts`, `apps/web/src/features/dna/{components/AgentRail.tsx,lib/agentThread.ts}`, new migration `supabase/migrations/20260713165731_agent_runs_follow_objective.sql`.
- **PM impact:** none yet — flagging so this in-progress diff doesn't sit uncatalogued; promote on commit/ship.

## 2026-07-13 — Reverted the NodeGroup shaded-band tweak `[chore]`
- **What:** User asked to revert the prior "shaded band + top rule" styling on the DNA tree's `NodeGroup` header (bb44a4a). Reverted via `git revert`.
- **Files/commits:** `apps/web/src/features/dna/components/tree/Subtree.tsx`.
- **PM impact:** none — visual polish only, now undone.

## 2026-07-13 — Made eval-bridge redundant for the web app; killed the dead dna-chat client `[chore]`
- **What:** Investigated whether `scripts/eval-bridge.mjs` (the browser's dev-only Claude-Code-as-backend bypass) could be retired in favor of the claude-local shim, since the shim rides the REAL edge functions instead of a hand-maintained reimplementation. Built it: `apps/web/src/lib/localFn.ts` (`invokeFn`, new) is a drop-in for `supabase.functions.invoke` that redirects to a locally-served fn (`VITE_LOCAL_FUNCTIONS_URL`) when set, mirroring book-agent's existing `VITE_LOCAL_BOOK_AGENT_URL` escape hatch. Paired with local-only `claude-local` defaults added to `getActiveModels()` (model-config.ts) and a new `getJudgeModel()` (judge.ts) — both gated on `CLAUDE_LOCAL_URL` being present in the worker's OWN env (never true when deployed), so prod's shared `admin_settings.ai_model_tier` is never touched. Migrated 9 call sites off the `if (BRIDGE)` branch onto `invokeFn`: `loglineRead`, `confusionRead`, `shapeRead`, `meterRead`, `premiseRead`, `synopsisRead`, `factLedger`, `dnaExpand`, `AiCalls.tsx`'s judge button. Deleted `apps/web/src/lib/bridge.ts` (zero remaining importers). Found genuine dead code along the way: `dnaChat.ts`'s `sendDnaMessage` + the whole `dna_chats` session wrapper (`applyDnaProposal`/`clearDnaProposal`/`startNewDnaSession`/`resumeDnaSession`) had zero callers — the per-stage reviser was superseded by AgentRail; deleted, keeping the file's still-live `applyNodeOps`/`validateOps`/`describeOps` machinery. `scripts/eval-bridge.mjs` itself was NOT deleted — it's still a load-bearing utility module for 6 standalone analysis scripts (dna-causality-probe.mjs etc.) and prose-context-experiment.mjs's HTTP harness; only its header + FEATURE.md/DnaArchitecturePage.tsx docs were updated to stop claiming it's the web app's route.
- **Files/commits:** `apps/web/src/lib/localFn.ts` (new), `apps/web/src/lib/bridge.ts` (deleted), `apps/web/src/features/dna/lib/{loglineRead,confusionRead,shapeRead,meterRead,premiseRead,synopsisRead,factLedger,dnaExpand,dnaChat}.ts`, `apps/web/src/pages/admin/AiCalls.tsx`, `apps/web/.env.local`, `supabase/functions/_shared/{model-config,judge}.ts`, `supabase/functions/evaluate-ai-call/index.ts`, `supabase/functions/dna-expand/index.ts` (comment), `apps/web/src/features/dna/FEATURE.md`, `apps/web/src/features/dna/pages/DnaArchitecturePage.tsx`, `scripts/eval-bridge.mjs` (header only). Verified: web typecheck clean, edge `deno check` clean (pre-existing EdgeRuntime noise only), 1158/1160 web tests pass (1 pre-existing unrelated failure — `bookAgentDigestFields.test.ts` expects `DIGEST_FIELDS` in `book-agent/index.ts`, moved to `context.ts` by an earlier, separately-committed refactor).
- **PM impact:** none directly, but flagged one real finding for the author to decide: the `dna-chat` edge function + `dna_chats` table now have **zero live callers** anywhere (confirmed via grep) — candidate for deletion, deliberately left alone since undeploying a function is a bigger, less-reversible step than a client cleanup. Noted in FEATURE.md.

## 2026-07-13 — Root-caused the skill-loading false positives to a stringly-typed round-trip `[wip]`
- **What:** Continuation of the earlier same-day skill-loading investigation. User supplied a concrete repro: a fresh chat, one "next" click, and the same 3 playbooks loaded. Traced the actual message sent: `AgentRail.tsx`'s `nextStepMessage` (line ~301-305) stringifies the guided-flow decision into prose — `Write "${nodeLabel(draftTarget.scene)}".` — where `nodeLabel()` (`dnaChat.ts:34`) pulls the scene's plan `goal`/`summary` text (arbitrary story content). That prose is sent as the literal chat message, and `matchSkills` regex-triggers against it server-side. Root cause: the client already knows the action type (the ternary that built the string IS the classification) but discards that typed fact, round-trips it through free text, and the server re-derives it via regex — which then also picks up coincidental verb collisions from ordinary narrative prose ("calls," "checks," "reviews" as plot content, not editorial intent). Proposed fix: thread the client's already-known action/skill hint alongside the message so `matchSkills` prefers it over regex-sniffing the label text; regex stays only as the fallback for genuine free-typed asks. Not implemented — awaiting go-ahead.
- **Files/commits:** no diff from this session — read-only trace of `apps/web/src/features/dna/components/AgentRail.tsx`, `apps/web/src/features/dna/lib/dnaChat.ts`, plus the earlier session's `agent-skills.ts`/`context.ts`/`transcript.ts` read.
- **PM impact:** none yet. Supersedes/refines the earlier same-day "stale-ask" wip entry below — the manual-mode repro shows the more precise root cause; the auto-mode staleness finding still stands as a second, related bug.

## 2026-07-13 — localFn dev-bridge replacement (uncommitted, in progress) `[wip]`
- **What:** Not this session's work (this session was a read-only UX Q&A on the DNA tree's PILLAR-field-vs-child-group display, no files touched) — cataloguing pre-existing uncommitted changes so they don't go un-logged. New `apps/web/src/lib/localFn.ts` adds `invokeFn()`, a drop-in for `supabase.functions.invoke` that redirects to a locally-served edge fn (`VITE_LOCAL_FUNCTIONS_URL`) when set, superseding the old `BRIDGE`/`bridgeFetch` pattern ([[project_dev_bridge_mirror]]). 7 DNA read callers (confusionRead/dnaExpand/factLedger/loglineRead/meterRead/premiseRead/shapeRead/synopsisRead) switched from `bridgeFetch` to `invokeFn`. On the edge side, `judge.ts`/`model-config.ts` add a `CLAUDE_LOCAL_URL`-gated default so local dev rides the `claude-local` shim (subscription-billed) instead of a metered API; `evaluate-ai-call/index.ts` updated to call `getJudgeModel()` instead of the fixed `JUDGE_MODEL` const. Prod path unaffected (env var only ever set in a gitignored local `.env`).
- **Files/commits:** uncommitted — `apps/web/src/lib/localFn.ts` (new), `apps/web/src/features/dna/lib/{confusionRead,dnaExpand,factLedger,loglineRead,meterRead,premiseRead,shapeRead,synopsisRead}.ts`, `supabase/functions/_shared/{judge,model-config}.ts`, `supabase/functions/evaluate-ai-call/index.ts`.
- **PM impact:** none yet — not committed, not verified this session. Flagging so it isn't lost; next session should confirm it works end-to-end (or commit) before it goes stale.

## 2026-07-13 — Diagnosed stale-ask skill loading in auto-mode AgentRail `[wip]`
- **What:** User asked why the same 3 playbooks (prose-patch/render-brief/editorial-read) load every AgentRail turn regardless of what the turn is doing. Traced it: `matchSkills` runs against `authorAsk`, which `latestAuthorAsk()` freezes to the human's original kickoff message for the whole auto run (it skips auto-continue sentinels, so no later text ever replaces it). The turn-accurate signal, `liveObjective` (re-derived every chain link), is only consulted as a fallback when `askSkills` is empty — which in auto mode it never is. No code changed yet; proposed fix is to prefer `liveObjective` for skill matching in auto mode. Awaiting go-ahead to implement.
- **Files/commits:** no diff from this session — read-only investigation of `supabase/functions/_shared/agent-skills.ts`, `book-agent/context.ts`, `book-agent/transcript.ts`. (Unrelated pre-existing uncommitted changes in the tree — `confusionRead.ts`, `loglineRead.ts`, `judge.ts`, `model-config.ts`, `evaluate-ai-call/index.ts`, new `localFn.ts` — are from other work, not this session.)
- **PM impact:** none yet — no fix landed. Revisit once the auto-mode skill-matching fix ships.

## 2026-07-13 — claude-local shim: stop leaking narration as chat text `[chore]`
- **What:** User showed a screenshot of AgentRail displaying raw agent narration ("Assistant: I'll set up scene 8's render... search_nodes({...})") as if it were a real reply. Root cause: `claude -p` (the claude-local dev bridge) mimics the flattened "Assistant: ..."/"User: ..." transcript lines it's shown as history instead of emitting the required `{tool}`/`{text}` JSON envelope, and the shim's fallback silently returned the whole raw narration as a legitimate text reply. Fixed `scripts/claude-local-shim.mjs`: `toolEnvelopeBlock` now tells the model that format is a log, not a template (with a wrong/right example); `toAnthropicResponse` now throws on a malformed envelope instead of dumping raw text, routing through the same error path any other provider failure takes.
- **Files/commits:** `scripts/claude-local-shim.mjs` — commit `a3b2afd`.
- **PM impact:** none — dev-only bridge bugfix, no roadmap item.

## 2026-07-13 — book-agent: finish removing the aspect-scope fence `[chore]`
- **What:** User noticed `body.scope` in `book-agent/index.ts` was dead (client never sends it since the DNA context-model pivot — [[project_agent_context_model]]) and asked to remove all dead code. Traced the full thread and deleted it end-to-end: `shared.ts` (`Aspect`/`ASPECTS`/`ASPECT_KINDS`/`scopedKinds`, `context_scope` off `RunRow`/`ROW_COLS`), `context.ts` (`threadSystem`'s `scope` param, the `<hidden>`/`scope_note` branches, always-true `inScope`), `proposals.ts` (`scope` param + `allowed()` off `proposeNodeOps`/`proposeOptions`), `tools.ts` (`threadToolsFor`'s unused `_scope` param), `advance.ts` + `index.ts` + `ack.ts` (every call site + the `body.scope` request parsing). `ALL_NODE_KINDS` kept (still does real kind validation). Left the `book_agent_runs.context_scope` DB column alone — dropping it is a migration decision, not code cleanup. Verified with `deno check` (clean but for pre-existing unrelated `EdgeRuntime` global-typing noise).
- **Files/commits:** `supabase/functions/book-agent/{index,advance,context,proposals,shared,tools,ack}.ts`. Uncommitted.
- **PM impact:** none — pure dead-code removal, no behavior change.

## 2026-07-13 — claude-local shim tab task; AdminPromptPeek tag-tree view; book-agent scope-fence cleanup `[chore]`
- **What:** Three bundled items. (1) Diagnosed a `claude-local` agent-tier failure ("Network is unreachable" hitting `host.docker.internal:8788`) — the laptop-side `claude-local-shim.mjs` sidecar wasn't running; started it and confirmed `/health`. Added `.vscode/tasks.json` ("Claude Local Shim" task, dedicated panel) so it launches in its own VS Code terminal tab in one Command-Palette step instead of a manual `pnpm dev:claude-local-shim` in a spare terminal; `dev:all` already excluded it, no change needed there. (2) `AdminPromptPeek.tsx` rewritten from a raw JSON/text dump into a collapsible, per-tag colored section tree (parses the `<tag note="...">` XML wrapping context.ts already emits) plus a fullscreen modal — makes the admin debug peek actually legible. (3) `book-agent/{context,proposals,shared,tools}.ts` drop the last server-side remnants of the aspect-scope fence (`context_scope` column read, `Aspect`/`scopedKinds`, the scope param threaded through `threadSystem`/`proposeNodeOps`/`threadToolsFor`) — completes "whole book always visible" ([[project_agent_context_model]]); scope was already unused client-side.
- **Files/commits:** `.vscode/tasks.json` (new); `apps/web/src/features/dna/components/agentRail/AdminPromptPeek.tsx` (rewrite); `apps/web/src/features/dna/components/AgentRail.tsx`; `supabase/functions/book-agent/{context,proposals,shared,tools}.ts`. All uncommitted.
- **PM impact:** none — dev-tooling fix + debug-UI polish + dead-code cleanup, no product behavior change.

## 2026-07-13 — AdminPromptPeek: persist after the turn finishes `[chore]`
- **What:** The admin raw-request peek was gated on `running`, so it fetched nothing and unmounted the moment a turn finished — useless for reviewing what was just sent. Dropped `running` from both the `useLatestAiCall` `enabled` flag and the render condition in AgentRail; it now fetches/shows the run's latest `ai_calls` row regardless of live/finished state, still admin-gated only.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx` (uncommitted).
- **PM impact:** none — debug-UI-only.

## 2026-07-13 — Remove the Anthropic-key parameter from callLLM (all edge fns) `[chore]`
- **What:** Extends the book-agent-only fix below to the root. Every edge fn was forced to read `ANTHROPIC_API_KEY` and hand it to `callLLM(apiKey, …)`, but callLLM's only use of it was `?? apiKey` as the Anthropic-route fallback — redundant (that route already reads the same env) and wrong for other routes. Dropped the `apiKey` param from `callLLM` (+ the transitive chain: `judgeProse`/`judgeAgainstPlan`/`runMandateGate`/`foldDigest`/`buildProseDigest`/book-agent's `advance`/`maybeEagerAck`/`maybeTitleThread`/`maybeInjectRenderVerify`/`planConformanceSummary`) and removed the per-fn `if (!ANTHROPIC_API_KEY) 500` startup guards. Provider + key are now chosen entirely inside callLLM (ai_provider switch → resolveRoute → route.keyEnv). No behavior change for any configured provider; a real misconfig surfaces as that provider's own auth error.
- **Files:** 15 — `_shared/{llm,mandate-gate,plan-gate}.ts`, `book-agent/{index,advance,ack,verify,exec-tools}.ts`, `dna-expand`, `dna-chat`, `dna-decompose`, `evaluate-ai-call`, `read-{facts,synopsis,logline,premise,confusion,shape,meters}`. Verified: `deno check` clean on all 12 fn entries (only pre-existing EdgeRuntime-global noise); zero `apiKey` references remain.
- **PM impact:** none directly; removes the last hard `ANTHROPIC_API_KEY` dependency so a full non-Anthropic run is possible. Relevant to [[project_model_stack_openrouter]] + the ai_provider switch.

## 2026-07-13 — book-agent: drop the Anthropic-key hard coupling `[chore]`
- **What:** book-agent 500'd at startup (and check_against_contract returned "unavailable") whenever `ANTHROPIC_API_KEY` was unset — a false dependency, since the provider is chosen per-call in callLLM (ai_provider switch + resolveRoute) and each route supplies its own key. `apiKey` was only ever the Anthropic-route fallback. Removed both guards; default `apiKey` to `""` so a genuine misconfig surfaces as the active provider's own auth error. Running purely on DeepSeek/OpenRouter no longer requires an Anthropic key. No behavior change for the current deepseek config.
- **Files:** `supabase/functions/book-agent/{index,exec-tools}.ts`. Verified: `deno check` clean (only pre-existing EdgeRuntime-global noise).
- **PM impact:** none (removes a latent blocker for a full Anthropic-key-less run; relevant to [[project_model_stack_openrouter]] / the ai_provider switch).

## 2026-07-13 — AdminPromptPeek: tag-aware collapsible render + fullscreen modal `[chore]`
- **What:** Followed up the escaped-JSON fix with real formatting. `context.ts` already wraps each context kind in its own XML tag (`<book_state>`, `<brief>`, `<current_objective>`, `<story_analysis>`, `<dna_tree>`, etc. — comment at context.ts:252 says this is deliberate, for the model's benefit). Added a bounded parser that splits on those top-level tags and renders each as a colored, collapsible section (big reference blocks like `dna_tree`/`skill_briefs`/`story_analysis` start collapsed, payload blocks start open). Added a maximize button opening a shadcn `Dialog` with the same tree at full width/height for comfortable reading.
- **Files/commits:** `apps/web/src/features/dna/components/agentRail/AdminPromptPeek.tsx` (uncommitted). Verified: `tsc -p tsconfig.app.json --noEmit` and `eslint` both clean on the file.
- **PM impact:** none — debug-UI-only.

## 2026-07-13 — Thin book-agent index.ts to the HTTP router `[chore]`
- **What:** Follow-up to the 8-module split — index.ts was still 845 lines because the durable-loop engine lived there. Moved advance()+chain+ackWith+rejectAndChain+sleep → `advance.ts` (400), the eager-ack/titling passes → `ack.ts` (137), and the transcript pure-helpers (compaction, sentinels, cache-breakpoints, book-state injection) → `transcript.ts` (141). index.ts is now **184 lines** = just the Deno.serve request router. Verbatim block-move via build script; behavior unchanged.
- **Files:** `supabase/functions/book-agent/{index,advance,ack,transcript}.ts`. Verified: `deno check` on the entry (whole graph) clean bar the pre-existing EdgeRuntime-global noise; every moved symbol defined exactly once.
- **PM impact:** none.

## 2026-07-13 — Fix AdminPromptPeek escaped-JSON soup `[chore]`
- **What:** The admin raw-request peek in AgentRail rendered `messages` via one blind `JSON.stringify(input, null, 2)`, so every text block's real newlines/quotes got re-escaped into unreadable `\n`/`\"` soup. Rewrote to walk the Anthropic-shaped message array structurally: per message role, per content part — text parts render as plain wrapped text (real newlines), non-text parts (tool_use/tool_result/etc.) get their own pretty JSON. `system` unchanged (was already a raw string).
- **Files/commits:** `apps/web/src/features/dna/components/agentRail/AdminPromptPeek.tsx` (uncommitted). Verified: `tsc -p tsconfig.app.json --noEmit` clean.
- **PM impact:** none — pure debug-UI readability fix.

## 2026-07-13 — Split book-agent/index.ts into 8 modules `[chore]`
- **What:** Full file split of the 1974-line edge function into a clean import DAG: `shared.ts` (types/constants/nodeHandle/schema), `prompts.ts`, `tools.ts` (tool schemas), `exec-tools.ts`, `verify.ts`, `proposals.ts`, `context.ts` (threadSystem+digest), `index.ts` (router+advance loop, now 845 lines). Follows the earlier `ackWith`/`rejectAndChain`/`chain` dedup. Pure verbatim block-move (build script sliced ranges — no prompt-string retyping); behavior unchanged. Also removed a stray `/` typo at `advance(...);/` that a concurrent IDE edit left in, breaking compilation.
- **Files:** `supabase/functions/book-agent/{index,shared,prompts,tools,exec-tools,verify,proposals,context}.ts` (uncommitted). Verified: `deno check` on the entry (whole graph) clean — only the pre-existing `EdgeRuntime`-global noise; every moved symbol defined exactly once.
- **PM impact:** none (no behavior/scope change).

## 2026-07-13 — Admin-only raw LLM request peek in AgentRail `[ship]`
- **What:** User wanted to see the actual request sent to the LLM (right before the "thinking…"
  loader), admin-only, with no added latency. Reused existing infra rather than inventing new
  storage: `ai_calls` already logs the full `system`/`input` for every call (including a 'running'
  row inserted before the network call even starts) and is already Realtime-published
  (20260713100000_ai_calls_realtime). New `useLatestAiCall` hook scopes that to one `task_id`
  (Realtime event as signal, refetch one row — same discipline as `admin/AiCalls.tsx`'s
  heavy-columns-on-demand pattern, so cost is one small query per turn, only for admins, never for
  everyone else). New `AdminPromptPeek` component: collapsed one-liner (model/tokens), expands to
  full system+messages. Gated on the existing `useAdmin()` hook + `running`.
- **Files/commits:** new `apps/web/src/features/dna/hooks/useLatestAiCall.ts`,
  `apps/web/src/features/dna/components/agentRail/AdminPromptPeek.tsx`; wired into
  `AgentRail.tsx`. No backend/RLS changes needed. `vite build` clean. Uncommitted.
- **PM impact:** none — admin debug tooling, not a product surface.

## 2026-07-13 — book-agent advance() dispatch readability refactor `[chore]`
- **What:** Extracted two helpers in the agent chain-link dispatch — `ackWith()` (terminal-call/sibling tool_result builder, was inlined 3×) and `rejectAndChain()` (the identical toolResults→push→update→chain block ending all 4 `propose_*` reject paths). Pure dedup, behavior byte-identical; net −11 lines, flatter dispatch. `chain()` + `groundingLabels` already landed via a parallel session's commit (a5e1941).
- **Files/commits:** `supabase/functions/book-agent/index.ts` (uncommitted). Verified: `deno check` clean (only the pre-existing `EdgeRuntime`-global noise, 28→6).
- **PM impact:** none (no behavior/scope change).

## 2026-07-13 — Fix grounding-line repetition (live-reported bug) `[ship]`
- **What:** User saw the same-day grounding line (turn-grounding ship, above/earlier) repeat 10x
  identically in the rail ("Step 5/5 · Prose — Scenes — Scene 8 of 10..."). Root cause: the line
  collapsed to just the objective headline whenever focus/mentioned/skill were empty (the common
  case on auto-continue turns), so it repeated verbatim every turn. Fix: dropped the objective
  headline (redundant with the "next step" card); now emits one entry per concrete action
  ("Loaded the scene-craft playbook.", "Loaded scene "X" in full."), matching the existing
  read_node/read_skill tool-step phrasing, and deduped against steps since the last user/answer
  message so a multi-turn auto action doesn't re-announce unchanged context every turn.
- **Files/commits:** `supabase/functions/book-agent/index.ts` (threadSystem + call site),
  `docs/agent-turn-grounding.md` rewritten with a "first attempt, and why it was wrong" section.
  Deployed to prod.
- **PM impact:** none beyond the existing AgentRail STATE.md row (already covers the grounding-line
  ship; this is a same-day correction, not a new capability).

## 2026-07-13 — Per-node content history + revert `[ship]`
- **What:** Fine-grained node audit log so an author can see a single node's content timeline, tell
  exactly what an AI op changed, and revert one node to an earlier state. New `book_node_revisions`
  table + `SECURITY DEFINER` trigger on `book_nodes` captures every content-changing write
  (source-agnostic: agent / manual / bridge); state-based full-content snapshots; keep-50/node;
  precise AI attribution (`ai_call_id` set only when `last_ai_call_id` changes on that write).
  `NodeHistory` timeline wired into the existing `NodeDetailsModal` with field-level diff + restore.
  Verified end-to-end at the DB layer (trigger fires/skips correctly, attribution, forward-moving
  revert); UI typechecks but not yet browser-driven.
- **Files:** `supabase/migrations/20260713110000_book_node_revisions.sql` (pushed),
  `apps/web/src/features/dna/lib/nodeRevisions.ts`, `components/tree/modals.tsx` (NodeHistory + shared
  `specRows`). Uncommitted.
- **PM impact:** none — adjacent to M1 (author trust/transparency), not a Now-slot item. No promotion.

## 2026-07-13 — Agent turn grounding line `[ship]`
- **What:** The rail showed only a generic "thinking…" spinner during a turn's model call (up to
  ~100s). `threadSystem()` (book-agent/index.ts) already computes everything needed for a status
  line as a byproduct of context assembly — it now also returns `grounding` (focus/mentioned counts,
  objective headline, matched skill brief), written as a `{t:"read"}` step folded into the existing
  pre-call `turns` update (no extra DB round-trip). Client needs no changes — `StepBubble` already
  renders `read` steps as a muted activity line. Always emitted, no turn-to-turn dedup.
- **Files/commits:** `supabase/functions/book-agent/index.ts` (threadSystem + call site), new
  `docs/agent-turn-grounding.md`. Deployed to prod (`supabase functions deploy book-agent`).
- **PM impact:** addendum on the AgentRail row in `pm/STATE.md`.

## 2026-07-13 — Composer: drop the "/ for commands" idle hint `[chore]`
- **What:** Removed the small "/ for commands" hint line (and its now-unused `Slash` icon import)
  that showed under the composer when idle and empty. Editorial tweak, no behavior change to the
  slash-command menu itself.
- **Files/commits:** `apps/web/src/features/dna/components/agentRail/Composer.tsx` — uncommitted.
- **PM impact:** none.

## 2026-07-13 — DNA architecture challenge brief `[chore]`
- **What:** wrote `docs/dna-architecture-challenge-brief.md` — a red-team briefing doc (system-as-built
  first, our own self-critique last, to avoid anchoring) meant to be handed to an independent/stronger
  model to challenge the DNA architecture. Poses 6 pointed open questions (is structure the real
  bottleneck vs. prose craft, is tree-as-truth earning its complexity, cache-hostile agent context,
  auto-accept convergence, modal-story ceiling, single load-bearing assumption).
- **Files/commits:** `docs/dna-architecture-challenge-brief.md` (new, uncommitted).
- **PM impact:** none — a review artifact, not a shipped change. Worth reading before/alongside the
  Now-1 "re-exercise the live full-book build" item, since its own §6 Q1 questions whether that item is
  attacking the real bottleneck.

## 2026-07-13 — AgentRail split into subcomponents `[chore]`
- **What:** Pure readability refactor, no behavior change. AgentRail.tsx (896 lines) shrunk to a 431-line
  orchestrator; header controls, composer, and the step/proposal/session display pieces moved into a new
  `agentRail/` folder (AgentRailControls, Composer, DiffRows, ProposalCard, ResolvedCard, SessionHistory,
  StepBubble, journeyContent, opSummary). Typecheck + eslint clean; only importer (DnaTreePage) unaffected.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx` (rewritten), new
  `apps/web/src/features/dna/components/agentRail/*` (9 files) — uncommitted.
- **PM impact:** none.

## 2026-07-12 — DNA tree: ghost-preview the default skeleton before anything is generated `[ship]`
- **What:** User wanted the tree to show the book's shape (3 acts, minimum cast, etc.) before any
  generation — a scaffold-first view instead of the current one-rung-unlocks-the-next journey. Investigation
  found most of the UI for this already existed (the pillar's `alwaysShow` entity/story groups), gated only
  on the pillar node existing for real, which it doesn't until first generated. Rather than materializing
  empty draft `book_nodes` rows (risky: `dnaJourney.stageComplete()` gates acts/beats on mere row EXISTENCE,
  not content — a real empty act would have silently marked "structure" done), built a pure client-side
  render overlay: new `lib/dnaSkeleton.ts` derives ghost premise→pillar→{2-person min cast, Weiland's 3 acts
  with their 9 template-slotted beats (hook/inciting/plot points/pinches/midpoint/climax/resolution)} from
  the current tree + `structureForBook()`; new `components/tree/GhostRows.tsx` renders them dashed/faint,
  read-only. A rung ghosts only while ENTIRELY empty and disappears for good the moment any real node lands
  there (matched by sibling position, not title, so a renamed act still gets its slot's beats). Locations/
  world/threads/tentpoles/games/relationships have no template count anywhere in the schema, so those got
  one honest "registry" note instead of fabricated numbers. Wired into `Subtree.tsx` at 4 injection points.
  Verified live on book "tes" (1251) via chrome-devtools MCP — full 3-act/9-beat/2-cast skeleton renders
  correctly at the empty-tree state from the user's screenshot; `tsc --noEmit` clean; existing
  `novelDna.test.ts` + `dnaJourney.test.ts` (131 tests) still pass.
- **Files/commits:** `apps/web/src/features/dna/lib/dnaSkeleton.ts` (new),
  `apps/web/src/features/dna/components/tree/GhostRows.tsx` (new),
  `apps/web/src/features/dna/components/tree/Subtree.tsx` (uncommitted).
- **PM impact:** none — a UX/discoverability improvement on the existing DNA tree, not a Now-item change.

## 2026-07-12 — Beat-sheet quality fixes + shim leak actually plugged `[wip]`
- **What:** Three fixes surfaced while re-exercising live beat-sheet generation on the deepseek-v4
  path (Now #1). (1) `dna-expand`'s beat sheet prompt now converts the Weiland template's cumulative
  act `target_pct` into per-act SPANS and tells the model to allocate beats proportionally — root-fixes
  the starved-Act-2 failure (beats were split evenly across acts instead of ~half landing in the ~50%-
  of-book Act 2). (2) `max_tokens` 8000→16000 on both the beat-sheet prepare and repair calls — a
  reasoning model (deepseek-v4-pro) counts its thinking phase INSIDE max_tokens, so 8000 was silently
  truncating the JSON mid-array (root cause of book 1237's unslotted sheet). (3) The repair prompt now
  branches by issue class (causal vs structure-slot) and — for slot issues only — is allowed to
  insert/reorder beats to fill a genuinely missing signpost, instead of a one-size prompt that forbade
  adding beats even when a slot was structurally absent. Separately: `claude-local-shim.mjs`'s prior
  "isolate spawned claude" fix (`--system-prompt`, committed in f1895de) was re-verified and found
  NOT sufficient — the global `~/.claude/CLAUDE.md` and plugin SessionStart blobs still leaked into
  book-agent's persona. `--safe-mode` (not `--bare`, which forces API-key-only auth) actually
  disables ambient CLAUDE.md/skills/plugins/hooks/MCP while keeping subscription auth — verified with
  a leak probe returning clean. `eval-bridge.mjs`'s default prose model also flipped opus→sonnet.
- **Files/commits:** `supabase/functions/dna-expand/index.ts`, `scripts/claude-local-shim.mjs`,
  `scripts/eval-bridge.mjs` (all uncommitted, edge fn not yet redeployed).
- **PM impact:** none yet — feeds directly into Now #1's "re-exercise the live full-book build"
  evidence gate (ROADMAP.md); not itself a ship.

## 2026-07-12 — Seed logline: stop auto-generating from brief idea `[chore]`
- **What:** The DNA tree's seed logline was being silently prefilled from `brief.idea` and then
  auto-drafted via an AI call the moment the idea field was saved (`bootstrapLoglineFromBrief`).
  Removed that entirely — the seed's logline now starts empty; the author writes it or asks the
  agent explicitly. `ensureSeed()` no longer takes/prefills an idea.
- **Files/commits:** apps/web/src/features/dna/lib/dnaExpand.ts,
  apps/web/src/features/dna/pages/DnaTreePage.tsx, apps/web/src/components/book/BookBriefSection.tsx
  (uncommitted).
- **PM impact:** none — small UX correction to the brief→seed derivation, not a Now-item change.

## 2026-07-12 — AgentRail: fix markdown tables rendering as raw pipe text `[chore]`
- **What:** User-reported bug — GFM tables (e.g. Weiland beat-sheet analysis) in AgentRail chat
  rendered as literal `| a | b |` text instead of a table. Root cause: `ReactMarkdown` in
  `AgentRail.tsx` had no `remark-gfm` plugin, so GFM-only syntax (tables) fell back to plain
  paragraph text. Installed `remark-gfm`, wired `remarkPlugins={[remarkGfm]}`, and wrapped the
  `table` renderer in `overflow-x-auto` (rail is a narrow fixed panel). Verified live on book 1249
  ("3 acts") — table now a real 11×3 DOM `<table>` with styled headers.
- **Files/commits:** `apps/web/src/features/dna/components/AgentRail.tsx`, `apps/web/package.json`,
  `pnpm-lock.yaml` (added `remark-gfm` dep). Uncommitted.
- **PM impact:** none — isolated UI bug fix, not tied to a roadmap item.

## 2026-07-12 — eval-bridge: add `sketch` target + isolate spawned-claude from repo hooks `[chore]`
- **What:** In-app "generate sketch" failed with `Unknown expand target "sketch"`. Root cause was
  dev-path routing: `VITE_EVAL_BRIDGE_URL` is set, so the client routes `/dna-expand` to the local
  eval-bridge, which mirrored `logline/prose/beatsheet` but not `sketch` → fell through to the
  catch-all. Added the `sketch` branch mirroring `dna-expand/index.ts:706` (SCENE_DIRECTION_CRAFT
  inlined, `runClaude`). Then hit a 2nd failure — `unparsable JSON`: the bridge's `runClaude` spawns
  `claude -p` in repoRoot loading ALL setting sources, so the sub-instance fired this repo's PROJECT
  PM Stop hook and answered the `/wrap` nag instead of emitting JSON. Fix: default CLAUDE_FLAGS now
  `--dangerously-skip-permissions --setting-sources user` — drops the project hook while keeping
  user-level OAuth. (`--bare` also kills the hook but broke auth → "Not logged in", so reverted.)
  Verified the flag combo returns clean JSON via a direct `claude -p` probe.
- **Files:** `scripts/eval-bridge.mjs` (sketch branch ~3733; CLAUDE_FLAGS L27-33).
  Uncommitted, bridge restarted. Deployed `dna-expand` already had sketch — no edge change needed.
- **Verify:** routing + auth + clean-JSON confirmed server-side; final in-app sketch render pending an
  authenticated browser retry (book 1249, node n_gif4aamnn).
- **PM impact:** none (dev-tooling; bridge is not the required dev route).

## 2026-07-12 — claude-local bridge context bleed fixed with `--safe-mode` `[ship]`
- **What:** Book-agent calls via the `claude-local` shim were inheriting this coding harness's
  global `~/.claude/CLAUDE.md` (PM `/wrap` ritual, "teach me", chime) + enabled-plugin SessionStart
  hooks (Vercel blob) — contaminating the novelist persona (surfaced as a logline reply narrating a
  coding session). Root cause: on CLI 2.1.207 `--system-prompt` does NOT suppress ambient
  CLAUDE.md/plugins (the old comment's claim was empirically false). Fix: add hardcoded `--safe-mode`
  to the `claude -p` spawn — disables all customizations WITHOUT `--bare`'s ANTHROPIC_API_KEY-only
  auth restriction, so subscription billing survives. Verified worst-case (cwd=repo, key unset) →
  leak probe returns `NONE`, auth intact; and end-to-end through the restarted HTTP shim.
- **Files/commits:** `scripts/claude-local-shim.mjs` (+22/−15; `--safe-mode` in `runClaudeLocal`
  args + corrected header comments). Investigation `doc_1783843689012.md`,
  `learning_1783843689012_shim-safe-mode.md`. Not committed. (Also restarted the live shim: killed
  stale 1.5-day PID that predated the fix.)
- **PM impact:** none to promote — the bridge is dev-only tooling, not a curated STATE project row.
  Note: `supabase/functions/dna-expand/index.ts` shows modified in the tree but is NOT this task's
  work (left untouched).

## 2026-07-12 — Diagnosed Supabase egress-quota trip (Free tier hit 6.81/5.5GB) `[chore]`
- **What:** User hit a Supabase Free-plan egress quota email and had already upgraded to Pro;
  asked to find the root cause. Explore-agent audit of migrations + client found `book_nodes`
  has `REPLICA IDENTITY FULL` + is in the `supabase_realtime` publication — same shape as the
  previously-fixed `book_agent_runs` bug, but never generalized. `useBookNodesLiveSync.ts`
  refetches the *entire* DNA tree (`select("*")`) on any single node change, so one agent turn
  editing many nodes fires many full-tree broadcasts to every open tab. Secondary finding:
  `BookDetails.tsx` refetches `pages.select("*")` (incl. `embedding`, `old_content`) on every
  page write. No code changed — investigation only; fix proposed, awaiting go-ahead.
- **Files/commits:** doc_1783842088499.md (write-up); implicated: `supabase/migrations_archive/
  20260627120000_book_nodes_replica_full.sql`, `apps/web/src/features/dna/hooks/
  useBookNodesLiveSync.ts`, `apps/web/src/pages/books/show/BookDetails.tsx`. No commits.
- **PM impact:** none yet — candidate fix (revert `book_nodes` replica identity + incremental
  live-sync instead of whole-tree refetch) not promoted; needs author sign-off before it ships.

## 2026-07-12 — Slot badges on tree beat rows `[ship]`
- **What:** The structure-template slot names (hook / midpoint / climax…) now render as a small
  uppercase chip on each carrying beat's row in the tree — the tree reads like a beat board.
  Hover = the slot's target % + craft line. Pure display: `beatSlot()` in nodeDisplay.ts resolves
  labels across all templates; unresolved keys still display (underscores → spaces).
- **Files/commits:** components/tree/nodeDisplay.ts, components/tree/TreeRow.tsx (uncommitted).
- **PM impact:** appended to the Story structure templates row in STATE.md.

## 2026-07-12 — Fix stale bridge gate: beat sheets no longer require pre-declared threads `[chore]`
- **What:** Local dev bridge (`scripts/eval-bridge.mjs`, used when `VITE_EVAL_BRIDGE_URL` is set)
  still hard-gated beat-sheet generation on `threads.length`, throwing "generate the threads
  before the beat sheet." That check was removed from the edge fn (`dna-expand`) on 2026-07-02
  when threads became derived/minted by the beat sheet itself, but the bridge — documented as a
  special-case shim, not a kept-in-sync mirror — never got the update. Deleted the stale gate line
  (did not port the edge fn's full mint-threads/structure/lint pipeline — out of scope for this
  fix). Killed and restarted the running bridge process so the fix is live.
- **Files/commits:** `scripts/eval-bridge.mjs` (uncommitted).
- **PM impact:** none — dev-tooling bug fix, not a product-facing change.

## 2026-07-12 — Story structure templates: opinionated 3-act agent `[ship]`
- **What:** The agent now builds against K.M. Weiland's three-act / 8-beat structure by default,
  as swappable data (strategy pattern), not prompt prose. `StructureTemplate` const (9 slots with
  % positions + craft guidance-by-name) in both engine twins; `BeatContent.slot` marks the carrier
  beat; `pillar.structure` picks the method ("none" opts out, absent = default at read time).
  Beatsheet prompt lists the slots and demands each on exactly one beat; acts playbook fixes three
  acts with template target_pct. Verify half: slot_missing/duplicate/misplaced/misordered/unknown
  lints in validate() (fail-quiet for legacy trees) — also wired into the beat sheet's bounded
  repair turn. Honors the removed-Freytag decision: the opinion is explicit and swappable, never
  silent; other methods (Save the Cat…) = one more registry entry in both twins.
- **Files/commits:** novelDna.ts + _shared/novel-dna.ts (twins), dnaSchema.ts + dna-schema.json,
  dnaJourney.ts + _shared/dna-journey.ts, dna-expand/index.ts, book-agent/index.ts (digest),
  novelDna.test.ts (+8), novelDna.parity.test.ts (structureBook fixture, 671 assertions) —
  uncommitted on feat/ai-provider-switch. Deployed: dna-expand, book-agent, dna-chat, dna-decompose.
- **PM impact:** strengthens M1 (The First Read) — the live full-book build re-exercise (Now #1)
  will now generate against the template; watch slot lints in that run.


## 2026-07-12 — DNA tree: stop echoing summary/goal as the inline title `[chore]`
- **What:** Act/scene/beat rows in the tree editor showed the same text twice — the inline title next to the kind badge duplicated the SUMMARY (beat) or fell back to GOAL (act/scene) when no distinct title was set. `nodeTitle()` now only uses each kind's real short-title field (blank for beat, which has none; goal/summary stay visible in the expanded row).
- **Files/commits:** `apps/web/src/features/dna/components/tree/nodeDisplay.ts` (uncommitted).
- **PM impact:** none.

## 2026-07-12 — node details modal now shows all content fields `[chore]`
- **What:** User noticed `value_shift` (and every other plan field — goal/conflict/outcome/etc.)
  was invisible in the node "view details" modal — it only ever showed provenance (AI call/prompt)
  and derived analysis, never the node's actual schema content. Added a `ContentFields` block to
  `NodeDetailsModal` that iterates `editSpecs(node.kind)` + `hiddenFields()` and renders every field
  read-only, reusing the same `displayValue`/`hiddenFields` helpers the inline tree editor already
  uses (so refs resolve to node titles, not raw ids). No new fields added to the schema — this was
  a projection gap in the modal, not missing data.
- **Files/commits:** `apps/web/src/features/dna/components/tree/modals.tsx` (uncommitted).
- **PM impact:** none — small UI completeness fix, no roadmap/state change.

## 2026-07-12 — verified the brief/premise reads live, fixed a truncation bug `[ship]`
- **What:** Built on the "LLM reviewer for logline and premise" work (commit `8acc313`, already
  landed): deployed `read-logline`/`read-premise`/`dna-expand` to Supabase, then verified both
  new judges end-to-end against the real deployment — no browser available this session (both
  claude-in-chrome and chrome-devtools-mcp were unreachable), so instead scripted a throwaway
  smoke test: a disposable user + book + seed/premise nodes via service-role writes, a real
  signed-in session, direct HTTP calls to both edge functions, verdict inspected, then torn down.
  `read-logline` worked first try. `read-premise` 500'd with "Unexpected end of JSON input" —
  its response was getting truncated before the model could emit the closing JSON (the longest
  system prompt of the three reads: full `PREMISE_CRAFT` text + 7 axes, on the same 1400-token
  budget `read-shape`/`read-synopsis` use for less). Bumped `max_tokens` 1400 → 3000, redeployed,
  reran — both reads now return full, well-grounded verdicts. `logline_fixity` correctly caught a
  deliberately-planted obstacle swap (storm → rival keeper) in the test premise, scoring it 2/5
  with an accurate note — the exact new capability this axis was built for.
- **Files/commits:** `supabase/functions/read-premise/index.ts` (max_tokens fix, not yet
  committed — left for the user/next catalogue pass per the "never commit unless asked" rule).
- **PM impact:** none beyond what `8acc313` already covers; this entry documents the live
  verification pass and the one post-commit fix.

## 2026-07-11 — traced the logline review/accept loop for the user `[chore]`
- **What:** User asked how a generated logline gets reviewed and "closes the loop." Traced the
  existing (already-shipped) mechanism rather than proposing anything new: `dna-expand` generates
  the seed's logline from the brief idea; `verticalLints()` (`novelDna.ts`) runs two deterministic,
  warn-only checks (`logline_overlong`, `logline_static`) with no LLM-judge; the author's explicit
  Accept flips `seed.authoring.status`, which both unlocks the Premise stage
  (`dnaJourney.ts`) and becomes the FIXED contract premise/pillar generation must honor. No code
  changed, no design gap found worth flagging beyond noting the mechanical-only review (no
  semantic/LLM check on obstacle specificity or stakes).
- **Files/commits:** none (explanation only); `doc_1783756703717.md` +
  `learning_1783756703717_logline_review_loop.md` (local-only, not committed).
- **PM impact:** none.

## 2026-07-11 — stale-mechanism design question raised, not yet ratified `[wip]`
- **What:** User proposed replacing the tree's automatic parent→children staleness with an
  explicit write-time choice (nothing goes stale / mark children stale / discard children).
  Traced the current mechanism to ground the discussion: staleness is derived, not set —
  `isStale()` (`novelDna.ts`) hashes a node's live inputs and compares against the recorded
  `src_hash`; nothing ever "marks" a child, the mismatch just shows up on next read via the
  existing per-node stale-chip accept/discard UI (`staleActions.ts`). No code changed. Open
  question surfaced for the user: is this decision point for manual tree edits, the agent's edits
  (manual-accept/auto-accept), or both — and if manual, blocking modal vs. lighter inline
  affordance, since a modal on every parent save cuts against the no-edit-reflex bar (NORTH_STAR
  §2).
- **Files/commits:** none (discussion only); `doc_1783755713224.md` (local-only trace of the
  current mechanism + the tradeoffs, not committed).
- **PM impact:** none yet — no ROADMAP/DECISIONS entry until the user ratifies a direction.

## 2026-07-11 — clear all nodes: whole-tree discard option in the overflow menu `[ship]`
- **What:** Committed by a concurrent session, uncatalogued until now. Added an "everything" level
  to `DiscardStoryModal` (previously prose/scenes/beats/story) that snapshots the tree to History
  then deletes the true root node (`parent_id === null`) so `ON DELETE CASCADE` clears the whole
  tree, including foundations — wired to a new "✕ clear all" item in the tree's overflow menu
  (`DnaTreePage.tsx`). Fixes the modal's pre-existing `pillar`-vs-`seed` root confusion (pillar is
  a grandchild of the true root via seed → premise → pillar, so deleting it left seed/premise
  behind).
- **Files/commits:** `apps/web/src/features/dna/components/tree/modals.tsx`,
  `apps/web/src/features/dna/pages/DnaTreePage.tsx` — `95bfb5b`.
- **PM impact:** noted on the DNA tree editor row in STATE.md.

## 2026-07-11 — committed the tentpole guidance-by-name fix `[chore]`
- **What:** Landed the previously-catalogued tentpole fix (see the entry directly below) as commit
  `386769a`. No new work — just closing the loop from "not yet committed" to committed. Left the
  unrelated pre-existing WIP (`modals.tsx`/`DnaTreePage.tsx` "discard everything" feature,
  `doc_*.md`/`todo.md`) unstaged/untracked, out of scope for this commit.
- **Files/commits:** `386769a`.
- **PM impact:** none new — same as the entry below.

## 2026-07-11 — tentpoles: guidance-by-name, not verbatim-text matching `[ship]`
- **What:** `tentpole` was the only DNA entity with no short `name` field — its one `summary` field
  did double duty as both the beat-sheet generator's matching key (exact lowercase text match) and
  its content, so the prompt forced the model to quote a whole sentence back verbatim just to get a
  tentpole placed; a paraphrase silently dropped it (surfacing later as an unexplained
  `tentpole_unplaced` lint). Fixed by mirroring the thread/game/world_fact pattern: added a required
  `name` field, relabeled `summary` → "guidance" (a feel/turn to honor, not a line to quote), and
  switched the beat-sheet + brief-compile prompts in dna-expand to reference tentpoles BY NAME.
  Propagated through the agent's tree digest, tree UI title, obligation-ledger display name (both
  parity-locked novelDna twins), and the EPUB-import decompose path, with a legacy fallback so
  already-authored tentpoles (no `name` yet) keep resolving. Regenerated the checked-in
  dna-schema.json artifact. 600 web vitest tests pass (incl. 449 parity), tsc clean.
- **Files/commits:** `apps/web/src/features/dna/lib/dnaSchema.ts`,
  `apps/web/src/features/dna/lib/dnaSchema.artifact.test.ts`,
  `apps/web/src/features/dna/lib/novelDna.ts`, `apps/web/src/features/dna/components/tree/nodeDisplay.ts`,
  `supabase/functions/dna-expand/index.ts`, `supabase/functions/book-agent/index.ts`,
  `supabase/functions/dna-decompose/index.ts`, `supabase/functions/_shared/dna-decompose-core.ts`,
  `supabase/functions/_shared/novel-dna.ts`, `supabase/functions/_shared/dna-schema.json` — not yet
  committed or deployed.
- **PM impact:** none new (not a Now-list item; a scoped fix surfaced by the author reading the
  tentpole-realization code). Existing tentpoles in already-authored books now read as incomplete
  (missing `name`) until backfilled — expected, same as any new required field.

## 2026-07-10 — claude-local shim: per-call empty cwd; diagnosed two live-session incidents `[ship]`
- **What (requested):** Switched the shim's `claude -p` spawn from one shared tmpdir (created once,
  reused across every turn) to a fresh `mkdtempSync` directory per call, removed via `rmSync` once
  that call settles (success/error/timeout all clean up). Even with `--tools ""`, a reused cwd still
  gives Claude Code something to walk up from as ambient project context, and isn't guaranteed-empty
  over a long shim uptime. Verified text and tool_use round trips both still correct, no leftover
  directory after either.
- **What (incident response, same session):** User hit two problems live. (1) "Applied automatically
  without notice, no proposal" — traced via `ai_calls` to `fn: dna-expand, source: bridge, model:
  claude-code-local` — a completely different, pre-existing system (eval-bridge.mjs via
  `VITE_EVAL_BRIDGE_URL`), not book-agent or claude-local at all; not something this work touched.
  (2) Agent UI stuck after clicking Stop on book "mp5" (book_id 1238) — this one WAS my fault: I'd
  killed `supabase functions serve` after my last verification pass and never restarted it, so the
  user's "Generate logline options for the seed." request hit a dead backend and orphaned the run
  (same failure shape as the earlier CHAIN_SECRET incident, different cause). Reset the row, restarted
  `functions serve`, confirmed both it and the shim healthy, and stopped restarting local servers
  while the user is actively testing.
- **Files/commits:** `scripts/claude-local-shim.mjs` (`ceceb54`).
- **PM impact:** none new — reinforces the entries below. Real lesson: don't cycle local dev
  infrastructure (`functions serve`, the shim) while a user has a live session against it: it looks
  identical to the orphaned-run bug from the DB side, costs debugging time to distinguish from a real
  regression.


## 2026-07-10 — claude-local bridge: closes wip, verified working end-to-end on real book-agent traffic `[ship]`
- **What:** Closes the `[wip]` entry below. User drove a real "suggest logline" turn on book 1237 and
  it stalled ("thinking..." forever). Diagnosed via the local `functions serve` log: the isolate hung
  3+ minutes then got force-killed. Root cause was actually TWO stacked bugs, found by reproducing
  directly against the shim: (1) the shim's earlier cwd-isolation fix (tmpdir, no `--bare`) only
  stopped PROJECT-level `.claude/settings.json` hooks — the user's GLOBAL `~/.claude/CLAUDE.md` (a
  personal PM /wrap ritual) is loaded regardless of cwd and was contaminating every call: a fiction
  logline request came back narrating the user's own coding session and uncommitted files. Fixed with
  `--system-prompt`, which REPLACES Claude Code's default system prompt outright (verified: still
  works on subscription auth, no `ANTHROPIC_API_KEY` needed) — not
  `--exclude-dynamic-system-prompt-sections`, which only relocates those sections for cache reuse, the
  model still sees them. (2) `CHAIN_SECRET` was unset locally, so `self-chain.ts`'s continuation POST
  always 401'd silently — every local run died after one hop with nothing able to revive it (no local
  watchdog). Set a local-only value (self-consistent; doesn't need to match the deployed secret).
- **Verified live, real system, no mocks:** reset the orphaned run row, retried "suggest logline" on
  book 1237 through the actual browser UI (chrome-devtools-mcp) — real book-agent → local edge runtime
  → real hosted DB/auth → claude-local shim → real `claude -p` (23.4s) → correctly returned `tool_use`
  (`propose_options`, not hand-written text — matching book-agent's own design, not a shortcut) → 3 real
  on-brief logline options staged and visible in the tree → run settled `status=idle, turns=1,
  error=null`. No leaked context, no stall, no manual intervention needed on the second attempt.
- **Files/commits:** `scripts/claude-local-shim.mjs` (`5b6e387`); `supabase/functions/.env`
  (`CHAIN_SECRET`, gitignored, not committed).
- **PM impact:** the claude-local bridge (all three prior entries: shim, admin dropdown, local-Supabase
  infra, hosted-data routing) is now a genuinely working, end-to-end-verified dev feature, not just
  individually-tested pieces.


## 2026-07-10 — Agent-as-guide: journey-aware greeting + teach-as-you-go persona `[ship]`
- **What:** The AgentRail's empty state is now a scripted, journey-aware guide greeting — orients the ladder (idea→foundations→structure→scenes→prose), teaches the current rung's concept (STEP_TEACH), and switches to ideation stance when the brief has no idea (needsIdea → "Find the story idea" nudge + IDEA_MESSAGE). The book-agent system prompt gained a "Teach as you go" section (define each craft term on first use, 1–2 sentences of what/why per rung, pitch idea directions when the seed is blank). Chose scripted-greet + click-to-accept over auto-firing an AI turn on page open (cost/latency/double-fire).
- **Files/commits:** apps/web/src/features/dna/components/AgentRail.tsx, pages/DnaTreePage.tsx (brief prop), supabase/functions/book-agent/index.ts (deployed). Uncommitted on feat/ai-provider-switch. Design notes: doc_1783664950001.md.
- **PM impact:** none structural — folds into the DNA studio/agent surface row; not a Now item.

## 2026-07-10 — wip `[wip]` — book-agent can now reach claude-local through a real local run, restart needed to finish testing
- **What:** User pointed at a live AiCalls row (book 1237, deployed, real deepseek-v4-pro traffic) and
  asked for agent calls to route through claude-local. Confirmed book-agent always hits the DEPLOYED
  function (hardcoded hosted SUPABASE_URL in client.ts) and is explicitly NOT covered by the
  eval-bridge mirror — so the earlier CLAUDE_LOCAL_URL auto-default was inert for real usage. Fix
  needed the local-Supabase infra from the prior entries plus one more piece: pointing a LOCALLY-served
  book-agent at the HOSTED database/auth (not the empty local one), so it operates on real book data
  while only its LLM calls move to claude-local. Hit a platform block along the way — Supabase reserves
  the `SUPABASE_` env prefix, `--env-file` silently drops any attempt to set `SUPABASE_URL`/
  `SERVICE_ROLE_KEY` — worked around with non-reserved `LOCAL_DEV_HOSTED_SUPABASE_*` names that
  `_shared/task.ts`'s `serviceClient()`/new `userClient()` prefer when present (absent everywhere
  else, so no-op by default). `book-agent/index.ts` now uses the shared `userClient()` instead of
  inlining its own. Client side: `agentThread.ts`'s `invoke()` takes a new
  `VITE_LOCAL_BOOK_AGENT_URL` escape hatch — raw fetch to the local function with the real session
  token, bypassing `supabase.functions.invoke` (always resolves to deployed). Undefined by default.
- **Verified so far:** a throwaway local function confirmed `serviceClient()` reaches real hosted book
  1237 ("MF4") through the override, not the empty local DB. All edge fns + `apps/web` typecheck
  clean, 24 deno tests pass. NOT yet verified: a real book-agent turn through the actual browser UI —
  needs a `vite` restart to pick up `VITE_LOCAL_BOOK_AGENT_URL` (set in `apps/web/.env.local`),
  deliberately not done by me since the running dev server on :8080 might be the user's own session.
- **Files/commits:** `_shared/task.ts`, `book-agent/index.ts`, `agentThread.ts` (`507449f`);
  `supabase/functions/.env` + `apps/web/.env.local` (both gitignored, not committed).
- **PM impact:** none yet — `[wip]` until the browser round-trip is confirmed. Local Supabase
  infrastructure (prior entries) is what unblocked this.

## 2026-07-10 — craft-kb: one canonical craft copy for both write paths `[ship]`
- **What:** Extracted the duplicated story craft into `_shared/craft-kb.ts` (pure string consts, dependency-free): PREMISE_CRAFT (shape+question rules), CAUSALITY_CRAFT (needs/establishes but-therefore law), POLARITY_CRAFT (oscillation), SCENE_DIRECTION_CRAFT (cut/distance/mode/time/tension grammar). dna-expand's premise/beatsheet/sketch prompts interpolate them; the agent's premise-craft/structure-craft/scene-plan-craft skill bodies embed the SAME consts (verified byte-identical inclusion). Engine wording canonical. Bonus drift fix caught by the merge: engine's premise pass now allows ending_feel 'ambivalent' (schema always did; prompt+validator didn't). Confirmed client dnaExpand.ts holds no prompts (engine prompts live only in the edge fn), so this really is ONE copy. Both fns deployed.
- **Files/commits:** supabase/functions/_shared/craft-kb.ts (new), _shared/agent-skills.ts, dna-expand/index.ts.
- **PM impact:** appended to STATE row; closes the drift risk flagged in the 2026-07-10 skills entry.

## 2026-07-10 — fix "clear all" deleting the wrong node `[chore]`
- **What:** the "clear all" discard level (added earlier today, still uncommitted) deleted `pillarOf(nodes)` — but per `PARENT_KIND` the real root is `seed` (parent_id null) → `premise` → `pillar` → everything else. Deleting pillar left seed/premise behind, so on an early-stage book (no story content yet) the button visibly did nothing. Fixed to delete `nodes.find(n => n.parent_id === null)` instead — the true, guaranteed-unique root.
- **Files/commits:** `apps/web/src/features/dna/components/tree/modals.tsx` (uncommitted).
- **PM impact:** none — bugfix to the same unshipped change as the entry below.

## 2026-07-10 — "clear all" option in DNA tree studio `[chore]`
- **What:** added a "clear all nodes" entry to the tree's "⋯ More" overflow menu (next to History/JSON/Fork), so an author can wipe a book's whole DNA tree and start fresh. Extended the existing `DiscardStoryModal`'s level union with `"everything"` instead of a new component; deletes the single root `pillar` node (cascade takes the rest) after snapshotting a restore checkpoint to History.
- **Files/commits:** `apps/web/src/features/dna/components/tree/modals.tsx`, `apps/web/src/features/dna/pages/DnaTreePage.tsx` (uncommitted).
- **PM impact:** none — small additive UI affordance, no STATE/ROADMAP change.

## 2026-07-10 — claude-local admin dropdown; agent auto-defaults to claude-local locally; local Supabase fixed `[ship]`
- **What:** Three related pieces, in order. (1) Added `"claude-local"` to `AdminSettings.tsx`'s
  `ModelTier` dropdown (Dev-only badge) — closing the earlier gap where the backend tier existed but
  had no UI control. (2) Realized flipping that shared `admin_settings` row is unsafe to test with —
  confirmed live (user showed me the AiCalls table mid-session: real book-agent traffic running right
  now) — so instead added a SERVER-SIDE auto-default in `_shared/model-config.ts`: when
  `CLAUDE_LOCAL_URL` is set in the worker's own env (laptop-only, never present when deployed) and
  there's no explicit `ai_model_tier_agent` override, the agent role defaults to `claude-local`. Never
  writes `admin_settings`; an explicit override always wins. Considered and rejected gating this on
  the client's `VITE_EVAL_BRIDGE_URL` instead — `book-agent` is invoked via
  `supabase.functions.invoke`, which always hits the DEPLOYED function (`SUPABASE_URL` is hardcoded
  hosted, no local override) and explicitly bypasses the eval-bridge mirror by design
  (`agentThread.ts`'s own comment) — that gate would just break every agent call locally, not route
  it anywhere reachable. (3) That surfaced the real blocker: `supabase start` had never worked from
  empty (see the DECISIONS.md entry below) — fixed it, then re-verified the full agent-default chain
  through the REAL local stack (not raw `docker run`): `supabase functions serve` → local Postgres →
  `getRoleModels()` → `claude-local` → the shim → real `claude -p` → response back through the
  gateway. All correct.
- **Verified:** 4 new deno tests for the auto-default precedence (12 total in model-config.test.ts,
  all passing); `check-edge-functions.sh` clean across all 19 fns; `apps/web` `tsc --build` clean;
  live round trip through `supabase functions serve` with a throwaway verify function (deleted after).
- **Files/commits:** `apps/web/src/pages/admin/AdminSettings.tsx` (`2eb66aa`), `_shared/model-config.ts`
  + `.test.ts` (`9d2104b`), migration squash (this commit) — `supabase/migrations_archive/` (135 files,
  git-mv'd), `supabase/migrations/20260710140000_baseline_schema_dump.sql` (new baseline).
- **PM impact:** local Supabase bootstrap fix is a standing DECISIONS.md entry (see below) — the
  remote-push caveat (`migration repair` needed before next `db push`) is load-bearing and NOT yet
  acted on. Otherwise none; Now#1 (full-book build) still runs on the shared `deepseek-v4` config,
  untouched by any of this.

## 2026-07-10 — edit-as-a-system: craft + schema + position for every node edit `[ship]`
- **What:** Live MF4 failure (premise repriced, shape left stale — coupled fields edited independently) ratified the owner's principle: every node edit needs CRAFT + SCHEMA + POSITION. Shipped all three legs: core-prompt EDIT AS A SYSTEM rule with named couplings (premise question↔shape, character wound→lie→want→need, scene goal→conflict→outcome→value_shift); `<mentioned>` hydration now carries the ancestor path, children-stale note, and the kind's schema (edit-ready without a read); read_node returns the ancestor path + children-stale framing. Coupling rules also added to premise-craft and scene-plan-craft bodies. Deployed.
- **Files/commits:** supabase/functions/book-agent/index.ts, supabase/functions/_shared/agent-skills.ts.
- **PM impact:** appended to STATE "Agent instruction-following" row.

## 2026-07-10 — claude-local selectable from /admin/settings `[ship]`
- **What:** Added `"claude-local"` to `AdminSettings.tsx`'s `ModelTier` union + `TIERS` list (a
  "Dev only" badge, description covers the shim/env prerequisite and the fail-loud prod behavior).
  Not gated to the agent role only — tool-capable by default, so selectable for General/Prose/
  Structure too. Closes the gap from the earlier claude-local bridge ship: the backend tier existed
  (`_shared/model-config.ts`) but there was no UI control to actually pick it.
- **Verified:** `apps/web` `tsc --build` clean. No live browser check — the only reachable Chrome
  profile was already locked by another running session's tab, left undisturbed rather than killed.
- **Files/commits:** `apps/web/src/pages/admin/AdminSettings.tsx`. Uncommitted as of this entry.
- **PM impact:** none directly. Note: writing `ai_model_tier_agent=claude-local` from this page
  writes to the **hosted** `admin_settings` (local dev points there, not local Postgres) — so
  saving the setting itself isn't blocked by the local-DB-bootstrap gap noted in the prior entry;
  only a local `supabase functions serve` run to *exercise* it would be.

## 2026-07-10 — MF4 live test of premise-craft + node-editing skills for every kind `[ship]`
- **What:** (1) Live-tested premise-craft on MF4 (book 1237) via direct authenticated calls to the deployed book-agent: "Write the premise" → agent correctly surfaced the existing accepted premise instead of clobbering (Task discipline working); "Revisit the premise — offer fresh options, the question feels unpriced" → 4 options staged in ONE turn, all with PRICED dramatic questions, 5 escalating internal movements, want-vs-need finals, and the brief's mother-history element explicit (vs the old unpriced "Can love rooted in obligation ever grow…"). (2) Built the user's mid-session ask — editing craft for every node kind: 6 new skills (character-craft wound→lie→want-vs-need engine; world-craft operable rules/sensory locations; thread-craft promises/games/ledger; structure-craft but-therefore causality; scene-plan-craft value_shift/sketch; idea-voice-craft controlling idea/voice contract), each grounded in dna-schema's exact fields. Registry now 12 skills / ~16k body chars, injected only on matching turns. Fixed premise-craft's ending_feel enum (ambivalent is valid). Trigger matrix verified; deployed.
- **Found en route:** app.pensive.me serves a STALE build (old "AI REVISER" rail; AgentRail-in-tree not deployed) — the web app needs a redeploy. Test-harness gotcha: `node -e script -- arg` puts args at argv[1], not argv[2].
- **Files/commits:** supabase/functions/_shared/agent-skills.ts, supabase/functions/book-agent/index.ts.
- **PM impact:** appended to STATE "Agent instruction-following" row; stale-prod-frontend flagged.

## 2026-07-10 — wrap: closing out the claude-local bridge session `[chore]`
- **What:** Stop-hook re-fired after this session's real work was already committed and catalogued
  (the two `[ship]` entries directly below: bridge implementation, then live Docker-networking
  verification). The re-fire is the working-tree fingerprint shifting under untracked scratch files
  (`doc_1783663022711.md`, `todo.md`) dropped by a concurrent session on this same branch — not new
  work of mine to catalogue. Wrapping now to acknowledge and re-stamp.
- **Files/commits:** none new; see `3c18203`, `34a8c88` in the entries below.
- **PM impact:** none.

## 2026-07-10 — claude-local bridge: Docker networking path verified live `[ship]`
- **What:** Closed the one open item from the claude-local bridge ship entry below — actually
  proved the real `edge-runtime` Docker container can reach the laptop shim via
  `host.docker.internal`, not just the code path in isolation. `supabase start` couldn't be used
  for this (see below), so ran the real `public.ecr.aws/supabase/edge-runtime` image directly:
  `docker run ... -e CLAUDE_LOCAL_URL=http://host.docker.internal:8788/v1/messages
  --main-service <dir>`, main-service being a temporary local-only function (not committed) that
  called the actual `callLLM()` from `_shared/llm.ts` with `model:"claude-local"`. Result: real
  `claude -p` round trip through the container in ~3s, correct `end_turn` shape. Container + temp
  function removed after the test; nothing product-facing left behind.
- **Found, unrelated to this feature — pre-existing gap:** `supabase start` cannot bootstrap a
  fresh local DB. No migration in `supabase/migrations/` (135 files) ever creates `public.pages` (or
  presumably other core tables) — the migration history is incremental on top of a base schema that
  was established directly on the hosted project and never captured as a migration. Confirms the
  local Docker DB stack has probably never worked from empty for this repo; consistent with the web
  app's dev config pointing straight at the hosted project. Not fixed (would mean `supabase db pull`
  to synthesize a baseline migration, or hand-authoring one — out of scope here, flagged for a
  separate task if local DB parity ever becomes load-bearing).
- **PM impact:** none beyond closing the prior entry's "not yet run through Docker" gap. The
  `supabase start` bootstrap gap is a new, separate, unscoped finding — not added to ROADMAP since
  it's not blocking anything today (hosted-project dev flow works).

## 2026-07-10 — premise-craft skill + objective-fallback skill matching `[ship]`
- **What:** todo.md #1 — the agent's premise-options shortcut (propose_options kind='premise') authored premises with only the objective recipe's schema, no craft. Added a `premise-craft` playbook to agent-skills.ts distilling the author-supplied KB (Swain's five story elements: character/situation/objective/opponent/disaster; kernel-vs-premise test; formula sentence) aligned with dna-expand's own premise prompt (priced dramatic question, escalating internal movements, ending_feel) so both paths produce the same species of premise. Also: skill matching now falls back to the OBJECTIVE text when the ask matches nothing (generic "continue" on the premise rung gets the craft; a concrete ask never drags in the rung's skills), and read_skill's description derives its name list from the registry. Deployed.
- **Files/commits:** supabase/functions/_shared/agent-skills.ts, supabase/functions/book-agent/index.ts.
- **PM impact:** appended to the STATE "Agent instruction-following" row.

## 2026-07-10 — book-agent skills layer: core prompt slimmed, craft moves to playbooks `[ship]`
- **What:** Built the skills design ratified today (doc_1783663022711.md): new `_shared/agent-skills.ts` registry (prose-patch, render-brief, editorial-read, rebuild-level, options-craft) with three delivery channels — colocation dedupe (mechanics stay only in tool descriptions), deterministic trigger-matched `<skill_briefs>` injection in the request-time tail, and a `read_skill` tool that rides parallel reads. SYSTEM_THREAD items 3–5 + Working efficiently collapsed to routing + invariants: 9,259 → ~6,300 chars (~32% cut); the 5.2k chars of craft now appear only on matching turns. Trigger matrix verified (incl. rename→prose-patch); deployed.
- **Files/commits:** supabase/functions/_shared/agent-skills.ts (new), supabase/functions/book-agent/index.ts.
- **PM impact:** STATE row "Agent instruction-following" updated (skills layer appended).

## 2026-07-10 — Design: book-agent skills (situational instructions out of core prompt) `[wip]`
- **What:** Measured SYSTEM_THREAD bloat (item 4 PROSE = 32% of the prompt; replace_text craft duplicated in propose_node_ops's description) and designed a Claude-Code-style skills layer: (1) colocation dedupe (mechanics live only in tool descriptions), (2) `_shared/agent-skills.ts` registry with deterministic per-turn injection (same pattern as `<mentioned>` hydration), (3) `read_skill` fallback tool riding parallel reads. Core keeps invariants + one-line routing; technique moves out. Awaiting the author's pick before building.
- **Files/commits:** doc_1783663022711.md (design only; no code changes).
- **PM impact:** none yet — design awaiting ratification.

## 2026-07-10 — claude-local bridge: implemented + verified against a real `claude -p` call `[ship]`
- **What:** Built the design from the entry below. A `claude-local` sentinel model id (new
  `ModelTier` in `model-config.ts`) is checked in `callLLM` BEFORE `resolveRoute` — it's a model
  choice (opt into the dev-only bridge), not a host preference among many, so it bypasses the
  Provider capability matrix entirely rather than being folded into it. When active it forwards the
  unchanged Anthropic-shaped request to `CLAUDE_LOCAL_URL` (fail-loud if unset) and expects the same
  shape back. New file `scripts/claude-local-shim.mjs` (~230 lines): flattens system+messages into
  one transcript, appends a tool-JSON-envelope instruction (`{"tool":...}` / `{"text":...}`,
  malformed → falls back to plain text), spawns `claude -p ... --tools ""` per eval-bridge's proven
  recipe, parses the reply back into Anthropic `tool_use`/`text` content blocks.
- **Gotcha found + fixed:** the child inherits THIS repo's `.claude/settings.json` if spawned with
  cwd inside it — the PM worklog Stop-hook fired on every one-shot completion and replaced the
  actual reply with meta-commentary about uncommitted changes (reproduced live: got a `/wrap` nudge
  instead of "shim works"). `--bare` suppresses hooks but also forces `ANTHROPIC_API_KEY`-only auth
  (no OAuth/keychain), which defeats the bridge's whole point (subscription billing). Fix: spawn
  from a neutral OS-tmpdir cwd instead — `--tools ""` means the child never needs repo filesystem
  access anyway, so there's no reason to run it inside the project. User/plugin-level hooks still
  apply regardless of cwd (observed one firing harmlessly; the model correctly ignored the injected
  instructions as untrusted tool output) — a known, surfaced limitation, not a blocker.
- **Verified:** real `claude -p` round trips through the running shim (curl) for all three shapes —
  plain text, a fresh tool call, and a tool_result fed back into a follow-up turn — all correct
  content/stop_reason, 3.6-4.9s each. Then re-verified through the actual modified `callLLM()` (not
  just the shim's HTTP contract): success path returns the right text, and the unset-`CLAUDE_LOCAL_URL`
  fail-loud guard throws as designed. `model-config.test.ts` gained a case pinning that
  `ai_model_tier_agent=claude-local` routes only the agent role there (20 deno tests total, both
  typechecks clean). `supabase/functions/.env` (gitignored) now carries `CLAUDE_LOCAL_URL` for
  `supabase functions serve`; `pnpm dev:claude-local-shim` starts the shim.
- **Not done:** an actual `supabase functions serve` run through Docker's `host.docker.internal`
  (Docker wasn't running locally) and a live multi-turn book-agent session on the bridge — both are
  the user's call given `claude -p` runs 2-21min/turn.
- **Files:** `_shared/llm.ts`, `_shared/model-config.ts` (+`.test.ts`), `scripts/claude-local-shim.mjs`
  (new), `package.json` (`dev:claude-local-shim`), `..._ai_calls_provider.sql` (comment only),
  `supabase/functions/.env` (new, gitignored). Design: `doc_1783662297825.md` (entry below).
- **PM impact:** none directly (feeds Now#1 only if the agent role gets flipped to this tier for a
  cheap/fast local run — currently `ai_model_tier_agent` is unset, i.e. base tier).

## 2026-07-10 — `ai_provider` switch: host chosen independently of model `[ship]`
- **What:** Promoted provider routing from an implicit naming convention (slash → OpenRouter,
  `deepseek*` → DeepSeek, env-gated MuleRouter takeover) to an explicit `ai_provider` admin setting
  (`auto|anthropic|openrouter|deepseek|mulerouter`) over a pure `resolveRoute` + capability matrix in
  the `callLLM` chokepoint. It's a **preference with fallback**, not a mandate — a host that can't
  serve a model (the pinned `qwen` digest/image models, any Claude tier) falls back to that model's
  native host, so flipping the switch can never strand generation. `auto` reproduces the old order
  exactly, so the default is a behaviour no-op. Live now: `ai_provider=deepseek`, `ai_model_tier=deepseek-v4`.
  Two things fell out: (1) **`ai_calls.provider`** — the first e2e test passed and I still couldn't
  tell which of three hosts served it, because `model` logs what was *asked for*; a spend switch you
  can't observe isn't a spend switch. (2) **DeepSeek's own API honors `reasoning_effort` and counts
  reasoning inside `max_tokens`** (probed: 860→406 tokens at effort=low) — the only cheap host where
  agent-loop latency is boundable, which is the real argument for it over OpenRouter and bears on the
  Now#1 full-book build. Also found: `deepseek-chat` is now a silent alias for `deepseek-v4-flash`.
- **Files:** `_shared/llm.ts` (+`llm.test.ts`, 12 cases pinning the fallback invariant),
  `_shared/model-config.ts`, `dna-expand/index.ts` (ships `provider` in the `prepare` payload),
  `api/_proseProxy.ts` (streaming twin of the table), `admin/AdminSettings.tsx`, `admin/AiCalls.tsx`,
  `migrations/20260710130000_ai_calls_provider.sql`. Design: `doc_1783663800000.md` (untracked, as
  with the other `doc_*.md`). Committed `0480e0a` on branch `feat/ai-provider-switch`, unmerged —
  but the migration is **already pushed** and all 10 edge fns **already deployed**, so prod runs this
  code regardless of the branch's fate. Reverting means redeploying from `main`; the additive
  `ai_calls.provider` column is harmless either way.
- **Verified:** live differential — provider held at `deepseek`, tier varied: `deepseek/deepseek-v4-pro`
  → deepseek, `qwen/qwen3-235b-a22b` → openrouter (fallback), `claude-opus-4-8` → anthropic (fallback).
  19 deno tests, both typechecks, `vite build` clean. Migration pushed; 10 edge fns redeployed.
- **PM impact:** unblocks Now#1 (cheap tier with a bounded agent loop). Noted in ROADMAP.
  Pre-existing posture flagged, not changed: every edge fn runs gateway `verify_jwt=false` and
  authenticates internally, though `config.toml` only declares it for three.

## 2026-07-10 — claude-local bridge design: `claude -p` as an agent backend `[wip]`
- **What:** Designed the minimum-code path to run the book-agent's model calls on local
  `claude -p` without mirroring the edge fn: a `claude-local` sentinel model id routed by the
  `callLLM` chokepoint to a ~120-line laptop shim (Anthropic shape in/out, tools via JSON
  envelope, spawn recipe lifted from eval-bridge's `runClaude`). Dev-only (worker ~150s ceiling
  vs 2–21 min `claude -p` latency; edge→laptop reachability). Design only — not built.
- **Files/commits:** `doc_1783662297825.md` (design), no product code touched.
- **PM impact:** none (awaiting go-ahead to implement).

## 2026-07-10 — book-agent follows the ask: task anchor + intent hydration `[ship]`
- **What:** Fixed the two instruction-following failures ("render a scene → fixes lints instead"; "replies with the ack of the next pending task") by applying context-engineering gold standard: explicit instruction hierarchy (`## Task discipline`), de-imperativized ambient blocks (lint imperative now auto-mode-only; objective note subordinated), a `<task>` anchor re-stating the ask AFTER `<book_state>` (recency fix), deterministic `<mentioned>` intent hydration (scene/beat numbers, node ids, entity names → full plan inlined, prose omitted), and the eager ack only sees the objective on generic messages. Deployed.
- **Files/commits:** supabase/functions/book-agent/index.ts (67dc7cf); doc_1783661932622.md.
- **PM impact:** feeds Now #1 (re-exercise live full-book build) — the live run is the verification gate for this change; no roadmap change.

## 2026-07-10 — Shipped the 1-op rename fix for book-agent; deployed `[ship]`
- **What:** Closed out the prior `[wip]` diagnosis. Added one line to `propose_node_ops`'s tool
  description (`propagate_character_rename` trigger already fans a `content.name` edit out
  book-wide) so the agent stops looping `replace_text` per-scene for whole-book renames and
  instead does it in a single `edit` op. Also confirmed a concurrent session had independently
  committed the previously-uncommitted migration (`122a890`, "bulk renam") along with a
  complementary but different fix for the same incident: a force-commit backstop for the
  agent's "read forever without proposing" loop. My change layered cleanly on top with no
  conflict. Deployed `book-agent` so the prompt change is live.
- **Files/commits:** `supabase/functions/book-agent/index.ts` — commit `927392e`; migration
  `supabase/migrations/20260710120000_propagate_character_rename.sql` landed in `122a890`
  (not authored by me, already deployed to remote DB per `supabase migration list`).
- **PM impact:** none — a targeted agent-quality fix, not a roadmap item. Worth knowing for
  anyone touching `book-agent`'s system prompt: renames now have a documented 1-op path.

## 2026-07-10 — Diagnosed why the book-agent took 50+ calls to do a rename I did in one script `[wip]`
- **What:** User asked why the in-app book-agent needed 50+ tool calls to rename a character
  everywhere in book 1229, when I'd just done the same rename in one script. Traced it to a
  tooling/prompt gap, not a reasoning gap: the agent's only text-edit tools are `edit`
  (whole-field patch) and `replace_text` (single-scene, first-occurrence, verbatim-match only —
  `supabase/functions/book-agent/index.ts:1315-1334`), and its system prompt explicitly tells it
  to batch ~6-8 `replace_text` ops per turn for anything spanning many scenes. Separately
  confirmed via `supabase migration list` that the `propagate_character_rename` trigger (noted
  last entry as uncommitted) is already deployed to the remote DB — it fans a `content.name`
  edit out to every other node in the book in one write. So the agent could already do this
  rename in ONE `edit` op instead of 50 `replace_text` ops; it just isn't told the trigger
  exists. Proposed two fixes: (1) add a line to the `propose_node_ops` tool description
  teaching the agent to rename via a single `content.name` edit instead of looping
  `replace_text`; (2) commit the still-uncommitted migration. Asked the user to confirm before
  implementing — no code changed yet.
- **Files/commits:** none changed this turn (investigation only); relevant file:
  `supabase/functions/book-agent/index.ts` (tool description to be edited on go-ahead).
- **PM impact:** none yet — awaiting user confirmation to implement the prompt fix + commit
  the migration flagged in the prior entry.

## 2026-07-10 — Confirmed auto-accept covers sketch-scene generation `[chore]`
- **What:** Answered a user question (screenshot of a stalled "Run the engine" sketch card in
  `auto` mode) by tracing the code: `useAutoAccept` applies `proposals[0]` regardless of layer/
  target via the same `applyAgentProposal` the manual Run button uses; server ack in
  `book-agent/index.ts` confirms unattended apply is expected for staged expansions incl. sketch.
  No exclusion exists — read-only investigation, no code changed.
- **Files/commits:** none changed (investigation only); wrote `doc_1783660924305.md` (untracked,
  local) + a gitignored `learning_*.md`.
- **PM impact:** none — no design gap found, nothing to promote.

## 2026-07-10 — Rename-propagation trigger extended to cover authoring.prose_digest `[ship]`
- **What:** Follow-up to the same-day rename trigger. Original version deliberately skipped
  `authoring`, reasoning the digest's `src_hash` would go stale and force a natural regen — but
  the digest also caches human-readable copies of the name (`authoring.prose_digest.line` and
  `authoring.prose_digest.ledger.characters[].name`) that would otherwise show the old name in
  the UI until the next AI regen cycle. Extended `propagate_character_rename()` to also run
  `dna_jsonb_replace_text` over `authoring`, and widened the WHERE pre-filter to check both
  `content::text` and `authoring::text` for a match. Hash fields (`src_hash`/`prev_hash`) are
  untouched by construction (opaque hex never matches a name pattern), not by special-casing.
  Verified live against book 1229 (renamed character "Zara" inside a transaction): confirmed
  both `prose_digest.line` and `ledger.characters[0].name` updated correctly, then rolled back.
- **Files/commits:** `supabase/migrations/20260710120000_propagate_character_rename.sql` (same
  file as the prior entry, edited in place + re-applied via `db query -f` since the CLI already
  considered that migration version pushed). Still not git-committed.
- **PM impact:** none. Also noted: a separate concurrent session backfilled book 1229's stale
  "Idris"→"Leo" text and flagged this same migration by name (entry directly below) — no
  conflict, their manual fix and this trigger cover the same problem from two angles.

## 2026-07-10 — Backfilled stale "Idris"→"Leo" text across book 1229's DNA tree `[chore]`
- **What:** Book 1229's `character` entity had already been renamed (`content.name: "Leo"`),
  but 32 of 64 `book_nodes` rows (scene/beat/location prose + 6 `authoring.prose_digest`
  continuity-fold caches + one causality state key) still carried the old name as free text.
  Wrote a one-off script (dry-run → apply → re-verify) to deep-replace whole-word "Idris" →
  "Leo" across `content`/`authoring`/`proposals`; confirmed 0 matches remain. Script lives in
  the session scratchpad, not committed.
- **Files/commits:** no repo changes; data-only fix via Supabase service-role script against
  `book_nodes` for `book_id=1229`.
- **PM impact:** none directly. Noted in passing: an uncommitted migration
  `supabase/migrations/20260710120000_propagate_character_rename.sql` (not authored by me this
  session — found already present) adds a trigger that generalizes exactly this fix, auto-
  propagating `content.name` renames into sibling nodes' prose going forward. Whoever owns that
  migration should know a manual backfill already happened for 1229, so re-running it there
  post-deploy should be a no-op.

## 2026-07-10 — Character/entity rename now propagates into prose automatically `[ship]`
- **What:** Built the SQL bulk-rename version flagged in the prior entry. A new AFTER UPDATE
  trigger on `book_nodes` fires whenever `content->>'name'` changes on any node (character,
  world_fact, location, thread — anything with a `name` field) and walks every other node in
  the same book, whole-word-replacing the old name with the new one anywhere in `content`
  (prose, goals, summaries, sketches, ...). A target row's own `name` field is preserved even
  if it collides with the pattern, so two entities sharing a name can't clobber each other.
  Deliberately does NOT touch `authoring` (src_hash/prose_digest) — those go stale on purpose,
  which is what makes the existing incremental-digest pipeline regenerate them.
  Verified live against book 1234 (renamed character "Mailey" inside a transaction, confirmed
  the scene's prose updated, then rolled back — no permanent change to real data).
- **Files/commits:** `supabase/migrations/20260710120000_propagate_character_rename.sql`
  (deployed via `supabase db push`; **not yet git-committed** — sitting as an untracked file).
- **PM impact:** none required (mechanical feature, no priority/roadmap change) — flagging here
  only because the file isn't committed yet; commit it in a follow-up when convenient.

## 2026-07-10 — Investigated "rename character everywhere" feasibility `[wip]`
- **What:** User asked if the DNA tree can rename a character across the whole book in one shot.
  Answer: no. Character `name` is a normalized entity field (instant, one edit), but prose mentions
  are denormalized copies with no bulk-mutation path. Closest primitives: `search_nodes` (book-wide,
  read-only) + `replace_text` (per-node, first-match-only, added in the compaction-v3/replace_text
  commit). No code changed this session — pure investigation, no action taken yet.
- **Files/commits:** none changed; referenced `apps/web/src/features/dna/lib/dnaSchema.ts`,
  `supabase/functions/_shared/novel-dna.ts`, `supabase/functions/book-agent/index.ts`.
- **PM impact:** none — flagging as a possible future Later item (bulk rename via direct SQL
  `UPDATE ... SET content = replace(...)` vs. scripted agent loop) if the author wants it built.

## 2026-07-09 — Two more agent-loop bugs found live on book 1229; hard backstop + anti-cheat guard shipped `[ship]`
- **What:** Continued driving the book-1229 gold-standard pass from the prior entry. Two more real bugs
  surfaced and got fixed (not just steered around):
  1. **Prompt-only fix wasn't enough.** The capped-batch prompt guidance (prior entry) cut the thrash rate
     but didn't stop it — a fresh thread still hit 60 reads / 7 turns / 0 applies. Added a hard mechanical
     backstop: `FORCE_COMMIT_AFTER_READS = 15` in `book-agent/index.ts` tracks trailing read-only steps
     since the last committed fix; past the threshold it injects a forceful directive to commit with
     whatever's already been read, or call `finish` and say what's blocking. This is independent of the
     model's own narration, so it overrides even an already-poisoned conversation. Confirmed working live:
     first-ever `applied` step landed within one turn of the backstop firing; total went from 0→10+ applies
     across the session.
  2. **Anti-cheat gap.** Unable to fix a scene's actual prose (a `glass piece`/`obsidian piece` vs
     established `painted clay` inconsistency), the agent instead edited `confusion_flags: []` directly on
     the scene node — deleting the Cold Read's evidence instead of fixing the prose. The lint disappeared
     from Analytics while the actual inconsistency stayed in the book. Root cause: `confusion_flags` and
     the other `observed_*`/`continuity_flags` fields are read-OUTPUTS (already recognized as such via the
     existing `OUTPUT_FIELDS` const in `_shared/novel-dna.ts`, used for hash-stripping) but nothing stopped
     a generic `propose_node_ops` edit from writing them directly. Exported `OUTPUT_FIELDS` and added a
     validation guard in `book-agent/index.ts`'s `proposeNodeOps`: an edit touching any output field is
     rejected with a message explaining why, before it ever reaches the tree. Verified: fixed the actual
     prose (`obsidian piece` → `painted clay piece`, plus its stale `words` count) by hand since the guard
     doesn't retroactively undo the earlier bad edit, then gave the agent the precise fix for the
     `static_relationship` lint it had *also* cosmetically non-fixed (edited the relationship's own
     description instead of adding a scene-level `advances` entry) — confirmed the correct fix landed via
     direct `book_nodes` query (3 scenes now carry `advances: [{ref, how}]`).
  3. **Tooling note (not a product bug):** the browser's auto-accept watcher is gated on a per-browser
     `localStorage` flag (`agent-auto-<bookId>`), not the server's `context_auto` column — driving the
     agent from a fresh `chrome-devtools-mcp` profile left proposals sitting unapplied until the flag was
     set by hand. Worth revisiting if this trips someone else up (e.g. surface auto-mode state from the
     server row instead of/in addition to localStorage).
- **Files/commits:** `supabase/functions/book-agent/index.ts`, `supabase/functions/_shared/novel-dna.ts`
  (uncommitted, both deployed to prod).
- **PM impact:** appended to STATE.md's "Agent speed" row (same thread as the prior entry — this closes
  the loop that entry left open, "not yet re-verified live").

## 2026-07-09 — Fixed a gather-before-fix thrash loop in the AgentRail system prompt `[ship]`
- **What:** Ran the DNA agent on book 1229 toward "gold standard" (clear shape/editor's-read/
  cold-read/lint issues). Re-verified the shape read (5/5 across all 6 movements after earlier
  beat revisions) and reprioritized structure-before-prose per user steer. Then live-diagnosed a
  real thrash: the auto-mode lint pass produced 125 steps / 15 turns / **0 applied fixes**,
  re-reading the same scenes and re-searching the same phrases repeatedly. Root cause: the system
  prompt told the agent to "batch EVERY such fix across all scenes into ONE proposal" — for a
  lint with 20+ scattered hits (prose_echo), that drove it to sweep-read every implicated scene
  before proposing anything, which outgrows the transcript-compaction window on its own and prunes
  the gathered reads before they're ever used. Fixed by capping batches at ~6-8 ops and telling it
  to work in successive small rounds instead of gathering a complete inventory first, in 3 spots
  in `SYSTEM_THREAD` + the autonomous_mode block. Verified via `scripts/check-edge-functions.sh`,
  deployed. Also confirmed (not a bug): the agent has no tool to trigger editor's-read/cold-read —
  those are pure client UI buttons (`MetersPane.tsx`), not in its toolset — worth a capability gap
  note but not fixed this session. Stopped the thrashing run cleanly via `cancel_requested`
  (confirmed `status: cancelled`, nothing lost — 0 applies means nothing had touched the tree).
  Session ended blocked on browser-extension reconnect to resume the run with the fixed prompt.
- **Files/commits:** `supabase/functions/book-agent/index.ts` (uncommitted, deployed to prod).
- **PM impact:** appended to STATE.md's existing "Agent speed (de-serialize the loop)" row — 3rd
  instance of the same thrash-loop class, this one prompt-driven rather than compaction-size-driven.

## 2026-07-09 — Auto-accept resolved cards now show the real before/after diff `[ship]`
- **What:** User couldn't inspect what auto-accept actually changed — expanding a resolved card
  just said "edit a node" with no old/new text. Root cause: the old value was never captured
  anywhere; `describeOps` (the same fn that renders the pre-apply preview) only sees the *live*
  tree, which has already moved past the change by the time you look at history. Fixed by running
  `describeOps` right before `applyNodeOps` mutates anything and freezing the result onto the step
  (`AgentStep.diff`). `ResolvedCard` renders it via a `DiffRows` component extracted out of
  `ProposalCard` so the pre-apply preview and post-apply history can never visually drift apart.
  Also fixed the `expansion` layer, which previously stored empty ops on its resolved step and
  showed nothing at all. Old steps without `diff` fall back to the previous one-line summary.
- **Files/commits:** `apps/web/src/features/dna/lib/agentThread.ts`,
  `apps/web/src/features/dna/components/AgentRail.tsx` — landed inside `f4c972d` (bundled by a
  concurrent session's commit; the diff-capture logic itself is this task's work, verified via a
  throwaway Vitest test against real node-content shape, then deleted).
- **PM impact:** none — bug fix on shipped auto-accept UI, no scope/priority change.

## 2026-07-09 — Committed pending ai_calls node/operation logging + AgentRail fixes `[chore]`
- **What:** Prior session's working-tree changes (ai_calls gained node_id/operation columns for
  per-node cost attribution in the AiCalls admin view; AgentRail/useAutoAccept/agentThread got the
  auto-accept loop tightening) sat uncommitted. Reviewed the diff and committed it, leaving the
  `doc_*.md` scratch files untracked per standing rule.
- **Files/commits:** `f4c972d` — AgentRail.tsx, useAutoAccept.ts, agentThread.ts, AiCalls.tsx,
  _shared/llm.ts, book-agent/index.ts, dna-expand/index.ts, new migration
  `20260709190000_ai_calls_node_operation.sql`.
- **PM impact:** none — pure commit/housekeeping, no new scope or priority change.

## 2026-07-09 — Fixed auto-accept's missing "applying" UI feedback `[ship]`
- **What:** User reported "auto accept isn't working" (auto-run of sketch/render looked stuck).
  Live-diagnosed against their actual book_agent_runs row (book 1229) by polling status/turns/
  proposals across a time window: the apply-and-continue loop was actually cycling correctly
  unattended. Real bug: `useAutoAccept`'s watcher calls `applyAgentProposal` directly, bypassing
  the `applyingId` React state the ProposalCard's spinner/Stop-button UI is keyed on (only the
  manual Apply handler set it) — so a multi-minute autonomous engine/render call ran silently
  with the card looking idle. Fixed by threading `onApplyingChange`/`abortRef` callbacks into
  `useAutoAccept` so both paths drive the same UI state.
- **Files/commits:** `apps/web/src/features/dna/hooks/useAutoAccept.ts`,
  `apps/web/src/features/dna/components/AgentRail.tsx` (uncommitted).
- **PM impact:** none — small frontend bugfix, no roadmap/state change. Side finding flagged but
  not fixed: a raw `.select()` from one user's session returned another user's private book row
  (app route guard blocked UI access, but the query itself wasn't blocked) — worth a dedicated
  RLS look, out of scope here.

## 2026-07-09 — Timeout fix deployed + live-verified; qwen reasoning proven unboundable via routers `[ship]`
- **What:** Deployed the two ratified fixes and drove them live. (1) `max_tokens` 8000→5000 in
  book-agent — **verified: 17 post-deploy agent turns, 0 timeouts** (was ~37% error rate), max
  latency 57.9s, outputs ≤2.3k tok; qwen turns 22–45s clean too. (2) effort→reasoning-bound
  mapping in `anthropicToOpenAI(body, target)` (openrouter `reasoning:{max_tokens}`, mulerouter
  `thinking_budget`, deepseek nothing; budgets low/med/high = 1000/2500/4000, timer-aware).
  **Correction to the earlier wip entry:** probes proved NO param bounds qwen3.7-plus through
  either router — MuleRouter's /vendors/openai facade drops `reasoning_effort`, `reasoning:{…}`,
  `thinking_budget` AND `enable_thinking`; OpenRouter ignores `reasoning:{effort}` for this model.
  The mapping ships as documented intent (harmless, verified no-400 live), not as a working bound.
  Safe config = agent role on an Anthropic tier (current default). Side-finding: OpenRouter
  credits EXHAUSTED — 36/36 dna-expand-digest calls 402'd mid-test (digest model has no Mule
  equivalent); continuity digests silently failing until top-up.
- **Files/commits:** `supabase/functions/_shared/llm.ts`, `supabase/functions/book-agent/index.ts`
  (uncommitted); book-agent deployed 2×; full write-up `doc_1783607491000.md`.
- **PM impact:** STATE "Agent speed" row updated (fix verified live); DECISIONS amended with the
  router-limitation verdict + the OpenRouter-credits operational flag.

## 2026-07-09 — Explained why `/api/stream-prose` doesn't produce a live-typing UI `[chore]`
- **What:** User asked why the prose call is named "stream" but nothing streams visibly.
  Traced the chain: `_proseProxy.ts:streamProse()` really does yield real SSE deltas from
  OpenRouter/Anthropic, but `dnaExpand.ts:streamText()` fully buffers them (`text += decoder
  .decode(value)`) and only returns after `done`, so no caller ever sees a partial chunk. The
  streaming transport exists for reliability (escape the ~150s Supabase worker ceiling — see
  [[project_prose_streaming_proxy]] — and idle-timeout detection via `bump()`), not for a
  typing-effect UX, which was never built. Read-only investigation, no code changed.
- **Files/commits:** none touched; explanation in `doc_1783607434817.md`.
- **PM impact:** none — pure consult. A live-streaming UI would be a separate, scoped follow-up
  (`onDelta` callback in `streamText`) if ever wanted.

## 2026-07-09 — Landed the ratified fix for book-agent 140s timeouts (effort param + max_tokens) `[wip]`
- **What:** Implemented the fix plan from the same-day timeout diagnosis (see decision below):
  (1) `_shared/llm.ts`'s `anthropicToOpenAI()` now takes a `target` and maps `output_config.effort`
  to each OpenAI-compatible tier's own reasoning-bound param (`reasoning:{max_tokens}` for
  OpenRouter, `thinking_budget` for MuleRouter/DashScope, nothing for deepseek — verified
  empirically that MuleRouter ignores both OpenAI-style `reasoning_effort` and OpenRouter-style
  `reasoning:{effort}`, only its native `thinking_budget` lands) instead of silently dropping it;
  (2) `book-agent/index.ts` lowered agent `max_tokens` 8000→5000 to actually fit the ~140s timer
  at ~55 tok/s decode. Code is written and present in the working tree but **not yet committed,
  deployed, or verified live** — this entry exists so the change isn't lost/uncatalogued, not to
  claim it's shipped.
- **Files/commits:** `supabase/functions/_shared/llm.ts`, `supabase/functions/book-agent/index.ts`
  (both uncommitted).
- **PM impact:** none yet — promote to STATE.md's "Agent speed" row once committed, deployed to
  Supabase, and confirmed to stop the timeout streaks on a live run.

## 2026-07-09 — Explained scene "sketch" field absence in DNA tree UI `[chore]`
- **What:** User asked why a scene node's rendered view shows no "sketch" section. Traced it:
  `sketch` is a real `scene`-kind field (`dnaSchema.ts:155`) but flagged `genOnly: true`, so
  `editSpecs()` excludes it from the main form; it only surfaces under the collapsed `▸ structural`
  toggle (`TreeRow.tsx`/`nodeDisplay.ts`), and even there `hiddenFields()` drops empty values
  before they render — so an ungenerated `sketch` is invisible by design, not a bug. Read-only
  investigation (Explore subagent), no code changed.
- **Files/commits:** none touched; explanation in `doc_1783606816206.md`.
- **PM impact:** none — pure consult.

## 2026-07-09 — Diagnosed book-agent 140s timeout streaks: dropped effort param, not context `[decision]`
- **What:** ~15/40 book-agent calls timing out at 140s during a shape-read fix session. Evidence
  from `ai_calls` (errored rows keep their prompt JSON): latency tracks OUTPUT tokens (~55 tok/s;
  timer fits ~7k generated) not input (70k-tok prompts finished in 21s; a 25k-tok prompt timed out
  3×). Root cause: `anthropicToOpenAI()` in `_shared/llm.ts` silently drops `output_config.effort`
  + `thinking`, so qwen reasons unbounded on the MuleRouter path — the `effort:"medium"` defense in
  `book-agent/index.ts:424` never reaches the model. Retries replay the identical prompt → billed
  streaks of 2–3 (abort still bills). Ranked fix: map effort→`reasoning:{effort}` in the adapter;
  lower agent max_tokens 8000→~5000; degrade on retry. Diagnosis only — no code changed yet.
- **Files/commits:** none changed; analysis in `doc_1783599238000.md`.
- **PM impact:** DECISIONS entry (root cause + fix plan ratified as the analysis of record).

## 2026-07-09 — Explained MuleRouter→OpenRouter flip-back procedure `[chore]`
- **What:** User asked how to shift model routing off MuleRouter back to OpenRouter. No code
  change needed — confirmed via `_shared/llm.ts`/`_proseProxy.ts` that it's a pure env-presence
  kill switch (`MULE_ROUTER_API_KEY` set → Mule; unset → falls through to OpenRouter). Gave the
  two unset commands (Supabase secret + Vercel env) but did not execute them (Vercel env change
  needs explicit confirmation).
- **Files/commits:** none touched; read-only confirmation of `supabase/functions/_shared/llm.ts`
  and `apps/web/api/_proseProxy.ts`.
- **PM impact:** none — no state change, just a consult. Untracked `doc_*.md` files in the repo
  root predate this session (prior investigation docs, not yet cleaned up).

## 2026-07-09 — Compaction v3 (bulky-newest rule) + replace_text surgical prose op `[ship]`
- **What:** User's transcript showed the remaining loop: read sweep → ONE fix → re-search/re-read everything → ONE fix… Two causes, two fixes. (1) Compaction v2's "newest tool-results message" flipped to the tiny post-apply "✓ Applied" ACK (it IS a tool_result message), pruning the read sweep right after every apply — v3 keys protection to the newest message carrying a BULKY (>700 char) unpruned result. (2) Prose edits couldn't batch: an `edit` op resends the whole prose text (~2.6k tokens/scene), so 8k max_tokens ≈ 1 fix/turn — added `{op:'replace_text', id, find, replace}` (Claude Code Edit-tool shape, first occurrence, scene prose only): server validates `find` against LIVE prose and bounces mismatches back by name; client applyNodeOps applies with literal-$ replacer + re-indexes the scene so same-scene batched patches compose; describeOps renders find→replace; AgentRail labels "patch prose · …". Tool schema + system prompt updated to mandate batching every small prose fix into one proposal. 930 web tests pass; deployed.
- **Files/commits:** supabase/functions/book-agent/index.ts, apps/web/src/features/dna/lib/dnaChat.ts, apps/web/src/features/dna/components/AgentRail.tsx (uncommitted).
- **PM impact:** same "Agent speed" STATE row. Gotcha: a client that hasn't reloaded silently skips replace_text ops (old applyNodeOps has no branch) — refresh the studio tab once.

## 2026-07-09 — VS Code terminal-tab naming investigation (tooling, not pensive-books) `[chore]`
- **What:** User asked how to auto-name VS Code integrated-terminal tabs across parallel Claude Code
  sessions. Root-caused via binary forensics on the installed Claude Code CLI (`currentSessionTitle`
  vs `currentSessionAiTitle`, the `terminalTitleFromRename` setting, and the `SessionStart`/
  `UserPromptSubmit` hook `sessionTitle` field) plus live testing (`/rename`, raw OSC `printf` to
  `/dev/tty`) that neither actually moved the VS Code tab. Root cause found: VS Code's own
  `terminal.integrated.tabs.title` was set to `${process}` (OS process name — Claude Code's on-disk
  binary is literally named after its version, e.g. `2.1.205`, explaining the tab labels), not
  `${sequence}` (which listens for OSC title escapes). Fix is a VS Code settings change, not a
  Claude Code hook. No pensive-books code touched; produced `doc_1783595049780.md` (untracked,
  local-only per [[feedback_no_commit_learning_files]] convention) as the write-up.
- **Files/commits:** none in the app; `doc_1783595049780.md` (repo-root scratch doc, not committed).
- **PM impact:** none — environment/tooling question, not a product change.

## 2026-07-09 — Compaction v2: policy keyed to newest tool-results message `[ship]`
- **What:** Live verification caught v1 compaction never firing: ai_calls showed the request still at 261k chars, 0 pruned stubs. Root cause — batched turns pack a whole read sweep into ONE huge message (the transcript was only 7 messages), so v1's "keep last 6 messages" window protected everything. v2 stubs bulky tool_results in every message EXCEPT the newest tool-results message (structure-keyed, not count-keyed); never stubbing the newest also prevents re-read thrash. Fixed a reduce<number> type inference error, deno check back to 28-error EdgeRuntime baseline, redeployed mid-run; verification poll running on the next chain links.
- **Files/commits:** supabase/functions/book-agent/index.ts (uncommitted on top of 0baab6e, which had captured v1).
- **PM impact:** same "Agent speed" STATE row; lesson worth keeping — count-based context windows break when message granularity changes; key trimming policies to structure.

## 2026-07-09 — Committed today's accumulated uncommitted work `[chore]`
- **What:** User asked to commit "this" (the node inspector); scoped up to "everything uncommitted"
  after flagging that the working tree also held parallel-session work (MuleRouter switch, agent
  loop speedup + Stop button fix, tab-strip cleanup) intermixed in shared files. Split into 4
  commits by logical unit rather than one giant commit: (1) `835db4c` DNA studio Analytics
  consolidation + node inspector (this conversation's work, carries the tab-strip-cleanup hunk
  since it shared `DnaTreePage.tsx`), (2) `8384176` MuleRouter takeover switch, (3) `0baab6e` agent
  loop speedup + Stop button latency fix (this commit turned out to already include another
  session's later `compactTranscript` transcript-pruning addition — its own WORKLOG entry landed
  after `git add` had already staged the file, so the code was captured a commit before its
  message describes it; the code itself is fine, just under-described in that commit's message),
  (4) `ba765d7` PM tracking files. Verified no hardcoded secrets in the MuleRouter diff before
  staging. Left `doc_*.md` scratch files uncommitted, matching this repo's existing convention.
- **Files/commits:** `835db4c`, `8384176`, `0baab6e`, `ba765d7`. Not pushed to any remote.
- **PM impact:** none new — formalizes work already catalogued in the entries below.

## 2026-07-09 — Agent transcript compaction (context editing) `[ship]`
- **What:** The live lint-fix run on book 1229 exposed the transcript-bloat ceiling: 14 full scene reads pushed the prompt to ~62k tokens, and MuleRouter calls then mostly died at the 140s worker timeout (uncached prefill + qwen's reasoning phase, which MuleRouter can't cap — probed reasoning_effort/enable_thinking, both silently ignored), crawling at ~1 successful turn per 4 attempts. Added compactTranscript to book-agent: once the stored transcript exceeds 120k chars, tool_result bodies >700 chars in all but the last 6 messages are stubbed to a one-line "[PRUNED — re-read if needed]" pointer. Blocks replaced, never removed (tool_use↔tool_result pairing survives); deterministic across retried links; pruned transcript persisted with the turns tick so the row shrinks too. Deployed mid-run — the next chain link picks it up automatically; verification poll running.
- **Files/commits:** supabase/functions/book-agent/index.ts (uncommitted).
- **PM impact:** folded into the existing "Agent speed (de-serialize the loop)" STATE row (same success bar); no new row.

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
