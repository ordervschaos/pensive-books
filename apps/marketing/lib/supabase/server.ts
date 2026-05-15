import { createServerClient } from "@supabase/ssr";
import { type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE_KEY,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "@/lib/pensive";

export function createClient(): SupabaseClient {
  const cookieStore = cookies();

  return createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookieOptions: {
        name: SESSION_COOKIE_KEY,
        path: "/",
        sameSite: "lax",
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components can read cookies during render but cannot always
            // write them. Middleware and route handlers will own refresh flows.
          }
        },
      },
    },
  );
}
