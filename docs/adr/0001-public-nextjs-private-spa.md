# ADR 0001: Public Next.js App, Private Vite SPA

## Status
Accepted

## Decision
Use a split architecture:

- `apps/marketing` is the public-facing Next.js app.
- `apps/web` remains the authenticated Vite SPA for authoring and in-app workflows.

Public, SSR-worthy routes move to Next.js:

- `/`
- `/library`
- `/library/books/:slug`
- `/library/books/:slug/pages/:pageSlug`
- `/u/:username`

Authenticated app routes stay in the SPA:

- `/books/*`
- `/settings/*`
- editor, chat, flashcards, generate, versions, and other private workflows

Supabase auth is shared via cookies so the public app can redirect logged-in users server-side and the private app can keep the existing client-side session model.

## Why

- Public pages need SSR/SSG for SEO, Open Graph tags, and fast first paint.
- The authoring app does not materially benefit from SSR.
- A full-framework migration would add cost and risk across the editor and other private flows without proportional payoff.
- Keeping the public surface separate reduces blast radius and lets public routes be ported incrementally.

## Consequences

- Public route ports should preserve existing designs unless explicitly redesigned.
- Cross-app links must target the correct origin while the migration is in progress.
- Auth cookie behavior is part of shared platform infrastructure and must remain compatible across both apps.
