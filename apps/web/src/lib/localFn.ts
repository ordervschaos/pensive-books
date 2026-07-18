import { supabase, SUPABASE_PROJECT_ID } from "@/integrations/supabase/client";

// Local dev escape hatch (superseded scripts/eval-bridge.mjs for these callers): point specific edge
// functions at a LOCALLY-served instance (`supabase functions serve --env-file supabase/functions/.env`)
// instead of the deployed one, so their LLM calls ride the claude-local shim
// (scripts/claude-local-shim.mjs, subscription-billed) instead of a metered API host. The local function
// reads/writes the SAME hosted data (_shared/task.ts's hostedEnv override) — only the LLM host moves.
// Undefined by default (VITE_LOCAL_FUNCTIONS_URL unset) → every call goes to the deployed function,
// unchanged from prod behavior.
const LOCAL_FUNCTIONS_URL = import.meta.env.VITE_LOCAL_FUNCTIONS_URL as string | undefined;

// The base URL a function named `name` is reachable at — the local override when configured, else the
// deployed project's gateway. For callers that need the raw Response (e.g. a streamed body), which
// supabase.functions.invoke() can't give since it awaits and parses the whole thing.
export function functionUrl(name: string): string {
  return LOCAL_FUNCTIONS_URL ? `${LOCAL_FUNCTIONS_URL}/${name}` : `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/${name}`;
}

// Drop-in for supabase.functions.invoke(name, {body, signal}) — same { data, error } shape — that
// redirects to a locally-served function when configured, so every caller gets the local override for
// free without its own bridge branch.
export async function invokeFn<T = unknown>(
  name: string,
  opts: { body: Record<string, unknown>; signal?: AbortSignal },
): Promise<{ data: T | null; error: Error | null }> {
  if (!LOCAL_FUNCTIONS_URL) {
    const { data, error } = await supabase.functions.invoke(name, opts);
    return { data: data as T, error: (error as Error) ?? null };
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${LOCAL_FUNCTIONS_URL}/${name}`, {
      method: "POST",
      signal: opts.signal,
      headers: { "content-type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify(opts.body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: new Error((data as { error?: string })?.error ?? `${name} ${res.status}`) };
    return { data: data as T, error: null };
  } catch (e) {
    return { data: null, error: e as Error };
  }
}
