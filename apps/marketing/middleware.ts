import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasSessionCookie, inferAppOrigin } from "@/lib/pensive";

const AUTH_CALLBACK_PARAMS = ["code", "error", "error_code", "error_description"];

export function middleware(request: NextRequest) {
  const appOrigin = inferAppOrigin(
    request.nextUrl.hostname,
    request.nextUrl.protocol,
  );

  const hasAuthCallbackParam = AUTH_CALLBACK_PARAMS.some((param) =>
    request.nextUrl.searchParams.has(param),
  );

  if (hasAuthCallbackParam) {
    const callbackUrl = new URL("/auth/callback", appOrigin);
    callbackUrl.search = request.nextUrl.search;
    callbackUrl.hash = request.nextUrl.hash;
    return NextResponse.redirect(callbackUrl);
  }

  const cookieNames = request.cookies.getAll().map((cookie) => cookie.name);
  const isStudioHost = request.nextUrl.hostname === "studio.pensive.me";

  if (hasSessionCookie(cookieNames)) {
    return NextResponse.redirect(new URL(isStudioHost ? "/studio" : "/books", appOrigin));
  }

  // studio.pensive.me is a second custom domain on this same Vercel project (no separate
  // app/deploy) — logged-out visitors get the Studio-only pitch instead of the main site.
  if (isStudioHost) {
    return NextResponse.rewrite(new URL("/studio-landing", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
