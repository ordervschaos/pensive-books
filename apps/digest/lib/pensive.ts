// Shared-project constants. Same Supabase project as app.pensive.me — same auth.users, same Mailgun
// sender, same OTP-verified kindle addresses — but its own tables (digests / digest_issues /
// digest_items_seen) and its own UI. See doc_1785565352472.md §"separate at which seam".
//
// The anon key is a public credential (RLS is the real boundary), which is why it is checked in here
// exactly as apps/marketing does rather than living in env.

export const SUPABASE_PROJECT_ID = "qiqeyirtpstdjkkeyfss";
export const SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcWV5aXJ0cHN0ZGpra2V5ZnNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAyODg2MzEsImV4cCI6MjA1NTg2NDYzMX0.mmpSshpUG_kE58h7kDBMt-X5jjsKhhcKL9QpZi7i4uk";

// The ONE session cookie shared across *.pensive.me. Reading it is what makes "same auth" free: sign in
// once at app.pensive.me and digest.pensive.me already knows who you are.
export const SESSION_COOKIE_KEY = `sb-${SUPABASE_PROJECT_ID}-auth-token`;

const LOCAL_APP_ORIGIN = "http://localhost:8080";
const PROD_APP_ORIGIN = "https://app.pensive.me";

export function appOrigin(): string {
  const configured = process.env.PENSIVE_APP_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");
  return process.env.NODE_ENV === "development" ? LOCAL_APP_ORIGIN : PROD_APP_ORIGIN;
}

export function digestOrigin(): string {
  const configured = process.env.PENSIVE_DIGEST_ORIGIN;
  if (configured) return configured.replace(/\/+$/, "");
  return process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://digest.pensive.me";
}

// The domain Mailgun's inbound route accepts mail for. Separate from MAILGUN_DOMAIN (the SENDING domain,
// which is on Amazon's approved-sender list and must not be changed casually) — receiving and sending can
// live on the same domain, but the two settings answer to different owners, so they get different vars.
export function inboxDomain(): string {
  return process.env.MAILGUN_INBOUND_DOMAIN || process.env.MAILGUN_DOMAIN || "";
}

/**
 * A digest's inbound address. `read+<token>@domain` — the plus-part is what the webhook routes on, so one
 * catch-all Mailgun route serves every digest that will ever exist.
 */
export function inboxAddress(token: string | null | undefined): string | null {
  const domain = inboxDomain();
  return token && domain ? `read+${token}@${domain}` : null;
}

// Is this host allowed to share the .pensive.me cookie? (localhost never is — no shared parent domain.)
export function isSharedDomain(hostname: string): boolean {
  return hostname === "pensive.me" || hostname.endsWith(".pensive.me");
}
