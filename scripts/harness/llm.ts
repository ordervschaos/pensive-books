// Minimal Node LLM client for the harness — deliberately NOT the edge functions' `_shared/llm.ts`.
//
// That module is Deno, routes across four providers, logs to ai_calls, and honours the ai_provider admin
// switch. The harness wants none of that: an eval's simulated author must NOT appear in `ai_calls`
// (it would pollute the very trajectory metrics being measured) and must NOT follow the product's provider
// switch (flipping tiers mid-experiment would silently change the author between A and B).
//
// So: one host, one bare model, temperature 0, no logging. DeepSeek's own API is OpenAI-compatible and is
// the cheapest key already present in supabase/functions/.env.
import { fnEnv } from "./env.ts";

const ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
// deepseek-v4-flash: the cheap tier on DeepSeek's own API. Pinned deliberately — the simulated author must
// be the SAME actor across both arms of an A/B, so it must not follow the product's model tier.
const MODEL = "deepseek-v4-flash";

export function harnessLlmAvailable(): boolean {
  return !!fnEnv.DEEPSEEK_API_KEY;
}

export interface LlmOpts {
  system: string; user: string; maxTokens?: number; model?: string;
  /**
   * Bounds how much the model thinks BEFORE answering. The pinned tier is a reasoning model and reasoning
   * counts inside max_tokens on DeepSeek's own API, so an unbounded thinker can spend the entire allowance
   * and return empty content. Raising max_tokens chases that; bounding the reasoning fixes it — and it is
   * cheaper and faster. "low" is right for the harness: both callers do a short, well-specified judgement,
   * not open research.
   */
  reasoningEffort?: "low" | "medium" | "high";
}

export async function harnessLlm({ system, user, maxTokens = 400, model = MODEL, reasoningEffort = "low" }: LlmOpts): Promise<string> {
  const key = fnEnv.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY not in supabase/functions/.env — needed for the LLM author");
  let lastErr = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        // temperature 0 — the author must be as close to a fixed function of (facts, question) as the
        // host allows, so it contributes as little variance as possible on top of the agent's own.
        temperature: 0,
        max_tokens: maxTokens,
        reasoning_effort: reasoningEffort,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch((e) => { lastErr = String(e); return null; });
    if (res?.ok) {
      const data = await res.json();
      const choice = data?.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text === "string" && text.trim()) {
        // A reply cut off by the token cap is silently corrupt input for whatever consumes it — for the
        // simulated author it means handing the agent half a sentence. Surface it loudly rather than
        // letting it pass as a normal answer.
        if (choice?.finish_reason === "length") {
          console.warn(`[harnessLlm] TRUNCATED at max_tokens=${maxTokens} — raise it; reply ended: "${text.trim().slice(-60)}"`);
        }
        return text.trim();
      }
      // An empty `content` alongside a non-empty `reasoning_content` is the signature of the reasoning
      // budget eating the whole allowance: on DeepSeek's own API, reasoning counts INSIDE max_tokens. The
      // raw payload makes this look like "the model returned nothing", which sends you debugging the
      // prompt instead of the budget.
      const reasoned = String(choice?.message?.reasoning_content ?? "").length;
      lastErr = reasoned
        ? `empty content but ${reasoned} chars of reasoning — max_tokens=${maxTokens} was consumed by reasoning (it counts inside max_tokens on this host). Raise it.`
        : `empty completion: ${JSON.stringify(data).slice(0, 200)}`;
    } else if (res) {
      lastErr = `${res.status} ${(await res.text()).slice(0, 200)}`;
    }
    if (attempt < 5) await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1500));
  }
  throw new Error(`harnessLlm failed after 5 attempts: ${lastErr}`);
}
