# Cookie Consent: Cross-Subdomain Fix

## Problem
Both `pensive.me` and `app.pensive.me` had separate cookie banners because consent was stored in `localStorage`, which is scoped per origin. Users would see the banner twice — once on the marketing site, once after clicking "Start writing".

## Fix
Replaced `localStorage` with a browser cookie scoped to `.pensive.me` (the shared parent domain). Both subdomains can now read and write the same consent signal.

## Files changed
- `apps/marketing/lib/cookie-consent.ts` — rewritten `readConsent` / `writeConsent` to use `document.cookie` with `domain=.pensive.me`
- `apps/web/src/hooks/useCookieConsent.ts` — same change

## Key details
- Cookie: `pensive.cookie-consent=accepted|rejected`
- Domain: `.pensive.me` in production; no domain attribute on localhost (falls back to host-scoped)
- `max-age`: 1 year; `SameSite=Lax; Secure` on HTTPS
- **Migration**: on first load, if the cookie is absent but localStorage has a value, it's migrated to the cookie and removed from localStorage — so existing users won't see the banner again
- Removed `StorageEvent` listener (was localStorage-specific, no longer needed)
- `clearAnalyticsCookies` unchanged — it already derived domains from `window.location.hostname`
