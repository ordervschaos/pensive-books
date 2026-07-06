// llm.ts — the single chokepoint for LLM provider calls in edge functions.
//
// Callers always build an Anthropic Messages-shaped request (system/messages/tool_use/tool_result);
// this wrapper routes it to the right provider — Anthropic, DeepSeek, or any `provider/model` id via
// OpenRouter — converting the request + response shape both ways so callers stay provider-agnostic.
// (The name is the INTERFACE callers speak, not the backend that runs the call.)
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
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface CallMeta {
  fn: string;                       // logical step name recorded on the log row
  bookId?: number | null;
  taskTable?: string | null;        // the durable task table this call serves
  taskId?: number | null;           // …and the row id, for the join
  source?: "edge" | "bridge";       // defaults to 'edge'
  userId?: string | null;           // auth user who triggered this call; null = automated/system
  // Labeled inputs that composed this call's prompt (brief, objective, beat, character_states,
  // open_loops, preceding-prose refs…). Logged to ai_calls.artifacts as provenance — the full merged
  // prompt is still in `input`. Optional; callers that don't assemble unit context leave it null.
  artifacts?: Record<string, unknown> | null;
  // Set BY callLLM after the log row is inserted: the ai_calls.id of this call, so a caller can
  // link the produced artifact back to its call (e.g. pages.last_ai_call_id). Do not set yourself.
  loggedCallId?: number;
}

// deno-lint-ignore no-explicit-any
export async function callLLM(
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
  if (logId != null) meta.loggedCallId = logId; // hand the row id back so callers can link to it
  const model = body.model as string ?? "";
  // A slash is the OpenRouter namespace marker and must win: DeepSeek's DIRECT API only accepts bare ids
  // (deepseek-chat), and rejects an OpenRouter id like "deepseek/deepseek-v4-pro". So route slashed ids to
  // OpenRouter even when they start with "deepseek"; only bare deepseek-* ids go to the direct DeepSeek API.
  const isOpenRouter = model.includes("/");
  const isDeepSeek = !isOpenRouter && model.startsWith("deepseek");

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
    } else if (isOpenRouter) {
      const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") ?? apiKey;
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: opts?.signal,
        headers: {
          "Authorization": `Bearer ${openRouterKey}`,
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
    if (!res.ok) errMsg = `${isDeepSeek ? "DeepSeek" : isOpenRouter ? "OpenRouter" : "Claude"} API ${res.status}: ${raw.slice(0, 500)}`;
    else {
      const parsed = JSON.parse(raw);
      data = (isDeepSeek || isOpenRouter) ? openAIToAnthropic(parsed) : parsed;
    }
  } catch (e) {
    errMsg = String((e as Error)?.message ?? e);
  }
  const latencyMs = Date.now() - started;

  // Await the terminal log so the status flip lands before the worker exits.
  // logEnd has its own try/catch and never throws, so this is safe.
  await logEnd(logId, body, data, meta, latencyMs, errMsg);

  if (errMsg) throw new Error(errMsg);
  return data;
}

// Join all text blocks from a Claude (or OpenAI-normalized) response's content array. Untrimmed —
// callers add .trim() where they need it. The single place response text is pulled from `content`.
// deno-lint-ignore no-explicit-any
export function textFromLLM(data: any): string {
  return ((data?.content ?? []) as Array<{ type?: string; text?: string }>)
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

// Convert an Anthropic-format request body to OpenAI-compatible format (DeepSeek, MuleRouter/Qwen).
// Carries TOOLS both ways: Anthropic tool defs → OpenAI function defs, assistant tool_use blocks →
// tool_calls, and tool_result blocks → role:"tool" messages — so tool-using loops (book-agent)
// work on the OpenAI-compatible tiers. Drops what those APIs don't speak: cache_control, thinking
// blocks, and Anthropic-specific params (`thinking`, `output_config`).
function anthropicToOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  // deno-lint-ignore no-explicit-any
  const textOf = (blocks: any[]): string =>
    blocks.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n").trim();
  // tool_result content may be a plain string or an array of text blocks.
  // deno-lint-ignore no-explicit-any
  const resultText = (content: any): string =>
    typeof content === "string" ? content : Array.isArray(content) ? textOf(content) : String(content ?? "");

  const systemStr = systemText(body.system);
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [];
  if (systemStr) messages.push({ role: "system", content: systemStr });

  // deno-lint-ignore no-explicit-any
  for (const msg of (body.messages ?? []) as any[]) {
    if (!Array.isArray(msg.content)) {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }
    if (msg.role === "assistant") {
      // deno-lint-ignore no-explicit-any
      const toolCalls = msg.content.filter((b: any) => b?.type === "tool_use").map((b: any) => ({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      const text = textOf(msg.content);
      // deno-lint-ignore no-explicit-any
      const m: any = { role: "assistant", content: text || null };
      if (toolCalls.length) m.tool_calls = toolCalls;
      messages.push(m);
    } else {
      // OpenAI wants each tool result as its own role:"tool" message, directly after the
      // assistant message that carries the matching tool_calls entry.
      // deno-lint-ignore no-explicit-any
      for (const b of msg.content.filter((b: any) => b?.type === "tool_result")) {
        messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: resultText(b.content) });
      }
      const text = textOf(msg.content);
      if (text) messages.push({ role: msg.role, content: text });
    }
  }

  const out: Record<string, unknown> = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens ?? 8192,
  };
  if (Array.isArray(body.tools) && (body.tools as unknown[]).length) {
    // deno-lint-ignore no-explicit-any
    out.tools = (body.tools as any[]).map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description ?? "", parameters: t.input_schema ?? { type: "object" } },
    }));
  }
  if (body.temperature != null) out.temperature = body.temperature;
  if (body.top_p != null) out.top_p = body.top_p;
  if (body.stop_sequences != null) out.stop = body.stop_sequences;
  return out;
}

// Normalize an OpenAI-format response to the Anthropic shape that all callers expect —
// including tool_calls → tool_use blocks, so tool loops see the same content array either way.
// deno-lint-ignore no-explicit-any
function openAIToAnthropic(parsed: any): Record<string, unknown> {
  const choice = parsed?.choices?.[0] ?? {};
  const msg = choice.message ?? {};
  // deno-lint-ignore no-explicit-any
  const content: any[] = [];
  const text = msg.content ?? "";
  if (text) content.push({ type: "text", text });
  for (const tc of msg.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(tc.function?.arguments || "{}");
    } catch {
      // Unparseable arguments: surface an empty input — the tool executor's own validation
      // returns an is_error result the model can recover from.
    }
    content.push({ type: "tool_use", id: tc.id, name: tc.function?.name ?? "", input });
  }
  const stopReason =
    choice.finish_reason === "tool_calls" ? "tool_use"
      : choice.finish_reason === "length" ? "max_tokens"
        : "end_turn";
  return {
    content,
    usage: {
      input_tokens: parsed?.usage?.prompt_tokens ?? null,
      output_tokens: parsed?.usage?.completion_tokens ?? null,
    },
    stop_reason: stopReason,
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
      artifacts: meta.artifacts ?? null,
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
    output: data ? textFromLLM(data) : null,
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
      artifacts: meta.artifacts ?? null,
      ...terminal,
    });
    if (error) console.error("ai_calls log failed (non-fatal):", error.message);
  } catch (e) {
    console.error("ai_calls end log threw (non-fatal):", (e as Error)?.message ?? e);
  }
}
