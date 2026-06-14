# Stream + Checkpoint + Prefill-Continue

*How to make a single long generation outlive the ~150s Supabase edge worker cap by streaming
tokens, checkpointing them to the task row, and resuming a dead call via assistant prefill.*

> Status: design doc, not yet implemented. The reference target is `revise-outline`, but the
> mechanism is generic to any one-big-call generation.

> ⚠️ **CURRENT STACK: Qwen + DeepSeek via OpenRouter (no Anthropic API).** `getActiveModels()` tiers
> are `deepseek` (`deepseek-chat`) and `qwen` (`qwen/qwen3-235b-a22b`). Every call is built in
> Anthropic shape, converted by `anthropicToOpenAI()` in `_shared/claude.ts`, sent to OpenRouter /
> DeepSeek, and converted back by `openAIToAnthropic()`. Two consequences run through this whole doc:
>
> 1. **Streaming uses the OpenAI/OpenRouter SSE shape** (`choices[].delta.content`, `finish_reason`,
>    a terminal `data: [DONE]`), not Anthropic events. See §4.
> 2. **Prefill-continuation is provider-specific and not uniformly supported** on this path — it is
>    the load-bearing trick of this pattern and it is the weakest link here. See §5b. This pushes the
>    recommendation hard toward **decompose-and-chain** (§7).
>
> **Also note:** Qwen/DeepSeek are far faster and cheaper than Opus. The 16k-token call that blew
> past 150s on `claude-opus-4-8` may simply *fit* under the cap on `deepseek-chat`. Measure that
> first — the cheapest fix to a wall-clock problem is often "the call is no longer slow."

---

## 0. Where this sits

- **Subcontext:** the durable-AI-task rail (`_shared/task.ts`, `_shared/self-chain.ts`, the
  `revive_stalled_chains()` watchdog). This is a *new execution model* alongside the two you have:
  single-shot `waitUntil` and decompose-and-self-chain.
- **Position:** it's the **self-chain pattern applied to ONE Claude call** instead of to N
  independent units. The unit of progress is "more tokens of the same completion," not "the next
  page/section."
- **One-line summary:** stream the completion, write the partial to the row as it arrives, and when
  the worker is about to die, re-invoke yourself with the partial fed back as a *prefilled assistant
  turn* so Claude continues where it stopped.

## 1. Why this exists / what it buys you

- A single Claude call can genuinely need >150s (Opus, 16k output, adaptive thinking). You cannot
  make one worker live longer on the free plan, and the Anthropic API has **no "resume from token
  N"** — if the worker dies, that completion is gone.
- **Decompose + self-chain** (the `generate-book` recipe) is the *preferred* answer when the task is
  divisible. Use it whenever you can.
- **This pattern is for when the task is NOT cleanly divisible** — you want one coherent completion
  with full context in a single reasoning pass, but it doesn't fit in one worker's wall clock.
- What you couldn't do without it: run an indivisible >150s generation on the free plan at all
  (today it 499s and reads as a UI hang).

> ⚠️ **JSON caveat up front.** Resuming works cleanly for *prose* (continue mid-sentence). For
> *structured JSON* (which `revise-outline` produces) it is fragile — you resume mid-object and must
> trust the model to continue valid JSON. If your output is JSON, **decompose instead** (see §7).
> This doc documents the mechanism honestly, including where it bites.

## 2. The system — stakeholders & parts

| Part | Role |
| --- | --- |
| **Task row** (`book_revisions` / `book_generations`) | Holds the accumulating partial in a buffer column, the message history needed to resume, and `status` (`streaming` → terminal). The single source of truth. |
| **Edge function** | One worker = one streaming segment. Streams, flushes partial to the row, gracefully checkpoints near its soft deadline, re-invokes itself. |
| **`callClaudeStream` (NEW)** | A streaming sibling of `callClaude` in `_shared/claude.ts`. Reuses `anthropicToOpenAI()` + provider branching, parses OpenAI/OpenRouter SSE, yields text deltas, reports a normalized stop reason, still logs to `ai_calls`. |
| **`reinvoke` / `isChainCall`** | Unchanged. Carries the service bearer + `CHAIN_SECRET` so a continue call skips user auth and operates on the row id. |
| **Watchdog** `revive_stalled_chains()` | Safety net for an *ungraceful* death (worker killed before it could checkpoint). Restarts a stalled `streaming` row from its last flush. |
| **Client** (`useLatestTaskRow`) | Renders from the row. Sees the partial grow over Realtime — the stream *is* the progress bar. Refresh-safe. |

## 3. The picture

```
 SEGMENT 1 (worker A, budget ~150s)
   build request: system + messages
   stream ▒▒▒▒▒▒▒▒░░░░░░  ──flush every ~2s──▶ row.buffer += deltas   (client watches it grow)
   soft deadline @ ~130s reached, stop_reason still null (not done)
     persist: row.buffer, row.messages, status='streaming'
     EdgeRuntime.waitUntil(reinvoke(self, { id, chain:true }))   ◀── graceful handoff
   worker A exits cleanly

 SEGMENT 2 (worker B, fresh budget)   [isChainCall === true]
   load row → buffer, messages
   build request: SAME system + messages + { role:'assistant', content: buffer }   ◀── PREFILL
   stream ░░░░░░▒▒▒▒▒▒▒▒  ──flush──▶ row.buffer += deltas
   stop_reason === 'end_turn'  ──▶ done
     finalize: parse(buffer), status='ready'/'awaiting_review', result=plan

 ── UNGRACEFUL DEATH (worker killed @150s before checkpoint) ──
   row stuck at status='streaming', updated_at stale
   watchdog (5-min threshold) ─▶ reinvoke(self,{id,chain:true}) ─▶ resumes from last flush
     (cost: the unflushed tail since the last ~2s flush is lost; prefill re-continues from there)
```

Key idea: **two safety layers.** The *soft deadline* (graceful checkpoint at ~130s) is the normal
path and loses nothing. The *watchdog* is the backstop for a hard kill and loses at most one
flush-interval of tail tokens.

## 4. The OpenAI / OpenRouter streaming contract (what you're parsing)

Set `stream: true` on the OpenAI-shape body (the one `anthropicToOpenAI()` produces). The response is
Server-Sent Events, one JSON chunk per `data:` line:

```
data: {"choices":[{"delta":{"content":"Once"},"finish_reason":null}]}
data: {"choices":[{"delta":{"content":" upon"},"finish_reason":null}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

What you read off each chunk:
- `choices[0].delta.content` → text fragment (append this). May be absent on role-only or
  finish-only chunks.
- `choices[0].delta.tool_calls[]` → streamed function-call args (the `.function.arguments` arrives in
  pieces); only relevant if you stream tool-using calls.
- `choices[0].finish_reason` → **why it stopped** (null until the final content chunk):
  - `"stop"` → finished. **Finalize.** (maps to Anthropic `end_turn`)
  - `"length"` → truncated by `max_tokens`. Continue via prefill. (maps to `max_tokens`)
  - `"tool_calls"` → wants a tool. (maps to `tool_use`)
- `data: [DONE]` → end of stream sentinel (not JSON — string-match it).
- Usage may arrive on a final chunk only if you set `stream_options: { include_usage: true }`
  (OpenRouter/OpenAI). Otherwise you won't get token counts from the stream — log an estimate or skip.

Involuntary cut: a stream that just stops (connection drop / worker death) with **no
`finish_reason` and no `[DONE]`** → treat as an involuntary cut; resume from the last flushed buffer.
Distinguishing "done" from "cut" therefore hinges on whether you saw `finish_reason: "stop"` /
`[DONE]` before the reader closed.

## 5. Implementation sketch

### 5a. `callClaudeStream` in `_shared/claude.ts`

A streaming sibling that preserves the `ai_calls` logging chokepoint and reuses the **same provider
branching + `anthropicToOpenAI()` conversion** as `callClaude`. It takes the Anthropic-shape body
(so callers don't change), converts, opens the OpenAI-shape SSE stream, drives a callback per delta,
and resolves with the normalized stop reason + accumulated text.

```ts
// _shared/claude.ts  (NEW — sketch)
export async function callClaudeStream(
  apiKey: string,
  body: Record<string, unknown>,            // Anthropic shape, as everywhere else
  meta: CallMeta,
  onDelta: (text: string) => void,          // called per content fragment
  opts?: { signal?: AbortSignal },
): Promise<{ text: string; stopReason: "end_turn" | "max_tokens" | "tool_use" | null }> {
  const logId = await logStart({ ...body, stream: true }, meta);
  if (logId != null) meta.loggedCallId = logId;
  const started = Date.now();

  const model = (body.model as string) ?? "";
  const isDeepSeek = model.startsWith("deepseek");
  const isQwen = model.startsWith("qwen");
  // Active tiers are OpenAI-shape. (Keep an Anthropic-SSE branch only if you re-add a Claude tier.)
  const oaBody = { ...anthropicToOpenAI(body), stream: true, stream_options: { include_usage: true } };
  const { url, key } = isDeepSeek
    ? { url: DEEPSEEK_URL, key: Deno.env.get("DEEPSEEK_API_KEY") ?? apiKey }
    : { url: OPENROUTER_URL, key: Deno.env.get("OPENROUTER_API_KEY") ?? apiKey }; // Qwen + default

  let acc = "";
  let finish: string | null = null;
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  let errMsg: string | null = null;
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: opts?.signal,
      headers: { "Authorization": `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(oaBody),
    });
    if (!res.ok || !res.body) throw new Error(`stream API ${res.status}: ${(await res.text()).slice(0,500)}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = "";
    outer: for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = sseBuf.indexOf("\n")) !== -1) {            // OpenAI SSE: one `data:` per line
        const line = sseBuf.slice(0, nl).trim(); sseBuf = sseBuf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") break outer;
        const chunk = JSON.parse(payload);
        const ch = chunk.choices?.[0];
        const piece = ch?.delta?.content ?? "";
        if (piece) { acc += piece; onDelta(piece); }
        if (ch?.finish_reason) finish = ch.finish_reason;     // "stop" | "length" | "tool_calls"
        if (chunk.usage) usage = chunk.usage;                 // only with include_usage
      }
    }
  } catch (e) {
    errMsg = String((e as Error)?.message ?? e);
  }

  const stopReason = finish === "length" ? "max_tokens"
                   : finish === "tool_calls" ? "tool_use"
                   : finish === "stop" ? "end_turn" : null;   // null = involuntary cut
  await logEnd(logId, { ...body, stream: true },
    { content: [{ type: "text", text: acc }], stop_reason: stopReason,
      usage: { input_tokens: usage?.prompt_tokens ?? null, output_tokens: usage?.completion_tokens ?? null } },
    meta, Date.now() - started, errMsg);
  if (errMsg) throw new Error(errMsg);
  return { text: acc, stopReason };
}
```

Notes:
- The OpenAI SSE frame is **line-delimited** (`data:` per line, not Anthropic's blank-line-separated
  `event:`/`data:` pairs) — hence the `\n` split, not `\n\n`.
- `stopReason: null` means the reader closed without `finish_reason`/`[DONE]` → an involuntary cut →
  resume.
- The `ai_calls` log gets one row per *segment*. Aggregate by `taskId` in /admin; don't try to make
  one log row span workers.

### 5b. The function: stream, checkpoint, resume

Add a `streamed` column set on the task row: a `buffer text` (accumulated output) and `messages
jsonb` (the resume context). Reuse the existing status column.

```ts
const SOFT_DEADLINE_MS = 130_000;        // checkpoint before the ~150s hard kill
const FLUSH_EVERY_MS   = 2_000;          // bound tail-loss on ungraceful death

Deno.serve(async (req) => {
  const chain = isChainCall(req);
  const { bookId, id, evaluation } = await req.json();
  const service = serviceClient();

  // KICKOFF (user call): auth + access check + insert the row, then start segment 1.
  // CONTINUE (chain call): skip auth, load the row by id.
  let row;
  if (!chain) {
    /* getUser, user_can_edit_book, insert book_revisions {status:'streaming', buffer:'', messages:[...]} */
  } else {
    row = (await service.from("book_revisions").select("*").eq("id", id).single()).data;
    if (!row || row.status !== "streaming") return json({ ok: true }); // already terminal/cancelled
  }

  const runOneSegment = async () => {
    // Build the request. On a continue, append the accumulated buffer as a PREFILLED assistant turn.
    // ⚠️ PROVIDER-SPECIFIC — see §5b-note. DeepSeek needs `prefix:true` + the /beta endpoint;
    // OpenRouter/Qwen continuation is model-dependent and must be verified per model.
    const messages = [...row.messages];
    if (row.buffer) messages.push({ role: "assistant", content: row.buffer /*, prefix: true for DeepSeek beta */ });

    const segmentStart = Date.now();
    let pending = "";
    let lastFlush = Date.now();
    const flush = async () => {
      if (!pending) return;
      // append-only: never lose what earlier segments wrote
      await service.rpc("append_buffer", { p_table: "book_revisions", p_id: row.id, p_text: pending });
      // (or: select buffer, concat, update — rpc avoids a read race across concurrent flushes)
      row.buffer += pending; pending = "";
      lastFlush = Date.now();
    };

    const ctrl = new AbortController();
    const { stopReason } = await callClaudeStream(apiKey, { model, max_tokens: 16000, system, messages },
      { fn: "revise-outline", bookId: row.book_id, taskTable: "book_revisions", taskId: row.id },
      (delta) => {
        pending += delta;
        if (Date.now() - lastFlush > FLUSH_EVERY_MS) void flush();      // periodic checkpoint
        if (Date.now() - segmentStart > SOFT_DEADLINE_MS) ctrl.abort(); // graceful handoff
      },
      { signal: ctrl.signal },
    ).catch((e) => {
      if (ctrl.signal.aborted) return { stopReason: "aborted_soft_deadline" }; // expected
      throw e;
    });

    await flush();

    if (stopReason === "end_turn") {
      const plan = parsePlan(row.buffer);                              // finalize
      await service.from("book_revisions").update({ status: "awaiting_review", result: plan }).eq("id", row.id);
    } else {
      // max_tokens OR soft-deadline abort OR involuntary cut → keep status='streaming', re-invoke self
      await service.from("book_revisions").update({ messages: row.messages }).eq("id", row.id);
      EdgeRuntime.waitUntil(reinvoke("revise-outline", { id: row.id }));
    }
  };

  EdgeRuntime.waitUntil(runOneSegment());
  return json({ id: row.id }, 202);   // client watches the row from here
});
```

> ### 5b-note. Prefill-continuation per provider — the load-bearing caveat
>
> The whole pattern hinges on: *feed the accumulated output back as a trailing assistant turn and the
> model continues it.* On Anthropic this is a first-class, documented behavior. On the OpenAI-compatible
> path it is **not uniform** — a plain trailing `assistant` message is, by spec, a *completed* turn, so
> many endpoints start a fresh assistant turn that **repeats or restarts** instead of continuing. You
> must opt into continuation explicitly, and support varies:
>
> - **DeepSeek — supported via "Chat Prefix Completion" (beta).** Set the last message
>   `{ role:"assistant", content: buffer, prefix: true }` **and** call the beta base URL
>   `https://api.deepseek.com/beta/...` (not `/v1`). The model continues `content` verbatim. Our
>   `DEEPSEEK_URL` currently points at `/v1`; resume needs a beta-endpoint variant.
> - **Qwen via OpenRouter — model-dependent, not guaranteed.** OpenRouter forwards a trailing
>   assistant message and *some* models continue it, but there is no universal `prefix` flag and
>   behavior differs by model build. **Verify empirically** for `qwen3-235b-a22b` before relying on
>   it; if it restarts/repeats, this pattern does not work for the Qwen tier and you must decompose.
>
> Practical implication: with the current stack, **stream+prefill-continue is only dependable on the
> DeepSeek tier (beta endpoint), and shaky on Qwen.** A `system`/instruction nudge ("you are
> continuing a partial answer; output only the continuation, never repeat prior text") helps but is
> not a guarantee on models without true prefix support. For anything structured, **§7 (decompose)
> wins decisively here.**

### 5c. Watchdog

No new function — extend `revive_stalled_chains()` to also pick up `book_revisions` rows where
`status = 'streaming'` and `updated_at < now() - interval '5 minutes'`, and `reinvoke('revise-outline',
{ id })`. Because every flush bumps `updated_at`, a *live* stream is never stale; only a hard-killed
one is.

## 6. Failure modes & gotchas (the non-obvious part)

- **Tail loss on hard kill.** Tokens generated since the last flush are gone; resume re-continues
  from the last flushed checkpoint. With a 2s flush interval you lose ≤2s of output. The *soft
  deadline* path loses nothing — the watchdog is only for genuine crashes.
- **Prefill drift — worse on the OpenAI path.** Resuming, the model must continue *exactly* — no
  re-opening a brace, no markdown fence, no re-emitting the prefix. On DeepSeek beta (`prefix:true`)
  the continuation concatenates onto `content` cleanly. On a model **without** true prefix support
  (some OpenRouter/Qwen builds) a trailing assistant message is treated as a finished turn, so it
  **restarts or repeats** — corrupting `buffer + continuation`. Mitigations: (a) use a prefix-capable
  endpoint (DeepSeek beta); (b) a system instruction "continue only, never repeat"; (c) detect a
  repeat (continuation re-emits the buffer's tail) and de-dupe; (d) **for JSON, decompose** (§7).
- **Double-flush race.** Two overlapping `flush()` calls can interleave a read-modify-write. Use an
  append-only DB op (an `append_buffer` rpc or `buffer = buffer || $1`) rather than
  read-concat-write, and/or a simple in-worker mutex so only one flush is in flight.
- **Idempotent re-invoke.** The watchdog and a graceful handoff can both fire. Guard with
  `status = 'streaming'` and bail if a segment finds the row already terminal/cancelled. The
  existing cancelled-check in `runInBackground` is the model.
- **`max_tokens` accounting.** Each segment gets its own `max_tokens` budget — that's *fine* and is
  actually how you exceed a single call's output ceiling. But it means total output is unbounded
  unless you cap segment count (e.g. abort after N segments → `status:'error'`).
- **Cost.** Prefill re-sends the accumulated assistant text as *input* on every segment, so a long
  generation pays escalating input tokens (segment k re-reads segments 1..k-1). DeepSeek applies
  automatic context caching on repeated prefixes (cache-hit input is cheaper), which softens this on
  that tier; OpenRouter caching varies by model/provider and isn't guaranteed. `cache_control` from
  the Anthropic-shape body is dropped by `anthropicToOpenAI()` anyway. Net: Qwen/DeepSeek tokens are
  cheap, but a long resume is still O(n²) in input — another reason decomposition often wins.
- **Stop the run.** Route through `lib/stopRun.ts` (the unified-stop chokepoint): a `cancelled`
  status must make the next segment bail before calling Claude.

## 7. When NOT to use this — decompose instead

If the output is structured (JSON plan, page list, objective tree), prefer **decompose +
self-chain**: generate it section-by-section, one section per invocation, each call completing
cleanly under the cap and accumulating into `result`. You get clean JSON per segment, cheaper input
(no growing prefill), and the same watchdog coverage. `revise-outline`'s plan is sectioned, so this
is the recommended path *for that function*.

Use stream+prefill-continue when the output is **long prose that must be one coherent pass** and the
context genuinely doesn't divide — e.g. a single long chapter draft where you want unbroken voice —
**and** you're on a tier with real prefix support (DeepSeek beta). On the **Qwen tier, treat
continuation as unavailable until proven otherwise**; decompose regardless.

## 8. Alternative: just raise the cap (and: the model is now cheap+fast)

Two non-`prefill` outs that may beat this whole pattern on the current stack:

1. **The call probably isn't slow anymore.** The 150s problem was measured on `claude-opus-4-8`.
   `deepseek-chat` / `qwen3-235b` generate faster and you've left the Anthropic API. **Re-measure
   the actual wall-clock** of the `revise-outline` call on the active tier before building anything —
   if it's comfortably under 150s, you need none of this (maybe just Layer-1 task-row decoupling from
   the earlier discussion, for refresh-safety).
2. **Raise the cap.** Move the one long function to **Vercel Fluid Compute** (default 300s timeout,
   `maxDuration` configurable higher) or a **Supabase paid plan**. Clears the wall outright.
   Trade-off: Fluid Compute splits your AI backend across two platforms. See
   `reference_opus_effort_param` memory for the cap context.

---

### Decision order for `revise-outline` (current stack)
1. **Measure** the call on `deepseek-chat`/`qwen`. Under cap? → just decouple onto a task row (done).
2. Over cap + output is **JSON** (it is)? → **decompose + self-chain** (§7). Skip prefill entirely.
3. Genuinely need one indivisible long *prose* pass? → stream+prefill, **DeepSeek beta endpoint only**.
4. Don't want to write chaining? → **Vercel Fluid Compute** (§8.2).

### References
- OpenRouter / OpenAI Chat Completions streaming — `choices[].delta.content`, `finish_reason`,
  `data: [DONE]`, `stream_options.include_usage`.
- DeepSeek "Chat Prefix Completion" (beta) — trailing assistant message with `prefix: true`, beta
  base URL. The only reliable prefix-continuation on the current stack.
- Existing primitives: `_shared/claude.ts` (`anthropicToOpenAI`/`openAIToAnthropic`, provider
  branching, `ai_calls` logging), `_shared/self-chain.ts` (`reinvoke`/`isChainCall`),
  `_shared/task.ts` (`runInBackground`), `revive_stalled_chains()` watchdog, `useLatestTaskRow`.
- Sibling recipes: `generate-book` (decompose + chain), `evaluate-book` (single-shot + abort signal).
