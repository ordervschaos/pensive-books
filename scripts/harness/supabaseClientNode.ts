// The Node stand-in for @/integrations/supabase/client, swapped in by a tsconfig `paths` override
// (scripts/harness/tsconfig.json) so the harness can import the REAL apply engine — applyAgentProposal,
// applyNodeOps, generateExpansionOps — instead of reimplementing it. Porting that engine would mint a
// third twin of write logic; swapping the client it happens to sit on costs ~40 lines.
//
// Exports exactly the three symbols the DNA lib graph imports from the browser module:
//   supabase            — agentThread, bookNodes, dnaExpand, localFn
//   SUPABASE_ANON_KEY   — dnaExpand (raw stream-prose fetch)
//   SUPABASE_PROJECT_ID — localFn (functionUrl)
//
// It authenticates as a REAL user (magic-link mint), not the service role, so writes go through the same
// RLS policies the browser hits — a service-role client would silently pass on RLS regressions.
//
// No top-level await, deliberately: without `"type": "module"` the app's .ts files transpile to CJS, and
// CJS cannot `require()` an ESM module that awaits at the top level. The token is therefore minted lazily
// inside a fetch wrapper, which is async by nature.
import { createClient } from "@supabase/supabase-js";
import { ANON_KEY, mintUserJwt, PROJECT_ID, SUPABASE_URL } from "./env.ts";

export const SUPABASE_PROJECT_ID = PROJECT_ID;
export const SUPABASE_ANON_KEY = ANON_KEY;

// Minted once on first use and reused — the promise itself is the memo, so concurrent callers share one
// in-flight mint rather than racing to create several sessions.
let pending: Promise<string> | null = null;
const token = (): Promise<string> => (pending ??= mintUserJwt());

export const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    // Every PostgREST query and functions.invoke() goes through this, so the user JWT rides along without
    // needing to exist at module-construction time.
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${await token()}`);
      const method = (init?.method ?? "GET").toUpperCase();

      // Retry CONNECTION-level failures only. A ~15-minute run being killed by one transient TLS reset is
      // the worst possible failure mode here: it costs the whole run and reads as an agent problem. Note
      // this retries the *transport*, never a non-2xx — HTTP status is semantic and belongs to the caller.
      //
      // Honest caveat on non-idempotent verbs: an ECONNRESET while READING the response is ambiguous — the
      // write may already have landed, so a retry can duplicate it. The DNA writes are upserts keyed by
      // node id (safe), but a thread message could double. Retrying is still the better trade against
      // losing the run, so mutating retries are logged loudly enough to spot a duplicate afterwards.
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          return await fetch(input, { ...init, headers });
        } catch (e) {
          lastErr = e;
          if (attempt === 5) break;
          const url = typeof input === "string" ? input : (input as Request).url ?? String(input);
          if (method !== "GET" && method !== "HEAD") {
            console.warn(`[harness] retrying ${method} after transport error (may duplicate): ${url.slice(0, 120)}`);
          }
          await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
        }
      }
      throw lastErr;
    },
  },
});

// dnaExpand and localFn call getSession() to forward the caller's JWT to edge functions themselves.
// persistSession:false means there is no stored session, so hand back the minted one.
supabase.auth.getSession = (async () => ({
  data: { session: { access_token: await token() } },
  error: null,
})) as unknown as typeof supabase.auth.getSession;

/** The harness's own JWT, for raw fetches that bypass supabase-js. */
export const harnessToken = token;
