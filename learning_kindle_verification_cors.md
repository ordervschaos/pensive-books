# Learning: Kindle verification CORS fix

- **CORS preflight (OPTIONS)** — "pre-flight" = the browser's permission check it flies ahead of the real request. For non-simple cross-origin requests the browser first sends an `OPTIONS` request; the server must answer 2xx with `Access-Control-Allow-*` headers before the browser will send the real `POST`. Here: the call targeted a non-existent function, so the gateway returned a non-200 with no CORS headers → browser reported it as a CORS failure. **A 404 in disguise.**

- **Supabase Edge Function** — a Deno serverless function deployed per-slug. Calling `supabase.functions.invoke("name")` for an undeployed slug fails preflight. Fix = match the deployed slug (`send-kindle-verification`) and its body contract (`{ kindleEmail }`, not `{ email }`).

- **OTP (One-Time Password)** — a short single-use code, here 6 digits, stored server-side (`user_data.kindle_verification_otp`) with a 30-min expiry. Proves the user controls the Kindle inbox the code was emailed to.

- **Server-side verification (vs client-side)** — the OTP check *must* run in the edge function with the service-role key, not in the browser. If the client could read the stored OTP via the table, the "do you own this email" proof collapses. The new `verify-kindle-otp` function checks code + expiry, then flips `kindle_configured = true`.

- **`verify_jwt` gateway flag** — Supabase's function gateway verifies the caller's JWT before invoking, default `true`. Functions not listed in `config.toml` inherit the default; a logged-in `invoke()` auto-attaches the user JWT, which both the gateway and the function's own `getUser()` accept. New function followed the same pattern (no config entry needed).

- **Auth-header self-check pattern** — each Kindle function re-derives the user from `Authorization: Bearer <jwt>` via a service-role client's `auth.getUser()`, rather than trusting body input. Consistent across `send-kindle-verification`, `get-kindle-token`, and the new `verify-kindle-otp`.

## What was actually broken
1. Send button → called non-existent `send-verification-email` (CORS error) with wrong body key.
2. Verify button → called non-existent `verify-email`; the verify function had **never been built**.
3. Nothing in the codebase ever set `kindle_email` / `kindle_configured`, so "send to Kindle" (gated on `kindle_configured` in `BookInfo.tsx`) could never unlock.

## Fix
- Repointed both calls in `KindleSettings.tsx` to real slugs + correct bodies.
- Built + deployed `verify-kindle-otp` to complete the flow (OTP check → set `kindle_email` + `kindle_configured = true` → clear OTP).
