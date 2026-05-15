import { lazy } from "react";
import { Navigate } from "react-router-dom";
import { SUPABASE_PROJECT_ID } from "@/integrations/supabase/client";

const Landing = lazy(() => import("@/pages/public/landing/Landing"));

// Supabase v2 persists the session under this localStorage key by default.
// Reading it synchronously lets us decide where "/" should go before paint —
// avoiding a marketing-page flash for logged-in users. Stale/expired tokens
// are still caught downstream by PrivateRoute on /books.
const SESSION_STORAGE_KEY = `sb-${SUPABASE_PROJECT_ID}-auth-token`;

function hasStoredSession(): boolean {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!parsed?.access_token;
  } catch {
    return false;
  }
}

export function IndexRoute() {
  if (hasStoredSession()) {
    return <Navigate to="/books" replace />;
  }
  return <Landing />;
}
