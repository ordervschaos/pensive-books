import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

// The single place this app talks to a model. One chokepoint, for the same reason the main app has
// _shared/llm.ts: every call gets logged to `ai_calls` (shared with the rest of Pensive, so cost is
// attributable per digest issue), and switching providers later is one edit here rather than a hunt.
//
// Anthropic direct rather than the active DeepSeek tier: the `search` adapter needs `web_search`, which is
// an Anthropic SERVER tool — the search runs server-side and comes back in the same call, so there is no
// separate search API or key to manage. Using one provider for both stages keeps this app to a single path.

// Two models, split by what each stage actually needs.
//
// GATHER stays on Opus: it drives web_search with dynamic filtering — the model writes and runs code to
// filter results, and judges source quality against the "discard content farms" rule. That judgement is the
// expensive part of the whole pipeline to get wrong, because a bad gather poisons everything downstream.
//
// WRITE is Sonnet: by then the material is already fetched, vetted and handed over, and the job is
// transformation — read these sources, write four honest paragraphs in this voice. Sonnet 5 is near-Opus on
// exactly that shape of work at a fraction of the cost, and the write stage is where the token volume is
// (one call per section, every day, forever).
export const MODEL_GATHER = "claude-opus-5";
export const MODEL_WRITE = "claude-sonnet-5";

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

const anthropic = new Anthropic();

export async function callClaude(opts: CallOptions, meta: CallMeta): Promise<CallResult> {
  const started = Date.now();
  const model = opts.model ?? MODEL_WRITE;
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
      await log(meta, opts, model, "", res, started, "refusal");
      return { text: "", sources: [] };
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    await log(meta, opts, model, text, res, started, null);
    return { text, sources: extractSources(res) };
  } catch (e) {
    await log(meta, opts, model, "", null, started, String((e as Error)?.message ?? e));
    throw e;
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

// Best-effort: a logging failure must never take down a digest build.
async function log(
  meta: CallMeta,
  opts: CallOptions,
  model: string,
  output: string,
  res: Anthropic.Message | null,
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
        provider: "anthropic",
        system: opts.system,
        input: { prompt: opts.prompt },
        output,
        input_tokens: res?.usage?.input_tokens ?? null,
        output_tokens: res?.usage?.output_tokens ?? null,
        latency_ms: Date.now() - started,
        stop_reason: res?.stop_reason ?? null,
        status: error ? "error" : "done",
        error,
      });
  } catch (e) {
    console.error("ai_calls log failed (non-fatal):", e);
  }
}
