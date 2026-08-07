export const SUPABASE_PROJECT_ID = "qiqeyirtpstdjkkeyfss";
export const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAyODg2MzEsImV4cCI6MjA1NTg2NDYzMX0.mmpSshpUG_kE58h7kDBMt-X5jjsKhhcKL9QpZi7i4uk";
export const SESSION_COOKIE_KEY = `sb-${SUPABASE_PROJECT_ID}-auth-token`;

const LOCAL_APP_ORIGIN = "http://localhost:8080";
const PROD_APP_ORIGIN = "https://app.pensive.me";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getConfiguredAppOrigin() {
  if (process.env.PENSIVE_APP_ORIGIN) {
    return trimTrailingSlash(process.env.PENSIVE_APP_ORIGIN);
  }

  return process.env.NODE_ENV === "development"
    ? LOCAL_APP_ORIGIN
    : PROD_APP_ORIGIN;
}

export function inferAppOrigin(hostname: string, protocol: string) {
  if (process.env.PENSIVE_APP_ORIGIN) {
    return trimTrailingSlash(process.env.PENSIVE_APP_ORIGIN);
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return LOCAL_APP_ORIGIN;
  }

  if (hostname === "pensive.me" || hostname === "www.pensive.me" || hostname === "studio.pensive.me") {
    return PROD_APP_ORIGIN;
  }

  return `${protocol}//app.${hostname}`;
}

export function hasSessionCookie(cookieNames: string[]) {
  return cookieNames.some(
    (name) =>
      name === SESSION_COOKIE_KEY ||
      name.startsWith(`${SESSION_COOKIE_KEY}.`),
  );
}

export function slugifyIdTitle(id: number, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug ? `${id}-${slug}` : String(id);
}
