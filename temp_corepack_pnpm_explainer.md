# Why pnpm + what is corepack — explainer

## Why pnpm (instead of npm/yarn)
We're moving to a monorepo (two apps + shared package). All three managers technically support workspaces, but pnpm is preferred because:
- **Disk efficiency** — global content-addressable store, dependencies symlinked, not copied. Common deps (React, etc.) stored once.
- **Stricter resolution** — can't accidentally import transitive deps (a real source of bugs in npm/yarn flat hoisting).
- **Industry default for Next.js monorepos** — Vercel, Stripe, Shopify, Sentry all use it. Path of least friction with the tools we're adopting.

## What corepack is
A tiny shim **built into Node 16.10+**. When you type `pnpm install`, corepack:
1. Reads `"packageManager": "pnpm@9.12.0"` from package.json
2. Downloads that exact pnpm version (only first time)
3. Runs the command with that version

Effect: zero global installs, zero drift between your machine / CI / Vercel.

## Why corepack (instead of `npm install -g pnpm`)
| Problem | Global install | Corepack |
|---|---|---|
| Version pinning | Drifts over time across machines | Locked in package.json |
| Team consistency | Each dev installs separately | One config line, automatic |
| CI/Vercel sync | Can mismatch silently | Always matches local |
| "Works on my machine" bugs | Possible | Eliminated for pm-version issues |

## TL;DR
- **pnpm** = the package manager
- **corepack** = how we get the right pnpm version without a global install

## Status
Awaiting user decision: proceed with corepack? Also still pending: how to handle Vercel deployment after the file restructure (manual project-settings update vs. defer the SPA move).


