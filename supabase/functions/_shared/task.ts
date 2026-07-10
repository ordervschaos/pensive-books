// task.ts — the single-shot orchestrator helper.
//
// Every "fast" AI task (scaffold, voice, one page, a thread scan) follows the evaluate-book shape:
// insert a row in a running/pending status FIRST, hand the slow work to the background
// (EdgeRuntime.waitUntil) so the HTTP response returns in ~1s, then write the terminal row when the
// work finishes — so a closed/refreshed tab loses nothing and learns the result over Realtime.
//
// This wraps the background half: run the body, write the success patch it returns, or turn a throw
// into a graceful error row (with the shared billing/Sentry handling). The caller owns auth, the
// access check, and the initial insert.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { captureException, isBillingError } from "./sentry.ts";

// `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are reserved by the platform — the CLI
// silently drops any attempt to set them via --env-file ("Env name cannot start with SUPABASE_, skipping"),
// so a locally-served function always points at the LOCAL project's (empty, unseeded) database, even when
// you explicitly want it to operate on real hosted data. These three non-reserved names, set only in a
// developer's own gitignored supabase/functions/.env, let a local run override that — the point being to
// pair with CLAUDE_LOCAL_URL: LOCAL edge runtime (reachable from the claude-local shim) + HOSTED data/auth,
// so only the LLM transport moves, not the books/users it operates on. Absent everywhere else (deployed,
// any other developer's machine), so this is a no-op by default — same shape as CLAUDE_LOCAL_URL itself.
function hostedEnv(name: "URL" | "ANON_KEY" | "SERVICE_ROLE_KEY"): string {
  return Deno.env.get(`LOCAL_DEV_HOSTED_SUPABASE_${name}`) ?? Deno.env.get(`SUPABASE_${name}`) ?? "";
}

export function serviceClient(): SupabaseClient {
  return createClient(hostedEnv("URL"), hostedEnv("SERVICE_ROLE_KEY"));
}

// For callers that need a user-scoped client (auth.getUser(), RLS-checked reads) instead of the
// service-role client above — same hosted-override behavior, so a locally-served function's auth check
// validates against the SAME project that minted the caller's session JWT.
export function userClient(authHeader: string): SupabaseClient {
  return createClient(hostedEnv("URL"), hostedEnv("ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
  });
}

// Run `work` in the background and write the terminal row. `work` resolves to the success patch
// (e.g. { status: 'ready', result }); a throw becomes { status: 'error', error } on the same row.
export function runInBackground(
  service: SupabaseClient,
  table: string,
  id: number | string,
  fnName: string,
  work: () => Promise<Record<string, unknown>>
): void {
  const p = (async () => {
    try {
      const patch = await work();
      // If the author stopped this run while the (still-billing) call was in flight, the row is
      // already 'cancelled' — don't resurrect it by overwriting with the result.
      const { data: cur } = await service.from(table).select("status").eq("id", id).single();
      if (cur?.status === "cancelled") return;
      const { error } = await service.from(table).update(patch).eq("id", id);
      if (error) throw new Error(`save result: ${error.message}`);
    } catch (e) {
      console.error(`${fnName} run ${id} failed:`, e);
      const billing = isBillingError(e);
      await captureException(e, { function: fnName, billing: String(billing) });
      const msg = billing
        ? "AI credits exhausted — the team has been notified."
        : String((e as Error)?.message ?? e).slice(0, 1000);
      await service.from(table).update({ status: "error", error: msg }).eq("id", id);
    }
  })();
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(p);
}
