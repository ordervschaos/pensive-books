// Shared env/auth for the headless agent harness. Kept tiny and dependency-free so the tsconfig paths
// override (scripts/harness/tsconfig.json) can pull it in ahead of any app module.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const env: Record<string, string> = Object.fromEntries(
  readFileSync(join(repoRoot, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

// The LLM keys live in the EDGE function env (supabase/functions/.env), not .env.local — the file
// `supabase functions serve --env-file` uses. Optional: only the LLM-backed author needs them.
export const fnEnv: Record<string, string> = (() => {
  try {
    return Object.fromEntries(
      readFileSync(join(repoRoot, "supabase", "functions", ".env"), "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch { return {}; }
})();

export const PROJECT_ID = env.VITE_SUPABASE_PROJECT_ID;
export const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
export const SERVICE_KEY = env.SERVICE_ROLE_SECRET;
export const SUPABASE_URL = `https://${PROJECT_ID}.supabase.co`;
// The dev user — same owner the other eval scripts use (eval-logline.mjs, dna-short-story.mjs).
export const OWNER = "91f66fef-e7f0-455d-833e-080fd65d8aed";

if (!PROJECT_ID || !ANON_KEY || !SERVICE_KEY) {
  throw new Error("harness needs VITE_SUPABASE_PROJECT_ID, VITE_SUPABASE_ANON_KEY and SERVICE_ROLE_SECRET in .env.local");
}

const svc = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

/**
 * Service-role REST, for harness bookkeeping only (creating scratch books, reading ai_calls).
 *
 * Retries CONNECTION failures — the third place this was needed. A `UND_ERR_CONNECT_TIMEOUT` here killed an
 * A/B arm before it created its scratch book, unbalancing the comparison; the supabase-js client and the
 * LLM client already retried, this one did not. Every network entry point in the harness needs it, because
 * a run costs ~15 minutes and a lost arm costs the whole comparison.
 *
 * Transport only — a non-2xx is returned to the caller as before, since HTTP status is semantic.
 */
export async function rest<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...opts,
        headers: { ...svc, "content-type": "application/json", Prefer: "return=representation", ...(opts.headers ?? {}) },
      });
      if (!r.ok) throw new Error(`REST ${path}: ${r.status} ${await r.text()}`);
      const text = await r.text();
      return (text ? JSON.parse(text) : null) as T;
    } catch (e) {
      // Only a transport failure is worth retrying; an HTTP error is the server's considered answer.
      if (e instanceof Error && e.message.startsWith(`REST ${path}:`)) throw e;
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw lastErr;
}

// Mint a REAL user session (admin generate_link → verify) rather than using the service role, so the
// harness drives the same auth + RLS path a browser does. Copied in spirit from eval-logline.mjs, which
// makes the same argument: the system under test should be the production path, not a side door.
export async function mintUserJwt(): Promise<string> {
  const u = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${OWNER}`, { headers: svc })).json();
  if (!u?.email) throw new Error(`dev user ${OWNER} not found: ${JSON.stringify(u).slice(0, 200)}`);
  const link = await (await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: "POST", headers: { ...svc, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", email: u.email }),
  })).json();
  const tokenHash = link.hashed_token ?? link.properties?.hashed_token;
  if (!tokenHash) throw new Error(`generate_link failed: ${JSON.stringify(link).slice(0, 300)}`);
  const session = await (await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST", headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
  })).json();
  if (!session.access_token) throw new Error(`verify failed: ${JSON.stringify(session).slice(0, 300)}`);
  return session.access_token as string;
}
