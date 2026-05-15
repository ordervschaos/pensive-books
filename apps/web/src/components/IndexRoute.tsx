import { Navigate } from "react-router-dom";
import { SESSION_COOKIE_KEY } from "@/integrations/supabase/client";
import { PublicSiteRedirect } from "@/components/PublicSiteRedirect";

// @supabase/ssr stores the session as cookies (default storage). The base
// cookie key is sb-<projectRef>-auth-token; large sessions get chunked into
// .0/.1/... suffixed cookies, so we just check whether any cookie *starts*
// with the base name. We don't validate the token here — stale/expired
// cookies still trigger the redirect, and PrivateRoute catches those on
// /books and bounces to /auth. This match is sync so "/" can decide before
// paint, avoiding a marketing-page flash for logged-in users.
function hasSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  const cookies = document.cookie.split(";");
  return cookies.some((c) => c.trim().startsWith(`${SESSION_COOKIE_KEY}=`)
    || c.trim().startsWith(`${SESSION_COOKIE_KEY}.`));
}

export function IndexRoute() {
  if (hasSessionCookie()) {
    return <Navigate to="/books" replace />;
  }
  return <PublicSiteRedirect path="/" />;
}
