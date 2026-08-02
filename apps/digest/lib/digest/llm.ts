import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

// The single place this app talks to a model. One chokepoint, for the same reason the main app has
// _shared/llm.ts: every call gets logged to `ai_calls` (shared with the rest of Pensive, so cost is
// attributable per digest issue), and switching providers is one edit here rather than a hunt.
//
// TWO providers, and which one you get is decided by the MODEL ID alone (see `providerFor`). There is no
// separate switch to keep in sync with the model constants — the id is the routing key, so a stage can't
// end up pointed at a model its provider doesn't serve.

// Two models, split by what each stage actually needs.
//
// GATHER stays on Opus, and **must**: it drives `web_search`, which is an Anthropic SERVER tool — the search
// runs inside Anthropic's infrastructure and comes back in the same call. Point this at DeepSeek and the
// tool is silently dropped: no search API, no key, no error, just a model answering from memory, which is
// the one thing this whole pipeline is built to prevent. It also judges source quality against the "discard
// content farms" rule, and a bad gather poisons everything downstream.
//
// WRITE is DeepSeek v4. By then the material is already fetched, vetted and handed over, and the job is
// transformation — read these sources, write four honest paragraphs in this voice. That is the shape of work
// where the cheap tier holds up, and it is where the token volume is (one call per section, every day,
// forever). `-pro` rather than `-flash` because prose quality IS the product here; flipping this one
// constant to "deepseek-v4-flash" is the cheaper trade if the writing holds.
export const MODEL_GATHER = "claude-opus-5";
export const MODEL_WRITE = "deepseek-v4-pro";

// The umbrella gate every one of the four call sites (search gather, select triage, write, quiz closer)
// checks BEFORE calling callModel — not inside it, because each site has a different mechanical fallback
// (raw item list, feed order, dropped section) and callModel has no way to know which one applies.
//
// Two layers, checked in order: DIGEST_AI_ENABLED is an ops-level override in either direction (kill AI
// everywhere with `=false`, e.g. a cost incident; or opt back into it outside production with `=true`, e.g.
// testing the paid path locally). Absent that, AI defaults OFF outside production — iterating on the
// pipeline locally should never quietly spend real money — and in production the per-digest column
// (digests.ai_enabled, the seed of the paid tier) is the sole authority.
export function aiEnabled(digest: { ai_enabled: boolean }): boolean {
  const override = process.env.DIGEST_AI_ENABLED;
  if (override === "false") return false;
  if (override !== "true" && process.env.NODE_ENV !== "production") return false;
  return digest.ai_enabled;
}

type Provider = "anthropic" | "deepseek";

// Bare `deepseek-*` ids are DeepSeek's own API; everything else here is a `claude-*` id. Same convention the
// main app's `_shared/llm.ts` uses, so a model id means the same thing in both codebases.
function providerFor(model: string): Provider {
  return model.startsWith("deepseek") ? "deepseek" : "anthropic";
}

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

// DeepSeek charges REASONING tokens against max_tokens (verified on the main app 2026-07-10: finish_reason
// "length" landed at exactly the cap). Anthropic's `max_tokens` bounds visible output only, so every
// maxTokens number in this app was chosen under the Anthropic meaning — `writeIntro` asks for 400, which is
// generous for two sentences and *nothing at all* once a few hundred reasoning tokens come out of it first.
//
// So the DeepSeek path adds headroom rather than silently truncating. Effort is a level, not a budget, hence
// a table: these are the observed reasoning volumes per level, rounded up.
const REASONING_HEADROOM: Record<string, number> = { low: 600, medium: 1500, high: 3000 };

// web_search_20260209 = the dynamic-filtering variant: the model writes and runs code to filter results
// before they reach its context. That code can fan a single topic into several calls (and can bug out and
// issue duplicates), so max_uses has to budget for actual call volume, not for the number of topics.
//
// It was 5, and a section died on it: the model burned the allowance on a duplicated query, got zero
// results back, and — correctly — refused to write anything rather than fill from memory. A section that
// silently produces nothing is the expensive failure here, so budget loosely and steer the model to run
// few, well-chosen searches from the prompt side instead.
export const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 15 } as const;

export interface CallMeta {
  fn: string;
  operation: string;
  issueId: number | null;
  userId: string | null;
}

export interface CallOptions {
  system: string;
  prompt: string;
  /** Defaults to the write model — the gather stage passes MODEL_GATHER explicitly. */
  model?: string;
  maxTokens?: number;
  /** Cheap stages should pass "low". Omitted = the API default ("high"). */
  effort?: "low" | "medium" | "high";
  tools?: unknown[];
  signal?: AbortSignal;
}

export interface CallResult {
  text: string;
  sources: Array<{ title: string; url: string }>;
}

// ---------------------------------------------------------------------------------------------------
// THE PROVIDER POLICY, in one predicate
// ---------------------------------------------------------------------------------------------------
//
// **Anthropic is for `web_search` and nothing else. Everything else runs on DeepSeek.**
//
// That was already true by convention — `MODEL_GATHER` appears at exactly one call site — but convention is
// not a mechanism. A future call site that copied `model: MODEL_GATHER` while pasting a prompt would sit on
// Opus forever and nothing would say so; the bill is the only symptom, and it arrives a month later.
//
// So the rule is enforced from the *capability* side: reaching Anthropic requires asking for a SERVER tool.
// A server tool (`{ type: "web_search_20260209" }`) executes inside Anthropic's own infrastructure and comes
// back in the same response — it is the one thing no other host can serve, and therefore the only honest
// reason to be there. Ordinary function tools (`{ name, description, input_schema }`) are just a protocol
// both providers speak, so they carry no such licence.
function isServerTool(tool: unknown): boolean {
  return typeof (tool as { type?: unknown } | null)?.type === "string";
}

const anthropic = new Anthropic();

/**
 * Call a model. The provider is chosen from the model id, so callers name a MODEL and never a vendor.
 *
 * (Formerly `callClaude` — the name stopped being true when the write stage moved to DeepSeek. A function
 * that says Claude and dials DeepSeek is the kind of drift that costs someone an afternoon.)
 */
export async function callModel(opts: CallOptions, meta: CallMeta): Promise<CallResult> {
  const started = Date.now();
  const model = opts.model ?? MODEL_WRITE;

  // The policy, enforced rather than assumed (see `isServerTool`). Being on Anthropic without asking for a
  // server tool means someone is paying frontier prices for work DeepSeek does — fail loudly at the call
  // site instead of quietly on the invoice.
  if (providerFor(model) === "anthropic" && !(opts.tools ?? []).some(isServerTool)) {
    throw new Error(
      `${model} is an Anthropic model, and Anthropic is reserved for server tools (web_search). ` +
        `This call asks for none, so it belongs on ${MODEL_WRITE} — drop the \`model\` option.`,
    );
  }

  return providerFor(model) === "deepseek"
    ? callDeepSeek(model, opts, meta, started)
    : callAnthropic(model, opts, meta, started);
}

async function callAnthropic(
  model: string,
  opts: CallOptions,
  meta: CallMeta,
  started: number,
): Promise<CallResult> {
  const params: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 4000,
    // Cache the system prompt: the constitution + digest voice are identical across every section of an
    // issue, so section 2..N read the prefix instead of re-paying for it.
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.prompt }],
  };
  if (opts.effort) params.output_config = { effort: opts.effort };
  if (opts.tools) params.tools = opts.tools;

  try {
    const res = (await anthropic.messages.create(params as never, {
      signal: opts.signal,
    })) as Anthropic.Message;

    // A safety refusal comes back as a normal 200 with stop_reason "refusal" and empty/partial content —
    // reading content[0] blindly would throw. Treat it as an empty section, not a crash.
    if (res.stop_reason === "refusal") {
      await log(meta, opts, model, "anthropic", "", res, started, "refusal");
      return { text: "", sources: [] };
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    await log(meta, opts, model, "anthropic", text, res, started, null);
    return { text, sources: extractSources(res) };
  } catch (e) {
    await log(meta, opts, model, "anthropic", "", null, started, String((e as Error)?.message ?? e));
    throw e;
  }
}

// DeepSeek speaks OpenAI's chat-completions shape. The mapping is small because this app's calls are small:
// one system prompt, one user turn, text back. No tool loop to convert — `tools` is Anthropic-only here (see
// MODEL_GATHER), and a DeepSeek call that was handed tools would be a bug, so it says so out loud.
//
// No `cache_control`: DeepSeek caches prompt prefixes automatically, server-side, with no parameter. The
// per-issue saving the Anthropic path gets from marking the system prompt is still there, just implicit.
async function callDeepSeek(
  model: string,
  opts: CallOptions,
  meta: CallMeta,
  started: number,
): Promise<CallResult> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set (the write stage runs on DeepSeek)");
  // Server tools are Anthropic infrastructure and vanish silently anywhere else — the exact failure this
  // pipeline exists to prevent. Function tools are fine on DeepSeek, but not through THIS entry point:
  // one-shot has nowhere to put a tool result. They go through `callModelStep`.
  if (opts.tools?.length) {
    throw new Error(
      `${model} cannot serve tools through callModel: server tools are Anthropic-only, and function ` +
        `tools need the loop primitive (callModelStep).`,
    );
  }

  const headroom = opts.effort ? (REASONING_HEADROOM[opts.effort] ?? 0) : 0;
  const body: Record<string, unknown> = {
    model,
    max_tokens: (opts.maxTokens ?? 4000) + headroom,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.prompt },
    ],
  };
  // The OpenAI-native name, and DeepSeek is the one cheap host that actually applies it.
  if (opts.effort) body.reasoning_effort = opts.effort;

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = json.choices?.[0];
    const text = (choice?.message?.content ?? "").trim();

    // Truncation is worth recording rather than shipping half a section quietly. It means the headroom above
    // was too tight for this call, which is a tuning fact you want in `ai_calls`, not a mystery.
    const truncated = choice?.finish_reason === "length";
    await log(
      meta,
      opts,
      model,
      "deepseek",
      text,
      { usage: json.usage, stop_reason: choice?.finish_reason },
      started,
      truncated ? "truncated: hit max_tokens" : null,
    );
    return { text, sources: [] }; // no server tools on this path, so no citations to extract
  } catch (e) {
    await log(meta, opts, model, "deepseek", "", null, started, String((e as Error)?.message ?? e));
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------
// ONE STEP OF A TOOL LOOP — the agent's primitive
// ---------------------------------------------------------------------------------------------------
//
// `callModel` above is one-shot: a prompt in, prose out. An agent needs the other shape — a conversation
// that accumulates, where the model may answer with *tool calls* instead of an answer and the caller runs
// them and comes back. This is one step of that: send what has happened so far, get back either text (the
// turn is over) or calls to make (it is not).
//
// The LOOP itself is deliberately not here. It belongs to `lib/digest/agent/`, because "which tools exist,
// how many steps are allowed, what to do when one fails" is agent policy, not provider plumbing. What
// stays here is the chokepoint invariant: every step is one logged row in `ai_calls`, so an agent turn is
// as attributable as anything else the app spends money on.
//
// DeepSeek only, by the policy above: function tools are a protocol both providers speak, so there is no
// reason to be on the expensive one.

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Set when the model emitted arguments that weren't valid JSON — hand it back and let it correct itself. */
  parseError?: string;
}

/** One entry in the running conversation. Provider-neutral on purpose; converted at the boundary below. */
export type Turn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface StepOptions {
  system: string;
  messages: Turn[];
  tools?: ToolSpec[];
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export interface StepResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: string | null;
}

export async function callModelStep(opts: StepOptions, meta: CallMeta): Promise<StepResult> {
  const started = Date.now();
  const model = opts.model ?? MODEL_WRITE;
  if (providerFor(model) !== "deepseek") {
    throw new Error(`Tool loops run on DeepSeek; ${model} is not a DeepSeek model.`);
  }
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is not set");

  const headroom = opts.effort ? (REASONING_HEADROOM[opts.effort] ?? 0) : 0;
  const body: Record<string, unknown> = {
    model,
    max_tokens: (opts.maxTokens ?? 4000) + headroom,
    messages: [{ role: "system", content: opts.system }, ...opts.messages.map(toOpenAiMessage)],
  };
  if (opts.effort) body.reasoning_effort = opts.effort;
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
  }

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: opts.signal ?? AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const json = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = json.choices?.[0];
    const text = (choice?.message?.content ?? "").trim();
    const toolCalls = (choice?.message?.tool_calls ?? []).map(parseToolCall);

    await log(
      meta,
      { system: opts.system, prompt: JSON.stringify(opts.messages) },
      model,
      "deepseek",
      text || JSON.stringify(toolCalls),
      { usage: json.usage, stop_reason: choice?.finish_reason },
      started,
      choice?.finish_reason === "length" ? "truncated: hit max_tokens" : null,
    );

    return { text, toolCalls, stopReason: choice?.finish_reason ?? null };
  } catch (e) {
    await log(
      meta,
      { system: opts.system, prompt: JSON.stringify(opts.messages) },
      model,
      "deepseek",
      "",
      null,
      started,
      String((e as Error)?.message ?? e),
    );
    throw e;
  }
}

/**
 * Arguments arrive as a JSON *string*, and a model can produce one that doesn't parse.
 *
 * That is recorded rather than thrown: a malformed call is something the model can fix if it is told, and
 * killing the whole turn over it turns a recoverable stumble into a failure the reader has to see.
 */
function parseToolCall(call: { id: string; function?: { name?: string; arguments?: string } }): ToolCall {
  const name = call.function?.name ?? "";
  try {
    return { id: call.id, name, input: JSON.parse(call.function?.arguments || "{}") };
  } catch {
    return {
      id: call.id,
      name,
      input: {},
      parseError: `arguments were not valid JSON: ${(call.function?.arguments ?? "").slice(0, 200)}`,
    };
  }
}

function toOpenAiMessage(turn: Turn): Record<string, unknown> {
  switch (turn.role) {
    case "user":
      return { role: "user", content: turn.content };
    case "tool":
      return { role: "tool", tool_call_id: turn.toolCallId, content: turn.content };
    case "assistant":
      return {
        role: "assistant",
        // OpenAI's shape wants null, not "", when the turn was purely tool calls.
        content: turn.content || null,
        ...(turn.toolCalls?.length
          ? {
              tool_calls: turn.toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      };
  }
}

// Pull citations out of the web_search server-tool result blocks so a section can show where it got things.
function extractSources(res: Anthropic.Message): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  for (const block of res.content as unknown as Array<Record<string, unknown>>) {
    if (block.type !== "web_search_tool_result") continue;
    // On success `content` is a list of results; on failure it's a single error object — branch, don't index.
    const content = block.content;
    if (!Array.isArray(content)) continue;
    for (const r of content as Array<Record<string, string>>) {
      if (r.url) out.push({ title: r.title ?? r.url, url: r.url });
    }
  }
  return out;
}

// The two providers report usage under different names, so the log takes an already-normalized shape rather
// than sniffing the response. `ai_calls.provider` is what makes cost attributable per host — the reason the
// main app added that column when the model stack stopped being one vendor.
interface LoggedUsage {
  usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  stop_reason?: string | null;
}

// Best-effort: a logging failure must never take down a digest build.
async function log(
  meta: CallMeta,
  // Narrowed to what this actually reads, so `callModelStep` (whose "prompt" is a serialized message list)
  // can log through the same chokepoint instead of growing a second insert.
  opts: { system: string; prompt: string },
  model: string,
  provider: Provider,
  output: string,
  res: LoggedUsage | null,
  started: number,
  error: string | null,
) {
  try {
    await createServiceClient()
      .from("ai_calls")
      .insert({
        fn: meta.fn,
        source: "digest",
        operation: meta.operation,
        task_table: "digest_issues",
        task_id: meta.issueId,
        user_id: meta.userId,
        model,
        provider,
        system: opts.system,
        input: { prompt: opts.prompt },
        output,
        input_tokens: res?.usage?.input_tokens ?? res?.usage?.prompt_tokens ?? null,
        output_tokens: res?.usage?.output_tokens ?? res?.usage?.completion_tokens ?? null,
        latency_ms: Date.now() - started,
        stop_reason: res?.stop_reason ?? null,
        status: error ? "error" : "done",
        error,
      });
  } catch (e) {
    console.error("ai_calls log failed (non-fatal):", e);
  }
}
