import { Navigate } from "react-router-dom";
import { hasSessionCookie } from "@/integrations/supabase/client";
import { PublicSiteRedirect } from "@/components/PublicSiteRedirect";

export function IndexRoute() {
  // Some OAuth flows (notably mobile) redirect back to the site root with the
  // PKCE `?code=` (or an `?error=`) instead of /auth/callback. Hand those to
  // the callback route — a same-origin SPA navigation that keeps the
  // code-verifier cookie intact — rather than bouncing to the marketing site.
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);
  if (params.has("code") || params.has("error") || params.has("error_description")) {
    return <Navigate to={`/auth/callback${search}`} replace />;
  }

  if (hasSessionCookie()) {
    return <Navigate to="/books" replace />;
  }
  return <PublicSiteRedirect path="/" />;
}
