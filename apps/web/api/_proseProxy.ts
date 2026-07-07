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

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Heartbeat byte emitted during a reasoning model's thinking phase (see the reasoning branch below). NUL
// never occurs in valid prose, so the client strips it before persisting. Exported so the client uses the
// SAME sentinel rather than hard-coding it in two places.
export const STREAM_HEARTBEAT = "\u0000";

export interface PrepareReq {
  system: string;
  userContent: string;
  model: string;
  max_tokens?: number;
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
async function logStreamStart(body: PrepareReq, userId: string): Promise<number | null> {
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
  system?: string; userContent?: string; output?: string;
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
  try {
    if (!authToken) throw new ProxyError(401, "missing Authorization token");
    if (!body?.system || !body?.userContent || !body?.model) throw new ProxyError(400, "system, userContent and model are required");
    userId = await verifyJwt(authToken);
    inputChars = body.system.length + body.userContent.length;
    logId = await logStreamStart(body, userId);
    onLogId?.(logId);

    // Provider routing mirrors _shared/llm.ts: a bare model id (no "/", not deepseek) is an Anthropic model
    // and must go to Anthropic — NOT OpenRouter, which only knows prefixed ids (anthropic/…) and 400s on
    // "claude-opus-4-8". This lets prose render on Opus while slash/deepseek ids keep streaming from
    // OpenRouter. Anthropic SSE is a different shape (typed frames, no [DONE]), parsed in its own branch.
    const model = body.model;
    if (!model.startsWith("deepseek") && !model.includes("/")) {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) throw new ProxyError(500, "ANTHROPIC_API_KEY not configured");
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        // No thinking config: prose wants text only, and Opus streams it directly with no thinking phase.
        body: JSON.stringify({
          model,
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

    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new ProxyError(500, "OPENROUTER_API_KEY not configured");

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: body.model,
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
      throw new ProxyError(502, `OpenRouter ${res.status}: ${t.slice(0, 300)}`);
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
    void logStreamEnd(logId, { model: body?.model ?? "", userId, latencyMs: Date.now() - started, inputChars, outputChars: chars, errMsg, system: body?.system, userContent: body?.userContent, output: output || undefined });
  }
}
