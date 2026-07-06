# TODO — DNA generation: thin streaming proxy (browser-driven model calls)

The **Light** browser-orchestration fix is shipped (`apps/web/src/lib/dnaExpand.ts` → `callExpand`):
per-call ~120s timeout + retry owned by the browser loop, plus surfacing the real `error.context`. This
is the **Full** follow-up — only build it if live progress is wanted, or if hangs still bite after retry.

## Why this exists (the diagnosis)

`write all prose` / scene gen intermittently failed with the opaque *"Edge Function returned a non-2xx
status code."* Root cause, confirmed from `ai_calls` (2026-06-29):

- Active model `qwen/qwen3.7-plus` answers in **~82s p50 / 108s p90 / 140s max** when it succeeds.
- Failures are **hung** calls running **650–880s** (11–15 min) — 27 of the last 30 timeouts, all this model.
- The Supabase worker is killed at its **~150s wall-clock** before the hung call returns → the dropped
  connection surfaces as a contentless non-2xx; a pg_cron watchdog later stamps the row
  *"timed out — worker exited before logging a result."*

So the bottleneck is **the worker, not the model**. Light sidesteps it (abort@120s → retry draws a fast
call). Full **removes the worker from the long path entirely**.

## What Full is

Move the long-lived connection from `browser ↔ worker ↔ model` to `browser ↔ proxy ↔ model`, where the
proxy does ~0 work — it just pipes OpenRouter's SSE straight back. The browser owns the orchestration
(timeout / retry / abort — the same layer Light already added) and shows token-by-token progress.

```
Browser ──SSE──▶ thin proxy (holds key) ──▶ OpenRouter/Qwen
  ├─ live token progress (write-all-prose shows the scene streaming)
  ├─ browser-owned timeout / retry / abort  ← reuse callExpand's logic
  └─ persist on done (expandNode → saveNode, unchanged)
```

## The load-bearing constraint

**The OpenRouter key can NOT go to the browser.** There is always a server hop. The only question is
*what* the hop is — and it must NOT be a Supabase edge function, because Supabase's ~150s worker ceiling
is exactly what we're escaping.

- **Recommended host: Vercel** (we're already on it). Fluid Compute = full Node, **300s default timeout**,
  streaming-friendly. Or **Vercel AI Gateway** — unified provider API with key handling, model failover,
  and observability built in; the proxy could be ~nothing if the Gateway fronts OpenRouter directly.
- Proxy job: accept `{ system, ctx, model, max_tokens }`, open OpenRouter with `stream: true`, pipe SSE
  back unbuffered. No DB, no per-token CPU → wall-clock is bounded by the stream, and the browser aborts
  a stall long before any host ceiling anyway.

## Open (decide at build time)

- **Context assembly** — `dna-expand` currently builds the prompt server-side (needs DB + the cheap
  `low`-model `buildProseDigest` call). Either (a) keep a fast `dna-expand?mode=prepare` that returns the
  assembled `{ system, ctx, model, max_tokens }` and have the browser stream the heavy generation from the
  proxy, or (b) move digest assembly client-side too. (a) is less churn; the digest is the only slowish
  server step and it's on the cheap model.
- **Proxy: bespoke Vercel function vs AI Gateway.** Gateway gives failover + observability for ~free but
  is a new dependency; a hand-rolled Fluid Compute route is ~30 lines and no new product. Lean Gateway if
  we also want provider failover (a second, non-qwen fallback would itself kill most of these hangs).
- **Streaming parse** — OpenRouter SSE is OpenAI-shaped (`anthropicToOpenAI`/`openAIToAnthropic` already
  exist in `_shared/claude.ts`); the browser needs a client-side SSE delta accumulator. Mirror the shape,
  don't reinvent.
- **ai_calls logging** — today every call logs via `_shared/claude.ts`. A browser-streamed call bypasses
  that chokepoint; decide whether the proxy logs (preferred — keeps [[project_ai_call_logging]] intact) or
  the browser posts a completion record.

## Reuse

- `apps/web/src/lib/dnaExpand.ts` `callExpand` — the browser timeout/retry/abort layer is **already built**
  (Light). Full swaps the per-call *transport* (invoke → SSE stream) underneath the same orchestration; the
  retry/abort/`readInvokeError` logic carries over. Light is not throwaway.
- `DnaTreePage` write-all loop + `abortRef` — the existing per-scene driver; add a progress sink.
- `_shared/claude.ts` `anthropicToOpenAI` / `openAIToAnthropic` — the request/response shape conversion.
- **Dev bridge** (`scripts/eval-bridge.mjs`) already runs the browser-orchestrated model call locally; the
  streaming proxy is its prod analogue. Per [[project_dev_bridge_mirror]], keep the two in step.

## Related

Memory: project_model_stack_openrouter (qwen/deepseek tier, OpenAI-SSE shape, prefill quirks),
project_ai_call_logging (the logging chokepoint this must preserve), project_durable_ai_tasks,
project_dev_bridge_mirror, reference_opus_effort_param (the ~150s worker ceiling, documented).
Vercel: Fluid Compute (300s, streaming), Vercel AI Gateway (provider failover + observability).
