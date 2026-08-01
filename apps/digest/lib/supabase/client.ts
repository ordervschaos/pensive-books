"use client";

import { createBrowserClient } from "@supabase/ssr";
import { type SupabaseClient } from "@supabase/supabase-js";
import { SESSION_COOKIE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL, isSharedDomain } from "@/lib/pensive";

// Browser client for the config UI.
//
// autoRefreshToken is OFF on purpose. Supabase rotates refresh tokens, and navigator.locks is
// per-origin — it cannot coordinate across subdomains. If both app.pensive.me and digest.pensive.me
// refreshed the same shared cookie, one of them would eventually present a rotated-away token and get
// logged out. The SPA owns refresh; this app only reads, and bounces to the SPA when the session is
// stale (see middleware.ts). Same rule apps/marketing already follows.
export function createClient(): SupabaseClient {
  const shared = typeof window !== "undefined" && isSharedDomain(window.location.hostname);

  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: true },
    cookieOptions: {
      name: SESSION_COOKIE_KEY,
      path: "/",
      sameSite: "lax",
      secure: shared,
      ...(shared ? { domain: ".pensive.me" } : {}),
    },
  });
}
