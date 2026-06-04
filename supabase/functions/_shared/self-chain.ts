// self-chain — the primitive that lets a long, multi-step job outlive both the ~150s Supabase
// worker cap AND the client tab. Each invocation does ONE unit of work (well under the cap),
// persists progress to its task row, then fire-and-forgets a POST to ITSELF for the next unit. The
// next unit runs in a fresh worker with a fresh budget. A pg_cron watchdog restarts the chain if a
// link ever dies before it can re-invoke (see the watchdog migration).
//
//   do one unit → persist progress → EdgeRuntime.waitUntil(reinvoke(self, { id, chain:true }))
//
// Trust model: a "continue" call carries the service-role bearer + the CHAIN_SECRET header, so it
// skips user auth and operates on the row id directly. A logged-out client can't forge it (it never
// has the secret). If CHAIN_SECRET is unset, isChainCall() is always false → chaining is disabled
// and the watchdog (also secret-gated) simply won't drive jobs; set it with:
//   supabase secrets set CHAIN_SECRET=<long-random-string>

// Fire-and-forget re-invocation of an edge function. Resolves once the request is DISPATCHED (not
// when the work finishes) — wrap the call in EdgeRuntime.waitUntil so this worker stays alive long
// enough to send it. Swallows errors: a failed dispatch is recovered by the watchdog.
export async function reinvoke(fnName: string, body: Record<string, unknown>): Promise<void> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${fnName}`;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const chainSecret = Deno.env.get("CHAIN_SECRET") ?? "";
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        "x-chain": chainSecret,
      },
      body: JSON.stringify({ ...body, chain: true }),
    });
  } catch (e) {
    console.error(`reinvoke ${fnName} failed (watchdog will recover):`, e);
  }
}

// Is this an internal continue/watchdog call? Trusted only when CHAIN_SECRET is set AND matches.
export function isChainCall(req: Request): boolean {
  const secret = Deno.env.get("CHAIN_SECRET") ?? "";
  return !!secret && req.headers.get("x-chain") === secret;
}
