import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_KEY, appOrigin } from "@/lib/pensive";

// Auth gate. This app has NO login UI on purpose: it shares the .pensive.me session cookie with the SPA,
// so "same auth" means literally the same session. If that cookie is absent we bounce to the SPA's
// /auth with a returnTo pointing back here; the SPA owns sign-in AND token refresh, then sends the user
// back with a fresh shared cookie.
//
// Note this only checks for the PRESENCE of the cookie. Validity is checked server-side by
// supabase.auth.getUser() in the pages themselves — a middleware that tried to validate would have to
// refresh, which is exactly the cross-subdomain rotation race we are avoiding.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes authenticate themselves (cron uses a shared secret, not a session).
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // @supabase/ssr chunks large cookies as `<name>.0`, `<name>.1`, … so prefix-match, don't equality-match.
  const signedIn = request.cookies
    .getAll()
    .some((c) => c.name === SESSION_COOKIE_KEY || c.name.startsWith(`${SESSION_COOKIE_KEY}.`));

  if (!signedIn) {
    const returnTo = new URL(request.nextUrl.pathname + request.nextUrl.search, request.nextUrl.origin);
    const login = new URL("/auth", appOrigin());
    login.searchParams.set("returnTo", returnTo.toString());
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
