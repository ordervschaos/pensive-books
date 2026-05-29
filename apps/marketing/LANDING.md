# Updating the landing page

The landing page (`app/page.tsx`) is **data-driven**. When a feature ships, you
update a manifest — you almost never edit `page.tsx` itself.

## The shape

```
lib/landing-content.tsx          ← the manifest (edit this)
components/landing/
  ├─ FeatureSection.tsx          ← renders one spotlight feature (copy + mock)
  ├─ UIFrame.tsx                 ← the shared "app window" chrome for mocks
  └─ mocks/                      ← one mini-UI component per spotlight feature
       ├─ GenerateMock.tsx
       ├─ EditorMock.tsx
       ├─ EvaluationMock.tsx
       └─ PublishMock.tsx
app/page.tsx                     ← hero + .map(LANDING_FEATURES) + extras + CTAs
```

`page.tsx` maps over two arrays from the manifest:

- **`LANDING_FEATURES`** — spotlight features. Each gets a full alternating
  section with a mini-UI mock.
- **`LANDING_EXTRAS`** — smaller capabilities. Each is one line in the
  "And more" grid.

## Design rules (keep parity + SEO)

- **Paper design only.** Use the tokens and type helpers, never raw shadcn
  colours or `font-serif`:
  - Type: `pv-display` (headlines), `pv-serif` (body), `pv-eyebrow` (kickers),
    `pv-mono` (labels), `pv-sans` (buttons).
  - Colour: `text-foreground`, `text-[hsl(var(--pv-text-muted))]`,
    `text-[hsl(var(--pv-text-faint))]`, `text-[hsl(var(--pv-accent))]`,
    surfaces `bg-[hsl(var(--pv-surface))]` / `bg-[hsl(var(--pv-surface-2))]`,
    `border-border`.
  - `/library/page.tsx` is the reference for the idiom.
- **No screenshots.** Show the UI with a mock component (see below), not an
  image. Mocks read as real text → crawlable + accessible.
- **Stay static.** Every mock is a pure server component — **no `"use client"`,
  no hooks, no state.** CSS-only motion (e.g. `animate-pulse`) is fine. This
  keeps the page statically generated, which is the marketing site's priority.

## To add a SPOTLIGHT feature

1. **Build a mock** in `components/landing/mocks/<Name>Mock.tsx`. Copy the
   closest existing mock and wrap content in `<UIFrame crumb="…">` (this
   supplies the real Pensive app chrome). Aim for **high fidelity** — open the
   real screen in `apps/web/src/...`, then reproduce its layout, controls, and
   copy patterns with paper tokens + `lucide-react` icons (do **not** import the
   web app's CSS — keep the mock self-contained so the page stays static). Reuse
   real shared components from `@pensive/shared/ui` (e.g. `BookCard`) when cheap.
   Each mock's doc comment notes the `apps/web` file it mirrors — keep that link.
2. **Add an entry** to `LANDING_FEATURES` in `lib/landing-content.tsx`:
   `{ id, eyebrow, title, blurb, bullets?, mock }`. Order in the array = order
   on the page; sides alternate automatically.
3. Done. No change to `page.tsx`.

## To add a SMALLER feature

Add one `{ title, blurb }` object to `LANDING_EXTRAS`. That's it.

## Anchoring the mock to reality

Mocks should reflect the real data the feature produces. The eval mock, for
example, mirrors the `EvalResult` shape in
`apps/web/src/components/book/BookEvaluationSection.tsx` (verdict + letter grade
+ page-anchored priorities + "Apply the editor's notes"). When the underlying
feature changes shape, update the matching mock so it stays honest.

## Verify

```
pnpm --filter @pensive/marketing build      # SSG type-check + build
pnpm dev:marketing                           # eyeball at localhost:3000
```
