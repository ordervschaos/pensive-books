// Prod streaming proxy (Vercel Fluid Compute, Node, Web-API signature). The dev twin lives in
// vite-plugin-stream-prose.ts; both delegate to ./_proseProxy so the logic exists once. See
// TO-DO/dna-streaming-proxy.md. Required Vercel env: OPENROUTER_API_KEY, SERVICE_ROLE_SECRET (or
// SUPABASE_SERVICE_ROLE_KEY), and SUPABASE_URL (or VITE_SUPABASE_PROJECT_ID) + an anon key.
import { streamProse, ProxyError, type PrepareReq } from "./_proseProxy";

export const config = { maxDuration: 300 };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const authToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

  let body: PrepareReq;
  try { body = (await req.json()) as PrepareReq; }
  catch { return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400, headers: { "content-type": "application/json" } }); }

  // Pull the first chunk eagerly so auth/config/upstream failures surface as a clean status code BEFORE we
  // commit to a 200 streaming response.
  let logId: number | null = null;
  const gen = streamProse(body, authToken, (id) => { logId = id; });
  let first: IteratorResult<string>;
  try { first = await gen.next(); }
  catch (e) {
    const status = e instanceof ProxyError ? e.status : 500;
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status, headers: { "content-type": "application/json" } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done && first.value) controller.enqueue(encoder.encode(first.value));
        for await (const chunk of gen) controller.enqueue(encoder.encode(chunk));
      } catch { /* mid-stream upstream break — flush what we have; client validates length */ }
      controller.close();
    },
  });
  const headers: Record<string, string> = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" };
  if (logId != null) headers["x-ai-call-id"] = String(logId);
  return new Response(stream, { headers });
}
