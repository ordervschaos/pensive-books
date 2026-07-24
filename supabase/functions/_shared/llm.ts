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
import { getActiveProvider, type Provider, type ProviderPref } from "./model-config.ts";

export type { Provider, ProviderPref };

// The `claude-local` sentinel model id is a fourth dialect that bypasses resolveRoute entirely — it's a
// deliberate model CHOICE (opt into the dev-only claude -p bridge), not a preference among hosts that can
// all serve the same model, so it doesn't belong in the Provider/wireModelFor capability matrix. Widening
// only the logged type keeps that matrix's Record<Provider, ...> tables untouched. See claude-local-shim.mjs.
type LoggedProvider = Provider | "claude-local";

const PROVIDER_URL: Record<Provider, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  mulerouter: "https://api.mulerouter.ai/vendors/openai/v1/chat/completions",
};
const PROVIDER_KEY_ENV: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mulerouter: "MULE_ROUTER_API_KEY",
};

// MuleRouter (mulerouter.ai) serves a SUBSET of the OpenRouter catalogue under BARE ids (no vendor
// prefix) at an OpenAI-compatible endpoint — tool calling verified on qwen3.7-plus (2026-07-09).
// Ids with NO MuleRouter equivalent (qwen3-235b-a22b, qwen3-8b, kimi-k2.7, glm-5.2, minimax-m3…)
// stay on OpenRouter. List from GET /vendors/openai/v1/models, 2026-07-09 — refresh when tiers change.
const MULEROUTER_MODELS = new Set([
  "deepseek-v4-flash", "deepseek-v4-pro", "glm-5.1", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
  "gpt-5.5", "grok-4", "grok-4-20-non-reasoning", "grok-code-fast-1", "kimi-k2.6", "qwen-flash",
  "qwen-plus", "qwen-vl-max", "qwen3-max", "qwen3-max-2026-01-23", "qwen3-omni-flash", "qwen3-vl-flash",
  "qwen3-vl-plus", "qwen3.5-flash", "qwen3.5-omni-flash", "qwen3.5-omni-plus", "qwen3.5-plus",
  "qwen3.6-flash", "qwen3.6-max-preview", "qwen3.6-plus", "qwen3.7-max", "qwen3.7-plus",
]);
// DeepSeek's OWN API (api.deepseek.com) serves these bare ids — GET /models, 2026-07-10. The v4 pair is the
// same model OpenRouter exposes as `deepseek/deepseek-v4-*`; deepseek-chat/-reasoner are legacy aliases that
// still resolve (chat → v4-flash). Same OpenAI wire shape, tool use verified.
const DEEPSEEK_MODELS = new Set(["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"]);

const bareId = (model: string) => model.slice(model.indexOf("/") + 1);

// The id `provider` would accept for `model`, or null when it can't serve it at all. This is the capability
// half of routing: a preference for a provider that returns null here is simply skipped.
export function wireModelFor(provider: Provider, model: string): string | null {
  switch (provider) {
    // Bare, non-deepseek ids are our Anthropic models (claude-*); OpenRouter would need an `anthropic/` prefix.
    case "anthropic": return !model.includes("/") && !model.startsWith("deepseek") ? model : null;
    case "openrouter": return model.includes("/") ? model : null;
    case "mulerouter": return MULEROUTER_MODELS.has(bareId(model)) ? bareId(model) : null;
    case "deepseek": return DEEPSEEK_MODELS.has(bareId(model)) ? bareId(model) : null;
  }
}

// The host order to try when nobody expressed a preference — i.e. exactly the historical behaviour:
// a slash means the OpenRouter namespace (MuleRouter first when its key is set), a bare `deepseek-*` id
// means DeepSeek's own API, anything else is Anthropic. Preserved verbatim so `auto` is a no-op upgrade.
function autoOrder(model: string): Provider[] {
  if (model.includes("/")) return ["mulerouter", "openrouter"];
  if (model.startsWith("deepseek")) return ["deepseek"];
  return ["anthropic"];
}

export interface Route { provider: Provider; url: string; model: string; keyEnv: string }

// Resolve (model, preference) → the host that will actually run the call. A preference wins only where the
// provider can serve the model AND its key is present; otherwise we fall back through the model's native
// order. That fallback is the whole point: flipping the switch to "deepseek" must not break the pinned
// OpenRouter digest model or an Anthropic tier — those keep working on their own hosts.
// Pure: `hasKey` is injected so this is testable without env. The last-resort return produces a request
// that fails with the provider's own auth error, which is what an unset key did before this function existed.
export function resolveRoute(model: string, pref: ProviderPref, hasKey: (env: string) => boolean): Route {
  const order = autoOrder(model);
  const candidates: Provider[] = pref === "auto" ? order : [pref, ...order];
  const route = (p: Provider, wire: string): Route => ({ provider: p, url: PROVIDER_URL[p], model: wire, keyEnv: PROVIDER_KEY_ENV[p] });
  for (const p of candidates) {
    const wire = wireModelFor(p, model);
    if (wire && hasKey(PROVIDER_KEY_ENV[p])) return route(p, wire);
  }
  for (const p of candidates) {
    const wire = wireModelFor(p, model);
    if (wire) return route(p, wire);
  }
  return route("anthropic", model);
}

// The provider preference is one row in admin_settings, read once per worker rather than per call: an edge
// worker is short-lived, and callLLM already pays two DB round-trips (logStart/logEnd) it can't avoid.
// The TTL bounds how long a long-lived worker can keep serving a stale switch after an admin flips it.
const PROVIDER_TTL_MS = 60_000;
let providerCache: { at: number; pref: Promise<ProviderPref> } | null = null;
function activeProvider(): Promise<ProviderPref> {
  const now = Date.now();
  if (!providerCache || now - providerCache.at > PROVIDER_TTL_MS) {
    providerCache = { at: now, pref: getActiveProvider() };
  }
  return providerCache.pref;
}

export interface CallMeta {
  fn: string;                       // logical step name recorded on the log row
  bookId?: number | null;
  taskTable?: string | null;        // the durable task table this call serves
  taskId?: number | null;           // …and the row id, for the join
  source?: "edge" | "bridge";       // defaults to 'edge'
  userId?: string | null;           // auth user who triggered this call; null = automated/system
  nodeId?: string | null;           // the book_nodes id this call read/wrote, when the call is node-scoped
  operation?: string | null;        // what the call was doing to that node (e.g. 'sketch', 'prose', 'beatsheet')
  // Labeled inputs that composed this call's prompt (brief, objective, beat, character_states,
  // open_loops, preceding-prose refs…). Logged to ai_calls.artifacts as provenance — the full merged
  // prompt is still in `input`. Optional; callers that don't assemble unit context leave it null.
  artifacts?: Record<string, unknown> | null;
  // Transcript-shaped callers only (the book-agent loop): the stored-transcript index the assistant
  // reply of THIS call will be appended at. Recorded so call↔turn is an exact join, never
  // reconstructed by index arithmetic (see migration 20260723120000).
  transcriptIndex?: number | null;
  // Set BY callLLM after the log row is inserted: the ai_calls.id of this call, so a caller can
  // link the produced artifact back to its call (e.g. pages.last_ai_call_id). Do not set yourself.
  loggedCallId?: number;
}

// deno-lint-ignore no-explicit-any
export async function callLLM(
  body: Record<string, unknown>,
  meta: CallMeta,
  // `signal` lets a caller enforce a per-call timeout (evaluate-book aborts slow calls so they don't
  // outlive the worker). An abort surfaces as an error row like any other failure.
  opts?: { signal?: AbortSignal },
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const started = Date.now();
  const model = body.model as string ?? "";
  const isLocal = model === "claude-local";
  // Fail loud before doing anything else — an unset env var is a config error, not a call error, so it
  // shouldn't produce a logged 'running' row for a call that never happens.
  if (isLocal && !Deno.env.get("CLAUDE_LOCAL_URL")) {
    throw new Error("claude-local tier active but CLAUDE_LOCAL_URL unset");
  }
  // Resolve the host BEFORE logging, so the 'running' row already says where the tokens are being spent —
  // the whole point of the ai_provider switch is being able to see it took effect. claude-local skips this
  // entirely: it's a fixed destination, not a preference resolved against admin_settings.
  const route = isLocal ? null : resolveRoute(model, await activeProvider(), (env) => !!Deno.env.get(env));
  const provider: LoggedProvider = isLocal ? "claude-local" : route!.provider;
  const isAnthropic = provider === "anthropic";
  const key = isLocal ? "" : (Deno.env.get(route!.keyEnv) ?? "");
  // Insert a 'running' row BEFORE the call so it's visible in /admin while in flight. Awaited
  // (we need the id to close it out) but best-effort — a null id just means we fall back to a
  // single insert at the end, the pre-existing behavior.
  const logId = await logStart(body, meta, provider);
  if (logId != null) meta.loggedCallId = logId; // hand the row id back so callers can link to it

  let raw = "";
  // deno-lint-ignore no-explicit-any
  let data: any = null;
  let errMsg: string | null = null;
  try {
    // Anthropic and the local shim both speak the request shape callers already build unchanged; every
    // other host is OpenAI-compatible and needs the conversion plus its own wire model id (bare, for
    // MuleRouter and DeepSeek).
    const passthrough = isAnthropic || isLocal;
    const url = isLocal ? Deno.env.get("CLAUDE_LOCAL_URL")! : route!.url;
    const res = await fetch(url, {
      method: "POST",
      signal: opts?.signal,
      headers: isAnthropic
        ? { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }
        : isLocal
        ? { "content-type": "application/json" }
        : { "Authorization": `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(
        passthrough ? body : { ...anthropicToOpenAI(body, route!.provider as OpenAITarget), model: route!.model },
      ),
    });
    raw = await res.text();
    if (!res.ok) errMsg = `${provider} API ${res.status}: ${raw.slice(0, 500)}`;
    else {
      const parsed = JSON.parse(raw);
      data = passthrough ? parsed : openAIToAnthropic(parsed);
    }
  } catch (e) {
    errMsg = String((e as Error)?.message ?? e);
  }
  const latencyMs = Date.now() - started;

  // Await the terminal log so the status flip lands before the worker exits.
  // logEnd has its own try/catch and never throws, so this is safe.
  await logEnd(logId, body, data, meta, latencyMs, errMsg, provider);

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
// work on the OpenAI-compatible tiers. Drops what those APIs don't speak: cache_control and
// thinking blocks. `output_config.effort` is NOT dropped — it maps to the target's reasoning
// bound (see reasoningParamsFor); silently dropping it let qwen reason unbounded and was the
// root cause of the 2026-07-09 book-agent 140s-timeout streaks (doc_1783599238000.md).
type OpenAITarget = Exclude<Provider, "anthropic">;

// Reasoning tokens are the latency budget: decode runs ~55 tok/s, and an edge worker call must
// fit a ~140s timer, so an unbounded chain-of-thought (observed: 25k chars on a hard prompt) is
// a guaranteed timeout. Anthropic bounds it via output_config.effort + max_tokens (thinking
// counts INSIDE max_tokens there); the OpenAI-compatible tiers each need their own dialect —
// and qwen's reasoning does NOT count against max_tokens, so without this param it's unbounded.
// Budgets are timer-aware: even "high" must leave room for a ~5k answer inside ~140s.
//
// ⚠️ Known limit, verified 2026-07-09 (probes on qwen3.7-plus, hard planning prompt, n=2-3 each):
// NOTHING bounds qwen3.7-plus through today's routers — MuleRouter's /vendors/openai facade drops
// `reasoning_effort`, `reasoning:{effort}`, `thinking_budget` AND `enable_thinking` (~7.4k
// completion tokens / ~25k reasoning chars / 200-390s in every condition, same as baseline), and
// OpenRouter ignores `reasoning:{effort}` for this model as well (`reasoning:{max_tokens}`
// untestable — the account was out of credits). We still send the mapping: it documents intent,
// is harmless (no 400s, verified live), and starts working the day a router forwards it. Until
// then a qwen agent tier structurally risks 140s timeouts on hard-reasoning turns — the working
// bound is max_tokens on Anthropic tiers (thinking counts inside it), i.e. keep the agent role
// on an Anthropic model, or move the call off-worker like prose (docs/agent-runtime-architecture.md).
//
// ✅ Exception, verified 2026-07-10 (deepseek-v4-flash, direct api.deepseek.com, max_tokens 3000):
// `reasoning_effort` IS honored — "low" cut reasoning 860 → 406 tokens — AND reasoning counts inside
// max_tokens (finish_reason "length" at exactly 3000). So DeepSeek's own API is the FIRST cheap host in
// this stack where the agent loop's latency is genuinely boundable, both ways Anthropic bounds it. That's
// the ai_provider="deepseek" switch's main argument over routing the same model through OpenRouter.
const EFFORT_THINKING_BUDGET: Record<string, number> = { low: 1000, medium: 2500, high: 4000 };

function reasoningParamsFor(body: Record<string, unknown>, target: OpenAITarget): Record<string, unknown> {
  const effort = (body.output_config as { effort?: string } | undefined)?.effort;
  if (!effort || !(effort in EFFORT_THINKING_BUDGET)) return {};
  switch (target) {
    case "openrouter":
      // OpenRouter's unified param, normalized per-provider; ignored for qwen3.7-plus (see above).
      return { reasoning: { max_tokens: EFFORT_THINKING_BUDGET[effort] } };
    case "mulerouter":
      // DashScope-native name; currently swallowed by the facade (see above) but the right field.
      return { thinking_budget: EFFORT_THINKING_BUDGET[effort] };
    case "deepseek":
      // The OpenAI-native name, and the one host that actually applies it (see above). Effort is a level
      // here, not a token count — the token bound is max_tokens, which DeepSeek already charges thinking to.
      return { reasoning_effort: effort };
  }
}

function anthropicToOpenAI(body: Record<string, unknown>, target: OpenAITarget): Record<string, unknown> {
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
    ...reasoningParamsFor(body, target),
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
      // Cache visibility (normalized to the Anthropic key): DeepSeek reports prompt_cache_hit_tokens,
      // OpenAI-style providers report prompt_tokens_details.cached_tokens. Logged by logEnd.
      cache_read_input_tokens: parsed?.usage?.prompt_cache_hit_tokens
        ?? parsed?.usage?.prompt_tokens_details?.cached_tokens ?? null,
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
async function logStart(body: Record<string, unknown>, meta: CallMeta, provider: LoggedProvider): Promise<number | null> {
  try {
    const { data, error } = await serviceClient().from("ai_calls").insert({
      book_id: meta.bookId ?? null,
      task_table: meta.taskTable ?? null,
      task_id: meta.taskId ?? null,
      fn: meta.fn,
      source: meta.source ?? "edge",
      user_id: meta.userId ?? null,
      node_id: meta.nodeId ?? null,
      operation: meta.operation ?? null,
      transcript_index: meta.transcriptIndex ?? null,
      model: (body.model as string) ?? null,
      provider,
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
  provider: LoggedProvider,
): Promise<void> {
  const terminal = {
    output: data ? textFromLLM(data) : null,
    // The FULL completion blocks — `output` above is text-only, which logs a pure-tool_use turn
    // (the agent's most important completions) as empty. See migration 20260723130000.
    output_json: data?.content ?? null,
    input_tokens: data?.usage?.input_tokens ?? null,
    output_tokens: data?.usage?.output_tokens ?? null,
    // Prompt-cache split (migration 20260723140000): Anthropic passthrough carries these natively;
    // openAIToAnthropic normalizes DeepSeek/OpenAI dialects onto cache_read_input_tokens.
    cache_read_tokens: data?.usage?.cache_read_input_tokens ?? null,
    cache_write_tokens: data?.usage?.cache_creation_input_tokens ?? null,
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
      node_id: meta.nodeId ?? null,
      operation: meta.operation ?? null,
      transcript_index: meta.transcriptIndex ?? null,
      model: (body.model as string) ?? null,
      provider,
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
