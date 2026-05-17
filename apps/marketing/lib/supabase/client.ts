import { createBrowserClient } from "@supabase/ssr";
import { type SupabaseClient } from "@supabase/supabase-js";
import {
  SESSION_COOKIE_KEY,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "@/lib/pensive";

export function createClient(): SupabaseClient {
  const isSharedProductionDomain =
    typeof window !== "undefined" &&
    (window.location.hostname === "pensive.me" ||
      window.location.hostname.endsWith(".pensive.me"));

  return createBrowserClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        // The SPA at app.pensive.me owns refresh. Marketing only reads the
        // shared .pensive.me cookie to toggle UI — refreshing here would race
        // with the SPA on the rotated refresh token (navigator.locks is
        // per-origin and can't coordinate across subdomains).
        autoRefreshToken: false,
        persistSession: true,
      },
      cookieOptions: {
        name: SESSION_COOKIE_KEY,
        path: "/",
        sameSite: "lax",
        secure: isSharedProductionDomain,
        ...(isSharedProductionDomain ? { domain: ".pensive.me" } : {}),
      },
    },
  );
}
