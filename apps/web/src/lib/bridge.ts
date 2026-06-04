import { supabase } from "@/integrations/supabase/client";

// Dev-only bridge to scripts/eval-bridge.mjs, which runs Claude Code locally instead of calling the
// edge functions (free on a CC subscription). Undefined in prod (VITE_EVAL_BRIDGE_URL unset) → every
// caller falls back to supabase.functions.invoke.
export const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;

// Call the bridge with the current user's Supabase access token attached. The bridge uses it to
// enforce the SAME per-book edit check the edge functions do (user_can_edit_book) before running any
// AI or writing rows. Without the token the bridge can't authorize the caller and rejects with 403.
// This is also what closes the CSRF hole: the bridge listens on localhost with CORS '*', so any site
// open in the same browser could POST to it — but none of them can obtain your Supabase JWT, so the
// edit check fails. Mirrors how functions.invoke forwards the session JWT in prod.
export async function bridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${BRIDGE}${path}`, { ...init, headers });
}
