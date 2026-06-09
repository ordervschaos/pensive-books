// claude.ts — the single chokepoint for Anthropic Messages calls in edge functions.
//
// Before this, ~6 functions each had their own fetch("https://api.anthropic.com/v1/messages"). They
// all build the same request shape and discard the response's `usage`. This wrapper centralizes the
// call so every invocation is logged to ai_calls (the prompt, the raw completion, tokens, latency)
// for offline analysis/eval — without changing any prompt.
//
// Pass the EXACT request body the caller already builds (model/max_tokens/system/messages/etc.), so
// prompt + prompt-caching parity is preserved byte-for-byte. Returns the PARSED response object, so
// each caller keeps its own text/JSON extraction (data.content…). Throws on a non-2xx like before.
// Logging is best-effort: a logging failure must never break the AI call.
import { serviceClient } from "./task.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

export interface CallMeta {
  fn: string;                       // logical step name recorded on the log row
  bookId?: number | null;
  taskTable?: string | null;        // the durable task table this call serves
  taskId?: number | null;           // …and the row id, for the join
  source?: "edge" | "bridge";       // defaults to 'edge'
  userId?: string | null;           // auth user who triggered this call; null = automated/system
}

// deno-lint-ignore no-explicit-any
export async function callClaude(
  apiKey: string,
  body: Record<string, unknown>,
  meta: CallMeta,
  // `signal` lets a caller enforce a per-call timeout (evaluate-book aborts slow calls so they don't
  // outlive the worker). An abort surfaces as an error row like any other failure.
  opts?: { signal?: AbortSignal },
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const started = Date.now();
  // Insert a 'running' row BEFORE the call so it's visible in /admin while in flight. Awaited
  // (we need the id to close it out) but best-effort — a null id just means we fall back to a
  // single insert at the end, the pre-existing behavior.
  const logId = await logStart(body, meta);
  const model = body.model as string ?? "";
  const isDeepSeek = model.startsWith("deepseek");

  let raw = "";
  // deno-lint-ignore no-explicit-any
  let data: any = null;
  let errMsg: string | null = null;
  try {
    let res: Response;
    if (isDeepSeek) {
      const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY") ?? apiKey;
      res = await fetch(DEEPSEEK_URL, {
        method: "POST",
        signal: opts?.signal,
        headers: {
          "Authorization": `Bearer ${deepseekKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(anthropicToOpenAI(body)),
      });
    } else {
      res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        signal: opts?.signal,
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }
    raw = await res.text();
    if (!res.ok) errMsg = `${isDeepSeek ? "DeepSeek" : "Claude"} API ${res.status}: ${raw.slice(0, 500)}`;
    else {
      const parsed = JSON.parse(raw);
      data = isDeepSeek ? openAIToAnthropic(parsed) : parsed;
    }
  } catch (e) {
    errMsg = String((e as Error)?.message ?? e);
  }
  const latencyMs = Date.now() - started;

  // Fire-and-forget the terminal log; never let it throw into the caller.
  void logEnd(logId, body, data, meta, latencyMs, errMsg);

  if (errMsg) throw new Error(errMsg);
  return data;
}

// deno-lint-ignore no-explicit-any
function textFromContent(data: any): string {
  return (data?.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
}

// Convert an Anthropic-format request body to OpenAI-compatible format for DeepSeek.
// Strips cache_control blocks (DeepSeek doesn't support prompt caching).
function anthropicToOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  // deno-lint-ignore no-explicit-any
  const stripCacheControl = (msg: any): any => {
    if (Array.isArray(msg.content)) {
      return { ...msg, content: msg.content.map((b: any) => {
        const { cache_control: _cc, ...rest } = b;
        return rest;
      })};
    }
    return msg;
  };

  const systemStr = systemText(body.system);
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [];
  if (systemStr) messages.push({ role: "system", content: systemStr });
  // deno-lint-ignore no-explicit-any
  const userMsgs = ((body.messages ?? []) as any[]).map(stripCacheControl);
  messages.push(...userMsgs);

  const out: Record<string, unknown> = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens ?? 8192,
  };
  if (body.temperature != null) out.temperature = body.temperature;
  if (body.top_p != null) out.top_p = body.top_p;
  if (body.stop_sequences != null) out.stop = body.stop_sequences;
  // `thinking` and other Anthropic-specific extended params are not supported by DeepSeek — omit them.
  return out;
}

// Normalize an OpenAI-format response to the Anthropic shape that all callers expect.
// deno-lint-ignore no-explicit-any
function openAIToAnthropic(parsed: any): Record<string, unknown> {
  const text = parsed?.choices?.[0]?.message?.content ?? "";
  return {
    content: [{ type: "text", text }],
    usage: {
      input_tokens: parsed?.usage?.prompt_tokens ?? null,
      output_tokens: parsed?.usage?.completion_tokens ?? null,
    },
    stop_reason: "end_turn",
    model: parsed?.model ?? null,
  };
}

// `system` may be a plain string or an array of { type:'text', text } blocks (with cache_control).
function systemText(system: unknown): string | null {
  if (system == null) return null;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    // deno-lint-ignore no-explicit-any
    return system.map((b: any) => (typeof b === "string" ? b : b?.text ?? "")).join("\n");
  }
  return JSON.stringify(system);
}

// Insert the 'running' row (prompt context known up front). Returns the row id, or null if the
// insert failed — callers fall back to a single terminal insert so logging never blocks a call.
async function logStart(body: Record<string, unknown>, meta: CallMeta): Promise<number | null> {
  try {
    const { data, error } = await serviceClient().from("ai_calls").insert({
      book_id: meta.bookId ?? null,
      task_table: meta.taskTable ?? null,
      task_id: meta.taskId ?? null,
      fn: meta.fn,
      source: meta.source ?? "edge",
      user_id: meta.userId ?? null,
      model: (body.model as string) ?? null,
      system: systemText(body.system),
      input: body.messages ?? null,
      status: "running",
    }).select("id").single();
    if (error) { console.error("ai_calls start log failed (non-fatal):", error.message); return null; }
    return (data as { id: number }).id;
  } catch (e) {
    console.error("ai_calls start log threw (non-fatal):", (e as Error)?.message ?? e);
    return null;
  }
}

// Close out the call: UPDATE the running row (or INSERT a complete one if the start insert failed).
async function logEnd(
  logId: number | null,
  body: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
  data: any,
  meta: CallMeta,
  latencyMs: number,
  errMsg: string | null,
): Promise<void> {
  const terminal = {
    output: data ? textFromContent(data) : null,
    input_tokens: data?.usage?.input_tokens ?? null,
    output_tokens: data?.usage?.output_tokens ?? null,
    latency_ms: latencyMs,
    stop_reason: data?.stop_reason ?? null,
    error: errMsg,
    status: errMsg ? "error" : "done",
  };
  try {
    if (logId != null) {
      const { error } = await serviceClient().from("ai_calls").update(terminal).eq("id", logId);
      if (error) console.error("ai_calls end log failed (non-fatal):", error.message);
      return;
    }
    // Fallback: the start insert didn't land — record the whole call in one row.
    const { error } = await serviceClient().from("ai_calls").insert({
      book_id: meta.bookId ?? null,
      task_table: meta.taskTable ?? null,
      task_id: meta.taskId ?? null,
      fn: meta.fn,
      source: meta.source ?? "edge",
      user_id: meta.userId ?? null,
      model: (body.model as string) ?? null,
      system: systemText(body.system),
      input: body.messages ?? null,
      ...terminal,
    });
    if (error) console.error("ai_calls log failed (non-fatal):", error.message);
  } catch (e) {
    console.error("ai_calls end log threw (non-fatal):", (e as Error)?.message ?? e);
  }
}
