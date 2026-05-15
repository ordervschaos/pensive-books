
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

export const SUPABASE_PROJECT_ID = 'qiqeyirtpstdjkkeyfss';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAyODg2MzEsImV4cCI6MjA1NTg2NDYzMX0.mmpSshpUG_kE58h7kDBMt-X5jjsKhhcKL9QpZi7i4uk';
const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

// The Supabase v2 cookie key follows this pattern. Exporting so other
// modules (e.g. IndexRoute) can read the session synchronously without
// duplicating the project ref.
export const SESSION_COOKIE_KEY = `sb-${SUPABASE_PROJECT_ID}-auth-token`;

// Synchronous best-effort check for an existing session. Large sessions get
// chunked into .0/.1/... suffixed cookies, so we match any cookie that
// starts with the base name. The token is not validated — a stale cookie
// can produce a false positive that gets corrected once getSession() runs.
export function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  const cookies = document.cookie.split(";");
  return cookies.some((c) => {
    const trimmed = c.trim();
    return trimmed.startsWith(`${SESSION_COOKIE_KEY}=`)
      || trimmed.startsWith(`${SESSION_COOKIE_KEY}.`);
  });
}

function getCookieOptions() {
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const isSharedProductionDomain =
    hostname === "pensive.me" || hostname.endsWith(".pensive.me");

  return {
    name: SESSION_COOKIE_KEY,
    path: "/",
    sameSite: "lax" as const,
    secure: isSharedProductionDomain,
    ...(isSharedProductionDomain ? { domain: ".pensive.me" } : {}),
  };
}

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
//
// createBrowserClient persists the session in cookies (default) instead of
// localStorage. This is required so a future Next.js app on a shared parent
// domain can read the same session server-side.
export const supabase = createBrowserClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    // Once marketing and app live on sibling subdomains, auth cookies must be
    // readable from both. On localhost we keep host-only cookies so dev on
    // ports 3000/8080 still works without a custom domain.
    cookieOptions: getCookieOptions(),
  }
);
