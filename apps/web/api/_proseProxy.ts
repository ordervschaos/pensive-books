// Shared core for the prose streaming proxy (TO-DO/dna-streaming-proxy.md, shipped).
//
// WHY: the long prose generation (qwen, 80–140s) used to run inside the Supabase dna-expand worker and got
// killed at its ~150s wall-clock (~54% of calls). This proxy moves that one call OFF Supabase: the browser
// streams it from a same-origin endpoint that holds the OpenRouter key and just pipes bytes. Context + the
// v2 digest are still assembled by dna-expand (prepare mode) — fast, DB-bound, under the ceiling.
//
// The OpenRouter key never reaches the browser: this module is imported ONLY by the prod Vercel function
// (api/stream-prose.ts) and the dev Vite middleware (vite.config.ts) — never by the client bundle. A caller
// must present a valid Supabase JWT (same gate the bridge uses) so a random site can't spend the key.

// Provider routing — twin of resolveRoute in supabase/functions/_shared/llm.ts (keep in sync). The tables
// can't be imported across the Deno/Node boundary, so they are duplicated; the SSE shapes differ per host
// anyway (Anthropic's typed frames vs the OpenAI `data:`/[DONE] framing), which is what this file adds.
// The admin's `ai_provider` preference reaches us as `body.provider`: dna-expand resolved the model AND read
// the setting in `prepare` mode, and dnaExpand.ts forwards the whole prepared payload verbatim.
type Provider = "anthropic" | "openrouter" | "deepseek" | "mulerouter";
type ProviderPref = "auto" | Provider;

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

// MuleRouter serves a SUBSET of the OpenRouter catalogue under BARE ids at an OpenAI-compatible endpoint
// (same SSE shape, incl. delta.reasoning frames). DeepSeek's own API serves the v4 pair, also bare.
const MULEROUTER_MODELS = new Set([
  "deepseek-v4-flash", "deepseek-v4-pro", "glm-5.1", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
  "gpt-5.5", "grok-4", "grok-4-20-non-reasoning", "grok-code-fast-1", "kimi-k2.6", "qwen-flash",
  "qwen-plus", "qwen-vl-max", "qwen3-max", "qwen3-max-2026-01-23", "qwen3-omni-flash", "qwen3-vl-flash",
  "qwen3-vl-plus", "qwen3.5-flash", "qwen3.5-omni-flash", "qwen3.5-omni-plus", "qwen3.5-plus",
  "qwen3.6-flash", "qwen3.6-max-preview", "qwen3.6-plus", "qwen3.7-max", "qwen3.7-plus",
]);
const DEEPSEEK_MODELS = new Set(["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"]);

const bareId = (model: string) => model.slice(model.indexOf("/") + 1);

function wireModelFor(provider: Provider, model: string): string | null {
  switch (provider) {
    case "anthropic": return !model.includes("/") && !model.startsWith("deepseek") ? model : null;
    case "openrouter": return model.includes("/") ? model : null;
    case "mulerouter": return MULEROUTER_MODELS.has(bareId(model)) ? bareId(model) : null;
    case "deepseek": return DEEPSEEK_MODELS.has(bareId(model)) ? bareId(model) : null;
  }
}

function autoOrder(model: string): Provider[] {
  if (model.includes("/")) return ["mulerouter", "openrouter"];
  if (model.startsWith("deepseek")) return ["deepseek"];
  return ["anthropic"];
}

interface Route { provider: Provider; url: string; model: string; key: string }

// A preference wins only where the provider can serve the model AND its key is present; otherwise fall back
// through the model's native order, so flipping the switch never strands a model on a host that can't run it.
function resolveRoute(model: string, pref: ProviderPref): Route {
  const order = autoOrder(model);
  const candidates: Provider[] = pref === "auto" ? order : [pref, ...order];
  const keyOf = (p: Provider) => process.env[PROVIDER_KEY_ENV[p]] ?? "";
  for (const p of candidates) {
    const wire = wireModelFor(p, model);
    if (wire && keyOf(p)) return { provider: p, url: PROVIDER_URL[p], model: wire, key: keyOf(p) };
  }
  const p = candidates.find((c) => wireModelFor(c, model)) ?? "anthropic";
  throw new ProxyError(500, `${PROVIDER_KEY_ENV[p]} not configured (needed to run ${model})`);
}

// Heartbeat byte emitted during a reasoning model's thinking phase (see the reasoning branch below). NUL
// never occurs in valid prose, so the client strips it before persisting. Exported so the client uses the
// SAME sentinel rather than hard-coding it in two places.
export const STREAM_HEARTBEAT = "\u0000";

export interface PrepareReq {
  system: string;
  userContent: string;
  model: string;
  max_tokens?: number;
  // The admin's `ai_provider` setting, resolved and forwarded by dna-expand's `prepare` mode. Absent on
  // older payloads → "auto", i.e. infer the host from the model id exactly as this proxy always has.
  provider?: ProviderPref;
}

export class ProxyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ProxyError";
  }
}

function supabaseUrl(): string {
  return process.env.SUPABASE_URL
    || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : "");
}

// Verify the caller's Supabase access token by asking GoTrue who it belongs to. Returns the user id (for
// logging). Anything but a 200 → 401, so the key is only ever spent for a signed-in user.
async function verifyJwt(authToken: string): Promise<string> {
  const url = supabaseUrl();
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!url || !anon) throw new ProxyError(500, "stream-prose proxy missing SUPABASE_URL / anon key");
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${authToken}` } });
  if (!r.ok) throw new ProxyError(401, "invalid or expired session");
  const u = (await r.json().catch(() => ({}))) as { id?: string };
  return u?.id ?? "";
}

// Two-phase logging (mirrors _shared/llm.ts's logStart/logEnd): insert a 'running' row BEFORE the upstream
// fetch so a multi-minute stream is visible in /admin WHILE in flight, not only after it finishes — the
// single-terminal-insert version left /admin showing nothing for the entire generation. Best-effort; a
// failed start insert just means logStreamEnd falls back to one terminal insert, same as the edge chokepoint.
async function logStreamStart(body: PrepareReq, userId: string, provider: Provider): Promise<number | null> {
  try {
    const url = supabaseUrl();
    const service = process.env.SERVICE_ROLE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!url || !service) return null;
    const res = await fetch(`${url}/rest/v1/ai_calls`, {
      method: "POST",
      headers: { apikey: service, Authorization: `Bearer ${service}`, "content-type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        fn: "dna-expand-stream",
        source: "stream-proxy",
        model: body.model,
        provider,
        user_id: userId || null,
        system: body.system,
        // Store as messages array so contextText() in AiCalls.tsx can render it the same way edge calls do.
        input: [{ role: "user", content: body.userContent }],
        status: "running",
      }),
    });
    if (!res.ok) return null;
    const rows = (await res.json().catch(() => null)) as { id?: number }[] | null;
    return rows?.[0]?.id ?? null;
  } catch { return null; }
}

// Close out the call: UPDATE the running row (or INSERT a complete one if the start insert failed — e.g.
// the request never got far enough to have a userId/body worth starting a row for). Fire-and-forget — never
// blocks or breaks the stream. `inputChars`/`outputChars` are rough token estimates (chars/4): a streamed SSE
// response has no discrete `usage` object to read exactly, the same precision already accepted before this split.
async function logStreamEnd(logId: number | null, row: {
  model: string; userId: string; latencyMs: number; inputChars: number; outputChars: number; errMsg: string | null;
  system?: string; userContent?: string; output?: string; provider?: Provider;
}): Promise<void> {
  const terminal = {
    output: row.output ?? null,
    input_tokens: Math.round(row.inputChars / 4),
    output_tokens: Math.round(row.outputChars / 4),
    latency_ms: row.latencyMs,
    status: row.errMsg ? "error" : "done",
    error: row.errMsg,
  };
  try {
    const url = supabaseUrl();
    const service = process.env.SERVICE_ROLE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!url || !service) return;
    if (logId != null) {
      await fetch(`${url}/rest/v1/ai_calls?id=eq.${logId}`, {
        method: "PATCH",
        headers: { apikey: service, Authorization: `Bearer ${service}`, "content-type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(terminal),
      });
      return;
    }
    await fetch(`${url}/rest/v1/ai_calls`, {
      method: "POST",
      headers: { apikey: service, Authorization: `Bearer ${service}`, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        fn: "dna-expand-stream",
        source: "stream-proxy",
        model: row.model,
        provider: row.provider ?? null,
        user_id: row.userId || null,
        system: row.system ?? null,
        input: row.userContent != null ? [{ role: "user", content: row.userContent }] : null,
        ...terminal,
      }),
    });
  } catch { /* observability is best-effort; the prose is what matters */ }
}

// Stream the prose generation from OpenRouter, yielding text deltas as they arrive. Throws ProxyError
// BEFORE the first yield on auth / config / upstream failure (so the wrapper can send a clean error status);
// once bytes flow, a mid-stream upstream break simply ends the generator (the browser validates length).
// `onLogId` (optional) fires once the 'running' ai_calls row is inserted (before any upstream fetch, so
// its result is ready before the HTTP wrapper sends response headers) — lets the caller echo the row id
// back to the client (X-Ai-Call-Id), so dnaExpand.ts can stamp book_nodes.last_ai_call_id on commit.
export async function* streamProse(body: PrepareReq, authToken: string, onLogId?: (id: number | null) => void): AsyncGenerator<string> {
  const started = Date.now();
  let userId = "";
  let logId: number | null = null;
  let inputChars = 0;
  let chars = 0;
  let output = "";
  let errMsg: string | null = null;
  let route: Route | null = null;
  try {
    if (!authToken) throw new ProxyError(401, "missing Authorization token");
    if (!body?.system || !body?.userContent || !body?.model) throw new ProxyError(400, "system, userContent and model are required");
    userId = await verifyJwt(authToken);
    inputChars = body.system.length + body.userContent.length;

    // claude-local: the laptop-only subscription shim (scripts/claude-local-shim.mjs), which model-config's
    // resolveRoleModels resolves prose/structure to when CLAUDE_LOCAL_URL is set in the edge env. It's a
    // sentinel, not a real model id, and the shim is NON-streaming (runs `claude -p`, returns one complete
    // Anthropic Messages JSON) — so we short-circuit BEFORE resolveRoute (which has no claude-local host and
    // would misroute it to Anthropic) and yield the whole reply as a single chunk. Only ever reached in local
    // dev: prod never resolves a role to claude-local (localBridgeUp is false when deployed), so the shim's
    // absence there is moot. This proxy runs on the host (Vite dev / Vercel fn), not the Docker edge worker,
    // so it reaches the shim at 127.0.0.1 — CLAUDE_LOCAL_URL in functions/.env uses host.docker.internal,
    // which only resolves from inside the container; override here with CLAUDE_LOCAL_PROXY_URL if needed.
    if (body.model === "claude-local") {
      const shimUrl = process.env.CLAUDE_LOCAL_PROXY_URL
        || `http://127.0.0.1:${process.env.CLAUDE_LOCAL_SHIM_PORT || "8788"}/v1/messages`;
      logId = await logStreamStart(body, userId, "claude-local" as unknown as Provider);
      onLogId?.(logId);
      // The shim is NON-streaming: it runs `claude -p` and returns one complete Messages JSON only when the
      // whole (60–120s) generation finishes. The browser's streamText aborts after STREAM_IDLE_MS (45s) with
      // NO bytes, so a naive `await fetch` here yields nothing for the full run and the client kills it as a
      // stall. Emit a heartbeat (STREAM_HEARTBEAT, stripped client-side) every HB_MS while the shim works, so
      // the client's idle timer keeps resetting — the same trick the reasoning-model SSE branches use per frame.
      let shimResult: { ok: boolean; status: number; body: string } | null = null;
      let shimErr: unknown = null;
      const shimPromise = fetch(shimUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: body.model,
          max_tokens: body.max_tokens ?? 8000,
          system: body.system,
          messages: [{ role: "user", content: body.userContent }],
        }),
      }).then(async (r) => { shimResult = { ok: r.ok, status: r.status, body: await r.text() }; })
        .catch((e) => { shimErr = e; });
      const HB_MS = 20_000;
      while (!shimResult && !shimErr) {
        await Promise.race([shimPromise, new Promise((r) => setTimeout(r, HB_MS))]);
        if (!shimResult && !shimErr) yield STREAM_HEARTBEAT;
      }
      if (shimErr) throw new ProxyError(502, `claude-local fetch failed: ${shimErr instanceof Error ? shimErr.message : String(shimErr)}`);
      if (!shimResult!.ok) throw new ProxyError(502, `claude-local ${shimResult!.status}: ${shimResult!.body.slice(0, 300)}`);
      let full = "";
      try {
        const j = JSON.parse(shimResult!.body) as { content?: Array<{ type?: string; text?: string }> };
        full = (j?.content ?? []).filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
      } catch { throw new ProxyError(502, "claude-local returned unparsable JSON"); }
      chars += full.length;
      output += full;
      if (full) yield full;
      return;
    }

    // Anthropic SSE is a different shape from everyone else's (typed frames, no [DONE]), so the two wire
    // formats get their own branches. `route` decides which host runs the model; the OpenAI-compatible
    // hosts (OpenRouter / MuleRouter / DeepSeek) then share one parser. Resolved before the 'running' row is
    // written so that row names the host serving it, matching the edge chokepoint's ordering.
    route = resolveRoute(body.model, body.provider ?? "auto");
    logId = await logStreamStart(body, userId, route.provider);
    onLogId?.(logId);

    if (route.provider === "anthropic") {
      const res = await fetch(route.url, {
        method: "POST",
        headers: { "x-api-key": route.key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        // No thinking config: prose wants text only, and Opus streams it directly with no thinking phase.
        body: JSON.stringify({
          model: route.model,
          max_tokens: body.max_tokens ?? 8000,
          stream: true,
          system: body.system,
          messages: [{ role: "user", content: body.userContent }],
        }),
      });
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw new ProxyError(502, `Anthropic ${res.status}: ${t.slice(0, 300)}`);
      }

      // Anthropic SSE frames carry a `type`: content_block_delta{delta:text_delta} is prose; message_stop
      // (or error) ends it; ping keeps the connection alive during pre-text latency (mirror the qwen
      // heartbeat so the client's idle timer resets). Same newline-buffered `data:` framing as OpenRouter.
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          try {
            const j = JSON.parse(data);
            if (j?.type === "content_block_delta") {
              const d = j.delta;
              if (d?.type === "text_delta" && typeof d.text === "string" && d.text) {
                chars += d.text.length;
                output += d.text;
                yield d.text;
              } else if (d?.type === "thinking_delta") {
                yield STREAM_HEARTBEAT;
              }
            } else if (j?.type === "ping") {
              yield STREAM_HEARTBEAT;
            } else if (j?.type === "message_stop" || j?.type === "error") {
              return;
            }
          } catch { /* partial/keep-alive frame — ignore */ }
        }
      }
      return;
    }

    const res = await fetch(route.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${route.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: route.model,
        max_tokens: body.max_tokens ?? 8000,
        stream: true,
        messages: [
          { role: "system", content: body.system },
          { role: "user", content: body.userContent },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => "");
      throw new ProxyError(502, `${route.provider} ${res.status}: ${t.slice(0, 300)}`);
    }

    // OpenAI/OpenRouter SSE: newline-delimited `data: {json}` frames, terminal `data: [DONE]`; `:`-comment
    // lines are keep-alives. Buffer partial lines across chunks.
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta;
          const content = delta?.content;
          if (typeof content === "string" && content) {
            chars += content.length;
            output += content;
            yield content;
          } else if (delta?.reasoning || delta?.reasoning_content) {
            // qwen3.7-plus and other REASONING models stream a long `delta.reasoning` phase (content empty)
            // BEFORE any prose. Without a signal the client sees zero bytes for that whole phase (tens of
            // seconds) and its idle timeout fires → abort/retry/fail. Emit a heartbeat per reasoning frame:
            // it keeps the connection visibly alive, the client resets its idle timer on any byte, and the
            // sentinel is stripped before the prose is saved.
            yield STREAM_HEARTBEAT;
          }
        } catch { /* partial/keep-alive frame — ignore */ }
      }
    }
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    void logStreamEnd(logId, { model: body?.model ?? "", provider: route?.provider, userId, latencyMs: Date.now() - started, inputChars, outputChars: chars, errMsg, system: body?.system, userContent: body?.userContent, output: output || undefined });
  }
}
