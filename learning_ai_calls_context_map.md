# Learning: AI Calls & Context Map

Concepts encountered while mapping all AI function calls and context assembly patterns in pensive-books.

---

- **chokepoint** (single point of passage): one module/function that every call of a type must pass through; enables uniform logging, routing, and format conversion. Showed up as `_shared/claude.ts` — every LLM text call goes through `callClaude()`, none bypass it.

- **prompt caching** (ephemeral cache): the model provider caches a portion of the prompt (marked with `cache_control: { type: "ephemeral" }`) and re-uses it across calls; you only pay tokens for the new/changed part. Showed up in `generate-unit-core` where `stablePrefix` (brief + outline + voice sample) is marked cacheable and `variablePart` (preceding prose, character states) is not.

- **stable prefix / variable part** (prompt decomposition): splitting a prompt into a high-reuse cached section and a per-call changing section. Showed up in prose generation — the stable prefix caches the book-level context, the variable part changes per page.

- **map-reduce** (parallel then synthesize): split a large task into N independent workers (map), then combine results in one final call (reduce). Showed up in `evaluate-core`: triage → 3 parallel group evaluations → 1 verdict call.

- **LLM-as-judge** (evaluation pattern): a second model call scores the output of the first. Showed up in `pickBestBeat` — samples N beats in parallel, then calls the same model to pick the best one (returns only a digit).

- **best-of-N sampling**: generate N independent candidates with high temperature, let a judge or the user pick the best. Showed up in `objectiveToBeat` with `candidates > 1`.

- **durable task / self-chaining** (actor pattern): a long-running job is broken into short worker invocations; each invocation does one step and re-invokes itself, persisting state to a DB row between links. Showed up in `revise-agent` — each Claude call is one "link", state lives in `book_agent_runs.transcript`.

- **tool use / function calling**: the model can request to call a predefined function mid-turn; the caller executes it and returns the result, allowing multi-step agentic behavior. Showed up in `revise-agent` with `read_page`, `ask_author`, `propose_revision_plan`, `finish`.

- **cache breakpoints** (prompt engineering): placing `cache_control` on specific message positions to maximize cache hits across a multi-turn conversation. Showed up in `revise-agent`'s `withCacheBreakpoints()` — marks the first message and the latest message for caching so only new turns are re-tokenized.

- **character ledger** (continuity tracking): a running JSON snapshot of every character's known/felt/held/believed state, updated after each page and injected into the next page's prompt. Showed up in `generate-unit-core` as `pages.metadata.character_states`.

- **open loops / thread tracking** (narrative continuity): a per-page instruction telling the prose renderer which story threads to SEED, PAY OFF, or WITHHOLD. Showed up in `buildOpenLoops()` using `book_threads` anchors.

- **model tier routing** (admin configuration): a single admin setting (`admin_settings.ai_model_tier`) that maps to high/low model strings consumed by all generation calls. Showed up in `model-config.ts` — callers call `getActiveModels()` rather than hardcoding model strings.

- **provider format conversion** (adapter pattern): converting Anthropic-format request bodies (tools, tool_use, tool_result, cache_control) to OpenAI format on the fly for non-Anthropic providers. Showed up in `anthropicToOpenAI()` and `openAIToAnthropic()` in `claude.ts`.

- **steer block** (author guidance injection): a per-step free-text field the author fills once; it's appended verbatim to every prompt for that step. Showed up in `_shared/steer.ts` — `steerBlock()` wraps the author's text in a labeled prompt section, read by foundations/spine/beats/prose cores.

- **pin enforcement** (hard constraint): pinned items (tentpoles, cast fields) are injected into prompts as "immutable, honor verbatim" constraints, and for routes there's post-generation validation with a retry on violation. Showed up in `foundations-core.ts` — `settledContext()` labels pinned items and `spineRoutes` validates the output.

- **canon packet** (sequel constraint): a one-time read-only data packet from the prior book (unresolved threads, character end-states, parent title) injected into sequel generation to prevent contradiction or retelling. Showed up in `canonContext()` used by foundations, beats, and prose cores.

- **face coherence via reference images**: passing portrait images as input to an image model so it renders the same character face across different scenes. Showed up in `generate-scene-image` — it fetches `foundations.cast[].portraits` and passes them as `refImages` to Gemini.

- **ai_calls log** (observability): every Claude call writes a row to `ai_calls` with the full prompt, output, tokens, and latency — visible in `/admin`. Showed up as the core behavior of `callClaude()` in `_shared/claude.ts`.

- **waitUntil** (edge function background execution): lets an edge function respond immediately while continuing async work after the response. Showed up in `generate-voice` and other durable task starters — `runInBackground` / `EdgeRuntime.waitUntil` decouples the HTTP response from the model call.

---

## Cleanup session (2026-06-15)

- **dead code elimination**: removing code paths that can never execute. The `chat-with-book` hook had its API call commented out ("stopped as per user request"); the whole feature was live in the UI but mocked.

- **blast radius analysis**: before deleting, tracing every reference to a symbol to find the full scope. `use-book-chat.ts` → `BookChatPanel` → `BookChatMessage` → `BookDetails` (state, metadata fn, apply fn) → `PagesList` (dropdown item) → `types.ts` (props) → `App.tsx` (route + lazy import).

- **feature flag** (`isBetaEnabled`): `localStorage.getItem('is_beta') === 'true'` gated the "Chat with Book" button; removed along with the feature since no other use remained in those components.

- **old flow / new flow** (build rail): `BUILD_STEPS` (old) includes a `voice` step; `NEW_BUILD_STEPS` absorbs voice into foundations sub-step 5. Functions like `generate-voice`, `brief-to-spine`, `spine-options` remain live — old-rail books exist wherever `books.foundations` is null.

- **chokepoint violation as legacy signal**: `chat-with-book` called DeepSeek directly instead of going through `_shared/claude.ts`; it also skipped `ai_calls` logging. Both facts confirmed it was off the main design and safe to delete.

**Deleted:** `chat-with-book/` (edge fn), `use-book-chat.ts`, `BookChatPage.tsx`, `BookChatPanel.tsx`, `BookChatMessage.tsx`, `book-operations.ts`

---

## Old-flow removal (2026-06-15)

- **old rail vs new rail** — `books.foundations = null` = old build order; non-null = new. Old rail had a separate "voice" step, single-shot `brief-to-spine`, and 3-alternative `spine-options`. New rail absorbs voice into Foundations sub-step 5 and uses `spine_routes` (3 route candidates from tentpoles).

- **`newFlow = true` collapse** — once backward compatibility is dropped, `newFlow` is a constant. `BUILD_STEPS` can become the single ladder. The old `BUILD_STEPS`/`NEW_BUILD_STEPS` split was purely a runtime branch guarded by `input.foundations != null`.

- **prop chain deletion** — `onVoiceStatus` threaded from `BuildStudio → StudioStage → FoundationsStep` existed only to update `hasVoice` in the studio model, which gated `ready.voice` for the old "voice" step. Removing the step collapsed the whole chain.

- **`DurableOptions` (kind: "spine_options")** — old flow used this to present 3 alternative spine drafts inline. New flow presents 3 route cards directly from `spine_routes`. Removing `spine_options` from ai-run and the `DurableOptions` call in SpineStep eliminated both the handler and the UI.

**Deleted:** `brief-to-spine/`, `spine-options/`, `generate-voice/`, `objectives-to-spine/` (edge fns), `_shared/spine-core.ts`, `JourneyStudio.tsx`, `BookJourney.tsx`, `SpineGenerator.tsx`, `VoiceGenerator.tsx`, `BookSpine.tsx`, `VoiceStep.tsx`
