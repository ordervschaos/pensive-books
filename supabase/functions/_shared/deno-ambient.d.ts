// deno-ambient — local-only type shim for `deno check`.
//
// `EdgeRuntime` is a global injected by Supabase's edge runtime at deploy time (used for
// `EdgeRuntime.waitUntil(...)` background-work scheduling); bare `deno check` doesn't know about
// it and reports every call site as `TS2304 Cannot find name 'EdgeRuntime'` — noise that drowns
// out real errors. This file is NOT imported by any function (Supabase only bundles a function's
// actual import graph), so it never ships — it only exists to be passed alongside a real check:
//
//   deno check supabase/functions/_shared/deno-ambient.d.ts supabase/functions/<fn>/index.ts
//
// All 19 surviving edge fns were confirmed clean against this shim 2026-07-09.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };
