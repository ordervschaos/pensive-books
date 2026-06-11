# SKILL — Building a Pensive surface

You are building UI for **Pensive**, an AI-assisted book-writing web app. This skill makes your output
match the real product. Read it before generating any Pensive screen, component, or page.

## Stack reality
- **React + Tailwind + shadcn/ui.** Components live under `@pensive/shared/ui/*` and use
  `class-variance-authority` for variants. Prefer composing existing shadcn components over new CSS.
- **Tokens are shadcn HSL channels.** Every color is `hsl(var(--token))`. The authoritative values are
  in `tokens/colors.css`. **Never hardcode hex in a component.** If you need a color, it already exists
  as a token — or add one to all theme blocks at once.
- **Theming is a class on `<html>`** (managed by `ThemeProvider`): `theme-paper`, `theme-coffee`,
  `theme-pumpkin`, each optionally with `dark`. Default new work to **`theme-paper`** unless told
  otherwise. Test in at least Paper light + one dark theme.

## Non-negotiables (these are what make it *Pensive*, not generic shadcn)
1. **Serif-first UI.** On Paper the interface is set in `var(--font-serif)` (Newsreader) — including
   buttons and inputs. Use `var(--font-mono)` (JetBrains Mono) **only** for eyebrows, meta, status, and
   resolution labels. Use `var(--font-display)` (Instrument Serif) for the wordmark and large titles.
2. **Color comes from tokens only.** `--accent` is the brand's single voice (maroon on Paper) and also
   means "in sync." `--primary` (ink/dark) is the one prominent commitment per view.
3. **One hero action per view.** The single most useful next move is visually dominant (the `.hero`
   card pattern). Everything else is `ghost`/`outline`. Don't scatter primary buttons.
4. **Honest state.** "Done / ready / locked" must reflect real data (does the artifact exist?). The
   only stored progress flag is **approval** per gated step. Never fake progress.
5. **Empty states invite generation.** Dashed border, italic muted prompt ("Empty — re-create from the
   brief"), and a generate affordance. Never a dead blank.
6. **Resolution states are a fixed vocabulary:** `in sync` (solid `--accent` pip), `out of sync` (amber
   `hsl(38 80% 50%)` pip), `empty` (1.5px ring on `--border`). Reuse them; don't invent new statuses.
7. **Calm motion.** Restrained transitions; the two AI patterns are `animate-pv-sweep` (indeterminate)
   and `animate-progress` (determinate-ish). **Never** gate visible content behind `opacity:0`
   entrance animation — animate transform only, and respect `prefers-reduced-motion`.

## Geometry & spacing
- Radius: `--radius: 0.5rem` → cards/dialogs `lg` (8), buttons/inputs `md` (6), chips `sm` (4), tone
  chips & badges `pill`.
- Elevation: two stops — `--shadow-card` (resting) and `--shadow-pop` (overlays). Warm, low-contrast.
- Spacing: Tailwind 4px scale; card padding ~24px, section gaps ~40px.

## Component APIs (match these props)
- **Button** — `variant: default | secondary | outline | ghost | accent | destructive | link`,
  `size: sm | default | lg`. Default = ink/primary. `accent` is reserved for generative "re-create".
- **IconButton** — 40×40 hit target, ghost by default. lucide icon, 18px.
- **Input / Textarea** — border `--input`, focus ring `--ring/0.08`. Textarea line-height 1.65.
- **Tone chips** — multi-select pill toggles; `on` = `--primary` fill. User-extendable.
- **Card** — `--card` bg, `--border`, radius lg. Optional `--shadow-card`.
- **Badge** — `variant: default | secondary | outline | accent`; mono 10px uppercase.
- **Tabs / Dialog / DropdownMenu / Switch / Toast** — standard shadcn; skinned by tokens. Toast copy
  is written in the product's literary voice (see `cards/brand.html`).
- **Build stepper / RunCard** — see `cards/ai-states.html`. Steps are `done | active(now) | locked`.
  Runs are `working` (sweep + spinner, cancel) or `stalled` (amber, **Restart keeps partial work**).

## The model you're building against
The book is refined down a **resolution ladder**: Brief → Spine → Outline → per-page (Objective →
Beat → Prose), with Voice and Threads alongside; Read / Revise / Publish are post-draft. Generation is
**pilot → continue → all** (write one to verify, then go page-by-page or all at once), and each layer
revises in its own section while the dedicated **Revise** step is the whole-book pass. Keep this mental
model visible in any build surface you produce.

## Before you ship
- Did you use serif for UI text and mono only for labels?
- Is every color a token? Any stray hex?
- Exactly one hero action?
- Do empty/locked/stalled states look intentional?
- Does it survive Paper-light, a dark theme, and reduced-motion?
- For a ~150-page book: does the per-page UI stay scannable (collapse, jump-to)?
