# Theme System — Pensive

## 1. Where it lives

```
apps/web/
├── index.html                         ← inline script that runs BEFORE paint (anti-flash)
└── src/
    ├── App.tsx                        ← mounts <ThemeProvider> wrapping the whole app
    └── components/theme/
        ├── ThemeProvider.tsx          ← brain: state, storage, context
        └── ThemeSwitcher.tsx          ← hands: UI components to change theme
```

Consumers (components that read theme state via `useTheme`):
- `NavActions.tsx` — renders `<ThemeSwitcher>` in the top nav
- `PageSettingsDrawer.tsx` — lets users pick theme inside a page
- `LibraryNav.tsx` — reads theme state

---

## 2. Simple summary

The theme system controls two things:

| Dimension  | Options                                 | Stored as     |
|------------|-----------------------------------------|---------------|
| **Name**   | `default` `coffee` `mujiyish` `pumpkin` | `themeName`   |
| **Mode**   | `light` `dark`                          | `themeMode`   |

These two values get translated into CSS classes on `<html>`, which CSS variables pick up to change every colour on screen.

---

## 3. Why it matters

CSS variables like `--background`, `--foreground`, `--accent`, etc. are defined per-class on `<html>`. Every Tailwind class (`bg-background`, `text-foreground`, `border`) reads those variables. So the theme system is the single dial that repaints the entire app without touching any component code.

Without it, you'd have to pass colour props through every component manually.

---

## 4. The system

```
User picks theme
      │
      ▼
ThemeSwitcher (UI)
      │  calls setThemeName / setThemeMode
      ▼
ThemeProvider (state)
      │  setState → triggers useEffect
      ▼
document.documentElement.classList
      │  sets e.g. "dark theme-coffee"
      ▼
CSS variables resolve
      │  --background: ... / --foreground: ...
      ▼
Every styled component repaints
```

**Storage layer** (read on init, write on every change):

```
Cookie  ──┐
           ├── readTheme() / writeTheme()  ← ThemeProvider uses both
localStorage ──┘
```

Cookies are primary because they're shared across subdomains (`*.pensive.me`). localStorage is the fallback for local dev.

**Defaults** (set in `App.tsx`):
```tsx
<ThemeProvider defaultTheme="coffee" defaultMode="dark">
```
So a brand-new user who has never touched the switcher starts on Coffee Dark.

---

## 5. Picture

```
index.html <head>
┌─────────────────────────────────────────────────────┐
│  <script> (inline, runs before paint)               │
│    reads cookie → localStorage → system pref        │
│    sets class="dark theme-coffee" on <html>         │
└─────────────────────────────────────────────────────┘
                        │
                        ▼  (no flash — classes already applied)
┌─────────────────────────────────────────────────────┐
│  React mounts                                       │
│  └── <ThemeProvider>  ← reads same storage, sets   │
│        state = { themeName, themeMode }             │
│        ↕ Context                                    │
│  └── <ThemeSwitcher>  ← user changes theme          │
│        └── calls setThemeName / setThemeMode        │
│              → ThemeProvider updates <html> class   │
│              → writes back to cookie + localStorage │
└─────────────────────────────────────────────────────┘
```

**The flash problem (solved):**  
Without the inline script, `<html>` had no class until React's `useEffect` ran — which happens *after* the first browser paint. That 1-frame window caused the button (and page colours) to flash. The inline `<script>` in `<head>` closes that gap by applying classes synchronously.

---

## 6. Adding a new theme

1. Add the name to the `ThemeName` union in `ThemeProvider.tsx`
2. Add CSS variables for `.theme-yourname.light` and `.theme-yourname.dark` in your global CSS
3. Add an entry to the `themes` array in `ThemeSwitcher.tsx`
4. Update the `classList.remove(...)` call in `ThemeProvider.tsx` to include `"theme-yourname"`
5. Update the inline script in `index.html` if you need it applied before React loads

---

## Key files at a glance

| File | Role |
|------|------|
| `index.html` | Inline script — prevents flash by applying classes before paint |
| `ThemeProvider.tsx` | Context, state, storage (cookie + localStorage), class application |
| `ThemeSwitcher.tsx` | `<ThemeSwitcher>` dropdown + `<ThemeModeToggle>` simple button |
| `App.tsx:94` | Where `<ThemeProvider>` is mounted with app-wide defaults |
