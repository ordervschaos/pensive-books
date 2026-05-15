import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasSessionCookie, inferAppOrigin } from "@/lib/pensive";

export function middleware(request: NextRequest) {
  const cookieNames = request.cookies.getAll().map((cookie) => cookie.name);

  if (hasSessionCookie(cookieNames)) {
    const appOrigin = inferAppOrigin(
      request.nextUrl.hostname,
      request.nextUrl.protocol,
    );

    return NextResponse.redirect(new URL("/books", appOrigin));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
