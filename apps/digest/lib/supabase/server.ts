import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SESSION_COOKIE_KEY, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/pensive";

// Request-scoped, RLS-enforcing client for Server Components and route handlers. Reads the shared
// .pensive.me session cookie written by the SPA.
export function createClient(): SupabaseClient {
  const cookieStore = cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: { name: SESSION_COOKIE_KEY, path: "/", sameSite: "lax" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components can read cookies but not always write them. Deliberately swallowed:
          // this app never *owns* session refresh (the SPA does — see middleware.ts).
        }
      },
    },
  });
}

// Service-role client — BYPASSES RLS. Only for the build pipeline, which acts on behalf of a user who
// is asleep at 6am and therefore has no JWT to present. Never import this into a component.
export function createServiceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createSupabaseClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
