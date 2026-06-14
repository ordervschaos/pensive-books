# Learning — Stream + Checkpoint + Prefill-Continue

Named concepts encountered while designing the doc.

- **Wall-clock limit** — the real elapsed-time budget a worker gets (vs CPU-time, which counts only
  active compute). Supabase free worker ≈150s wall-clock. The hard ceiling this whole pattern exists
  to escape.
- **Streaming (SSE / Server-Sent Events)** — server pushes a one-way sequence of `data:` frames over
  a held-open HTTP connection. Here: the model emits the completion token-by-token so we persist it
  as it arrives. Crucially does NOT extend wall-clock. (Current stack uses the **OpenAI/OpenRouter**
  SSE shape — line-delimited `data:` chunks ending in `data: [DONE]` — not Anthropic's
  blank-line-separated `event:`/`data:` pairs.)
- **Checkpointing** — periodically persisting in-progress state so a crash loses only the work since
  the last save. Here: flush accumulated tokens to the task row every ~2s.
- **Prefill (assistant-turn prefill / "putting words in the model's mouth")** — supplying the start
  of the assistant's response as the last message so the model *continues* from it instead of
  starting fresh. The mechanism that fakes "resume" across a fresh worker, since the API has no
  native resume. **Provider-specific on the OpenAI path:** first-class on Anthropic; on DeepSeek
  requires the beta endpoint + `prefix: true` ("Chat Prefix Completion"); on Qwen/OpenRouter it's
  model-dependent and not guaranteed — a plain trailing assistant message is spec'd as a *finished*
  turn, so a non-prefix model restarts/repeats instead of continuing.
- **Soft deadline** — a self-imposed cutoff (~130s) earlier than the hard kill (~150s), so you stop
  and hand off *gracefully* instead of being killed mid-token. Loses nothing vs a hard kill.
- **Self-chaining / continuation** — a job re-invokes itself for the next unit of work in a fresh
  worker with a fresh budget; N workers give N×150s. Their existing `reinvoke`/`isChainCall`.
  Normally one unit = one section; here one unit = "more tokens of the same completion."
- **Watchdog (pg_cron `revive_stalled_chains`)** — a scheduled job that restarts a chain whose link
  died before re-invoking. Backstop for an *ungraceful* worker death.
- **Idempotency** — an operation safe to run more than once with the same effect. Needed because the
  graceful handoff and the watchdog can both fire; guarded by `status='streaming'` checks.
- **Read-modify-write race** — two concurrent flushes each read the old buffer, append, and clobber
  each other. Avoided with an append-only DB op (`buffer = buffer || $1`).
- **`finish_reason` (OpenAI) / `stop_reason` (Anthropic)** — the field for *why* generation ended.
  OpenAI: `stop` (done) / `length` (truncated, continue) / `tool_calls`. `openAIToAnthropic()` maps
  these to `end_turn`/`max_tokens`/`tool_use`. The signal that drives the resume loop.
- **Anthropic↔OpenAI shape conversion** — the codebase builds every request in Anthropic shape, then
  `anthropicToOpenAI()` (tools, tool_use, tool_result, system) and `openAIToAnthropic()` translate to
  and from the OpenRouter/DeepSeek wire format. The streaming variant must convert the same way and
  parse the OpenAI SSE delta shape.
- **Context caching** — repeated-prefix input is billed cheaper. DeepSeek does this automatically;
  OpenRouter varies by model. Relevant because the growing prefill re-sends prior output as input
  each segment (O(n²) input) — part of why long resumes get costly even on cheap tiers.
- **Decompose-and-conquer (vs continuation)** — splitting a task into independently-completable
  pieces. The preferred alternative for *structured/JSON* output, where mid-object resume is fragile.
- **Fluid Compute (Vercel)** — function runtime with a 300s default timeout (configurable). The
  "raise the cap instead of working around it" escape hatch.
