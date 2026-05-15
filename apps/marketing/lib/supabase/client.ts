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
