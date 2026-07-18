
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

export const SUPABASE_PROJECT_ID = 'qiqeyirtpstdjkkeyfss';
// Exported so callers that must bypass supabase-js (e.g. dnaExpand.ts's raw fetch to stream-prose,
// which needs a real ReadableStream reader — supabase.functions.invoke() awaits the whole body)
// can still set the "apikey" header Kong requires to route the request to this project.
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAyODg2MzEsImV4cCI6MjA1NTg2NDYzMX0.mmpSshpUG_kE58h7kDBMt-X5jjsKhhcKL9QpZi7i4uk';
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

// =========================================================================
// TEMP DIAGNOSTICS — investigating "Invalid Refresh Token: Already Used"
// storm. Remove once the root cause is found.
// =========================================================================
if (typeof window !== "undefined") {
  const tag = "[AUTH-DEBUG]";
  const tabId = Math.random().toString(36).slice(2, 8);
  const t0 = performance.now();
  const ts = () => `${((performance.now() - t0) / 1000).toFixed(2)}s`;
  const previewToken = (s?: string | null) =>
    s ? `${s.slice(0, 6)}…${s.slice(-4)} (len=${s.length})` : String(s);
  const snapshotCookies = () =>
    document.cookie
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c.startsWith("sb-"))
      .map((c) => {
        const eq = c.indexOf("=");
        return { name: c.slice(0, eq), valuePreview: previewToken(c.slice(eq + 1)) };
      });

  console.log(tag, "init", {
    tabId,
    href: window.location.href,
    hostname: window.location.hostname,
    cookieOptions: getCookieOptions(),
    visible: document.visibilityState,
    hasNavLocks: typeof (navigator as { locks?: unknown }).locks !== "undefined",
    initialCookies: snapshotCookies(),
  });

  // 1) Patch fetch to log every /auth/v1/token call with stack + body.
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const isTokenCall = typeof url === "string" && url.includes("/auth/v1/token");

    if (isTokenCall) {
      let bodyPreview: unknown = "(no body)";
      const body = init?.body;
      if (typeof body === "string") {
        try {
          const parsed = JSON.parse(body);
          bodyPreview = {
            ...parsed,
            refresh_token: previewToken(parsed.refresh_token),
            code: previewToken(parsed.code),
            code_verifier: previewToken(parsed.code_verifier),
          };
        } catch {
          bodyPreview = body.slice(0, 200);
        }
      }
      console.log(tag, "fetch /token →", {
        tabId,
        t: ts(),
        url,
        grantType: new URL(url, window.location.origin).searchParams.get("grant_type"),
        body: bodyPreview,
        cookiesAtRequest: snapshotCookies(),
        stack: new Error().stack?.split("\n").slice(2, 12).join("\n"),
      });
    }

    const res = await origFetch(input as RequestInfo, init);

    if (isTokenCall) {
      const cloned = res.clone();
      let responseBody: unknown = "(unread)";
      try {
        responseBody = await cloned.json();
        if (responseBody && typeof responseBody === "object") {
          const r = responseBody as Record<string, unknown>;
          responseBody = {
            ...r,
            access_token: previewToken(r.access_token as string | undefined),
            refresh_token: previewToken(r.refresh_token as string | undefined),
          };
        }
      } catch {
        try {
          responseBody = await cloned.text();
        } catch {
          /* ignore */
        }
      }
      console.log(tag, "fetch /token ←", {
        tabId,
        t: ts(),
        status: res.status,
        body: responseBody,
        cookiesAfter: snapshotCookies(),
      });
    }

    return res;
  };

  // 2) Global auth-state listener separate from any component listeners.
  supabase.auth.onAuthStateChange((event, session) => {
    console.log(tag, "onAuthStateChange", {
      tabId,
      t: ts(),
      event,
      hasSession: !!session,
      accessToken: previewToken(session?.access_token),
      refreshToken: previewToken(session?.refresh_token),
      expiresAt: session?.expires_at,
      expiresInSec: session?.expires_at
        ? session.expires_at - Math.floor(Date.now() / 1000)
        : null,
      visible: document.visibilityState,
      cookies: snapshotCookies(),
    });
  });

  // 3) Tab visibility — refresh storms often correlate with tab focus.
  document.addEventListener("visibilitychange", () => {
    console.log(tag, "visibilitychange", {
      tabId,
      t: ts(),
      state: document.visibilityState,
      cookies: snapshotCookies(),
    });
  });

  // 4) Storage events — fires when another tab on the same origin writes localStorage.
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.includes("sb-")) {
      console.log(tag, "storage event (other tab wrote localStorage)", {
        tabId,
        t: ts(),
        key: e.key,
        oldValue: previewToken(e.oldValue),
        newValue: previewToken(e.newValue),
      });
    }
  });

  // 5) PANIC CLEAR — when we see a refresh fail (400 / 401 / 403), nuke every
  // sb-* cookie across all plausible domain/path combos so a stale duplicate
  // (e.g. an old host-only cookie that supabase-ssr's clear missed because it
  // was written with a different Domain attribute) can't keep getting replayed.
  // This is a last-resort circuit breaker — only fires on actual refresh
  // failures, not on regular getSession() calls.
  let panicCleared = false;
  const hostname = window.location.hostname;
  const candidateDomains = [
    "",
    hostname,
    hostname.startsWith(".") ? hostname : `.${hostname}`,
    ...(hostname.endsWith(".pensive.me") ? [".pensive.me", "pensive.me"] : []),
  ];

  function panicClearAuthCookies(reason: string) {
    if (panicCleared) return;
    panicCleared = true;

    const cookiesBefore = snapshotCookies();
    const namesToClear = new Set<string>();
    for (const c of document.cookie.split(";")) {
      const name = c.trim().split("=")[0];
      if (name.startsWith("sb-")) namesToClear.add(name);
    }
    // Also clear known-by-name chunk variants in case parse() collapsed dupes.
    const base = SESSION_COOKIE_KEY;
    namesToClear.add(base);
    namesToClear.add(`${base}-code-verifier`);
    for (let i = 0; i < 10; i++) {
      namesToClear.add(`${base}.${i}`);
      namesToClear.add(`${base}-code-verifier.${i}`);
    }

    for (const name of namesToClear) {
      for (const domain of candidateDomains) {
        const attrs = [
          `${name}=`,
          "expires=Thu, 01 Jan 1970 00:00:00 GMT",
          "path=/",
          ...(domain ? [`domain=${domain}`] : []),
        ].join("; ");
        document.cookie = attrs;
      }
    }

    console.warn(tag, "panic-clear executed", {
      tabId,
      t: ts(),
      reason,
      namesCleared: [...namesToClear],
      cookiesBefore,
      cookiesAfter: snapshotCookies(),
    });
  }

  // Wire panic-clear into the fetch wrapper response handling. Re-patch fetch
  // by wrapping the already-wrapped version once more so failure detection
  // sits on top of the request/response logging.
  const fetchAfterLogging = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetchAfterLogging(input as RequestInfo, init);
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const isRefreshCall =
      typeof url === "string" &&
      url.includes("/auth/v1/token") &&
      url.includes("grant_type=refresh_token");
    if (isRefreshCall && (res.status === 400 || res.status === 401)) {
      panicClearAuthCookies(`refresh ${res.status}`);
    }
    return res;
  };

  // Expose a manual handle for the user to call from DevTools if needed.
  (window as unknown as { __pensiveClearAuth?: () => void }).__pensiveClearAuth =
    () => panicClearAuthCookies("manual-from-devtools");
}
