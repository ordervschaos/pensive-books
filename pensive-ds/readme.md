# Pensive — Design System

A token-accurate design system for **Pensive**, an AI-assisted book-writing web app. Built so a
designer *or* Claude Code can recreate any Pensive surface without guessing a value.

This system is a faithful capture of the **real app**: it uses the same shadcn/ui token contract,
the same three themes, the same type families, and the same component variants that ship in
`apps/web`. Where this folder simplifies (e.g. CSS classes instead of React + class-variance-authority),
it is called out so the handoff stays honest.

> **Baseline theme:** `Paper` — the "paper-minimal" redesign direction (warm cream, deep ink, a single
> maroon accent, serif-first UI). Other themes (`Coffee`, `Charcoal`) ride the same tokens.

---

## 1. How to read this folder

```
pensive-ds/
├── readme.md            ← you are here
├── SKILL.md             ← the handoff brief for Claude Code
├── tokens/
│   ├── colors.css       ← THE source of truth — 3 themes × {light,dark} as shadcn HSL channels
│   ├── typography.css   ← font families, scale, helpers (Newsreader / Instrument Serif / JetBrains Mono)
│   └── motion.css       ← radius, spacing, elevation, easing + the AI-progress keyframes
├── styles/
│   └── components.css    ← token-driven recreation of the shadcn components, Pensive-skinned
├── ui-kit.html          ← the components composed into the real authoring surface
└── cards/               ← specimen cards (one concern each) for review
    ├── colors.html · type.html · foundations.html
    ├── buttons.html · forms.html · cards-badges.html · overlays.html · ai-states.html
    └── brand.html
```

**To preview:** open any file in `cards/` or `ui-kit.html`. Every file is self-contained — it links the
token CSS and renders standalone.

**To consume the tokens** in a new page: link the three files in `tokens/`, then put a theme class on
`<html>`:

```html
<link rel="stylesheet" href="tokens/typography.css" />
<link rel="stylesheet" href="tokens/colors.css" />
<link rel="stylesheet" href="tokens/motion.css" />
<html class="theme-paper">        <!-- or "theme-paper dark", "theme-coffee dark", "theme-pumpkin" -->
```

---

## 2. The token contract (most important section)

Pensive uses the **shadcn/ui** convention: every color is a CSS variable holding **HSL channels**
(e.g. `--primary: 0 0% 9%`), consumed as `hsl(var(--primary))`. Tailwind's config maps
`bg-primary`, `text-muted-foreground`, etc. onto these. **Do not introduce raw hex in components** —
read a token, or add one.

| Token | Role |
|---|---|
| `--background` / `--foreground` | page surface / default text |
| `--card` / `--card-foreground` | raised surface |
| `--popover` / `--popover-foreground` | dialogs, menus, toasts |
| `--primary` / `--primary-foreground` | the one commitment per view (dark/ink button, active states) |
| `--secondary` / `--secondary-foreground` | quiet fills, rail background |
| `--muted` / `--muted-foreground` | tracks, dividers / meta + captions |
| `--accent` / `--accent-foreground` | **the brand voice** — maroon on Paper; also "in sync" |
| `--destructive` | delete / danger |
| `--border` · `--input` · `--ring` | hairlines / field borders / focus ring |
| `--radius` | `0.5rem` base → lg(8) / md(6) / sm(4) |

**Themes are classes on `<html>`** (`ThemeProvider` writes them). Light is the bare class; dark adds
`.dark`. Because the variables are scoped to the class, you can also preview a theme inside a single
`<div class="theme-coffee dark">`. The shipped set:

- **Paper** `.theme-paper` / `.theme-paper.dark` — redesign baseline. A `--pv-*` primitive layer feeds
  the shadcn tokens, so the whole app re-skins with no markup change.
- **Coffee** `.theme-coffee` / `.theme-coffee.dark` — the app's first-run default (Coffee Dark).
- **Charcoal** `.theme-pumpkin` / `.theme-pumpkin.dark` — charcoal + pumpkin-orange. (Class is
  `pumpkin`; the UI labels it "Charcoal".)

---

## 3. Content fundamentals

Pensive is a tool for **writing books**, and the UI behaves like one.

- **Serif-first.** On Paper, the interface itself is Newsreader — body, buttons, inputs. This is
  deliberate; it makes the app feel like a manuscript, not a SaaS dashboard.
- **Mono is structural.** JetBrains Mono is reserved for eyebrows, meta, status, and the resolution
  states — never for reading.
- **The resolution ladder is the spine of everything.** Brief → Spine → Outline → (per page)
  Objective → Beat → Prose, plus Voice and Threads alongside. Every artifact is a *node* that is
  **in sync**, **out of sync**, or **empty**. The component language exists to make that legible.
- **The next move is the loudest thing on screen.** Each view has exactly one hero action. Empty
  states invite generation ("re-create from the brief"); they never just apologize for being blank.

See `cards/brand.html` for voice and principles.

---

## 4. Visual foundations

- **Type** → `cards/type.html`. Three families; scale from 11px mono eyebrow to 40px display.
- **Color** → `cards/colors.html`. All six theme/mode combinations, side by side.
- **Geometry & motion** → `cards/foundations.html`. Radius math, two-stop elevation, the spacing
  rhythm, and the two AI-progress patterns (`animate-pv-sweep` indeterminate, `animate-progress`
  determinate-ish).

**Motion rule:** never gate visible content behind an `opacity: 0` entrance animation. Entrance
keyframes animate transform only, and all decorative motion is disabled under
`prefers-reduced-motion`.

---

## 5. Iconography

Pensive uses **lucide-react** (the shadcn default), stroke style, ~1.5–1.6px at 16–20px. The cards
draw inline SVGs in that style as stand-ins. When building in the real app, import the named lucide
icon rather than copying these paths. Common ones in this surface: `Sparkles` (generate), `ArrowRight`
(advance), `Check` (approve/done), `Lock` (gated), `Pencil` (edit), `RefreshCw` (restart/regenerate),
`Eye` (read), `Search`, `MoreHorizontal`, `Triangle`/`AlertTriangle` (stalled).

---

## 6. Components

`styles/components.css` is the token-driven contract; `ui-kit.html` shows them composed. Each
`cards/*.html` documents one group with live states and an anatomy table:

| Card | Covers |
|---|---|
| `buttons.html` | Button (7 variants × 3 sizes, disabled) · IconButton |
| `forms.html` | Input · Textarea · **tone chips** (signature multi-select) · Switch · Segmented |
| `cards-badges.html` | Card · Badge · **resolution node states** (sync / out-of-sync / empty) |
| `overlays.html` | Tabs · Dialog · DropdownMenu (theme switcher) · Toast |
| `ai-states.html` | Build stepper (done/now/locked) · run working · run **stalled + recovery** |

> **Fidelity note:** in the real codebase these are React components under `@pensive/shared/ui/*`
> using `class-variance-authority`. This folder recreates their *appearance* with plain classes so the
> system is previewable and Claude Code has an exact visual + token reference. Prop names in each
> anatomy table match the React API.

---

## 7. For developer handoff

Read **`SKILL.md`** — it tells Claude Code exactly how to build a new Pensive surface: which tokens to
read, which theme to assume, the component APIs, and the non-negotiables (serif UI, token-only color,
one hero action, honest resolution states, reduced-motion safety).
