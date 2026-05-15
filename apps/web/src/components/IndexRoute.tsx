import { Navigate } from "react-router-dom";
import { hasSessionCookie } from "@/integrations/supabase/client";
import { PublicSiteRedirect } from "@/components/PublicSiteRedirect";

export function IndexRoute() {
  if (hasSessionCookie()) {
    return <Navigate to="/books" replace />;
  }
  return <PublicSiteRedirect path="/" />;
}
