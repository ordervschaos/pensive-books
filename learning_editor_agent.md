# Learning: Editor's Agent

## Concepts

- **Durable task / self-chaining edge function**
  - *What:* AI work split into small links: one Claude call per worker invocation; persist checkpoint; re-invoke for the next link.
  - *Here:* `revise-agent` runs one Claude call, saves `transcript` + `steps` + `turns` to `book_agent_runs`, then fires `EdgeRuntime.waitUntil(reinvoke(...))` to start the next link.

- **Transcript-as-checkpoint**
  - *What:* The entire Claude messages array is stored after every link so any fresh worker can resume the conversation exactly.
  - *Here:* `book_agent_runs.transcript` (jsonb) — persisted after every turn; `advance()` loads it, appends the new turn, saves it back.

- **Tool-use loop**
  - *What:* Model calls a tool → executor runs it → result appended as `tool_result` → model called again until a terminal tool fires.
  - *Here:* Tools are `read_page`, `ask_author`, `propose_revision_plan`, `finish`. `stop_reason: "tool_use"` means keep looping; `"end_turn"` or a terminal tool ends the chain.

- **Terminal tool pattern**
  - *What:* A tool whose execution ends the agent loop rather than producing a result to continue from.
  - *Here:* `propose_revision_plan` → writes `book_revisions` row, sets status `done`; `finish` → sets status `done` with a report. Neither re-chains.

- **Human-in-the-loop parking (ask_author)**
  - *What:* Agent pauses mid-loop, surfaces a question to the user, waits for the answer before continuing.
  - *Here:* `ask_author` sets status `awaiting_input` + `pending = { tool_use_id, question, options, preResults }`. The user answers via the `EditorAgent` UI → `POST { runId, answer }` → agent appends the answer as `tool_result` and re-chains.

- **preResults (sibling tool results)**
  - *What:* OpenAI-compatible APIs require a `tool_result` for every `tool_use` in a turn. When `ask_author` fires alongside `read_page` calls, the page results must be carried and re-injected when the answer arrives.
  - *Here:* `pending.preResults` stores the `read_page` results from the same turn; `resume-from-answer` injects them before the user's `ask_author` result so the transcript stays valid.

- **Request-time cache breakpoints**
  - *What:* Anthropic's prompt cache allows up to 4 `cache_control` markers per request. Storing them in the transcript would permanently burn slots; adding them at build-time means each request gets fresh markers.
  - *Here:* `buildRequest()` in `revise-agent` adds `cache_control` to the system prompt and first-turn messages on every call, but does not persist those markers into `transcript`.

- **OpenAI ↔ Anthropic adapter (protocol translation)**
  - *What:* Two API "dialects" for the same concept (tool calling). An adapter translates between them so the same agent code works across providers.
  - *Here:* `anthropicToOpenAI()` in `_shared/claude.ts` converts Anthropic tool defs → OpenAI `functions`, `tool_use` blocks → `tool_calls`, `tool_result` blocks → `role:"tool"` messages. `openAIToAnthropic()` reverses it. DeepSeek and Qwen/MuleRouter both speak OpenAI format.

- **effort parameter (extended thinking budget)**
  - *What:* Controls how much reasoning/thinking Claude does per turn. `high` = deep thinking; `medium` = moderate; trades token cost for latency.
  - *Here:* Default `high` caused 120s+ turns on Sonnet, billing the call even after client-side abort. Switched to `effort: "medium"` per turn to stay well under the 140s abort and 150s worker cap.

- **pg_cron watchdog**
  - *What:* A scheduled database job that finds rows stuck in a "running" state and re-kicks them.
  - *Here:* `revive_stalled_chains()` (extended in `20260612150000_book_agent_runs.sql`) finds `book_agent_runs` rows in `running` status older than 5 min and reinvokes `revise-agent`. Rows in `awaiting_input` are explicitly skipped.

- **Turn budget guard**
  - *What:* Increment a counter before each AI call; abort if over limit. Pre-incrementing means a crashed worker mid-call still consumes budget.
  - *Here:* `turns` incremented before the Claude call; `MAX_TURNS = 20`; guard fires at the top of `advance()`.

- **Sanitize plan (guardrails at propose-time)**
  - *What:* Validate and normalize an AI-generated plan against ground truth before committing it.
  - *Here:* `sanitizePlan()` in `_shared/revision-plan.ts` fetches fresh pages at propose-time (not run-start), enforces real page IDs, ensures every existing page is carried or deleted, deduplicates refs.

- **Realtime subscription (useLatestTaskRow)**
  - *What:* Client subscribes to DB row changes so UI updates live without polling.
  - *Here:* `EditorAgent.tsx` uses `useLatestTaskRow<AgentRow>` on `book_agent_runs` — the panel reflects status, steps, and `pending` question in real time as the agent chain advances.
