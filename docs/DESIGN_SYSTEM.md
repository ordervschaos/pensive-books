# Pensive Design System — Rules of Use

A living doc. Defines **how to use** the tokens and components that already exist in the codebase. Companion to `THEME_SYSTEM_COMPLETE.md`, which defines what tokens *are*.

> **Scope:** color tokens, component variants, layout patterns, anti-patterns. The goal is consistency *across themes* — rules here must hold whether the active theme is default, coffee, muji, or pumpkin.

---

## 1. The four themes are real

The app supports **default, coffee, muji, pumpkin** — each with light + dark. Two implications:

1. **Never hardcode a hex color in a component.** A coral that looks great on pumpkin will be wrong on muji. Always go through tokens.
2. **Don't pick tokens by their *appearance* in your dev theme.** Pick by *role*. `bg-primary` is "the brand action color" — it happens to be orange in pumpkin, brown in coffee, maroon in muji. The rule "use `bg-primary` for the page's primary action" works in all four.

If you find yourself wanting a color that doesn't exist as a token, the answer is *almost never* "add a hex." It's: pick the closest token, or — if a real new role exists — add a token to all four themes in `src/index.css`.

---

## 2. Color token roles

| Token | Role | Use for | **Don't** use for |
|---|---|---|---|
| `bg-background` / `text-foreground` | Page surface + body text | The default page bg and text. | Cards, popovers, anything elevated. |
| `bg-card` / `text-card-foreground` | Elevated surface | Card bodies, the book hero, panels. | Anything full-bleed. |
| `bg-popover` / `text-popover-foreground` | Floating layer | Dropdowns, tooltips, command menus. | In-flow elements. |
| `bg-primary` / `text-primary-foreground` | **Brand action** | The page's *single* primary verb. | Two CTAs in one view. State indicators. |
| `bg-secondary` / `text-secondary-foreground` | Quiet surface | Subtle pills, neutral chips, inactive tabs. | Text body. |
| `bg-muted` / `text-muted-foreground` | Tertiary content | Metadata, captions, "Updated 2m ago", placeholders. | Primary actions. |
| `bg-accent` / `text-accent-foreground` | Hover/active state | `hover:bg-accent` on ghost buttons; selected nav item bg. | A standalone color. The accent is a *state*, not a fill. |
| `bg-destructive` / `text-destructive-foreground` | Destructive action | Delete confirms, error toasts, danger CTA. | Warnings (use `muted` + icon). |
| `border` / `border-input` / `ring` | Edges + focus | All borders, input fields, focus rings. | Dividers between sections (use `border` or `border/50`). |
| `text-link` | Hyperlinks | Inline links inside body content. | Buttons. |
| `bg-image-overlay` / `text-image-overlay-*` | Text on photo | Title overlays on book covers, hero images. | Anywhere there's no image behind. |

### One-action rule

> **A single view has one `bg-primary` button. Maximum.**

If you need to commit, share, publish, *and* invite users in the same view, only the user's main verb gets `bg-primary`. The rest are `outline` or `secondary` plus an icon. If two actions feel equally important, you have a hierarchy problem to solve, not a color problem.

The one exception is destructive confirms inside dialogs — those use `bg-destructive`, not `bg-primary`.

### Active/selected ≠ primary

A selected list item, a current TOC entry, or an "active" tab does **not** use `bg-primary`. Use `bg-accent` (which is the theme's "subtle hover" surface) plus a left border or weight change. `bg-primary` is for actions, not state indicators.

---

## 3. Spacing, radius, type

These are smaller decisions but they drift fastest.

- **Radius.** Use the Tailwind `rounded-*` ramps backed by `--radius`: `rounded-sm` (`--radius - 4`), `rounded-md` (`--radius - 2`), `rounded-lg` (`--radius`), `rounded-xl` for hero cards, `rounded-full` for pills/icons. **Don't introduce new radii inline.**
- **Card radius.** `rounded-xl` for hero/marketing cards (book detail hero). `rounded-lg` for content cards (book tiles, page tiles). `rounded-md` for inline chips and small panels. Pick by elevation, not aesthetic.
- **Container.** Top-level pages use `container mx-auto px-4` (or `px-6` on book index). Don't mix `max-w-5xl` and `container` arbitrarily — pick one anchor per page.
- **Type scale.** Use Tailwind's defaults. Section labels above grids are `text-sm font-semibold uppercase tracking-wide text-muted-foreground` (codified by `RecentBooksCard`).
- **Body text.** Default is `text-foreground`. Metadata/captions are `text-muted-foreground`. Don't introduce a third grayscale.

---

## 4. Component patterns

These are the recipes. Each lives as a real component or is consistently applied; if you need a new one, codify it before using it twice.

### 4.1 Action bar pattern

A toolbar above a list/grid (book index, book detail's pages, page view).

> **Layout:** `flex items-center justify-between` with view/filter controls left-aligned and primary actions right-aligned. Overflow into a single dropdown on small screens.

- Left side: view-mode toggles (segmented control), filters, search.
- Right side: one primary CTA + optional secondary actions in a dropdown.
- All buttons in a group share the **same height** (`size="sm"` → `h-9` is the default for toolbars). Mixing icon-button rounds with text-button rectangles inside one group is a smell.
- Use `<ToggleGroup>` (shadcn) for view-mode switches, not three separate buttons styled to look grouped.

**Anti-pattern:** four standalone buttons of different shapes (icon-rounded, pill, rectangle) crammed into one row.

### 4.2 Card variants

Three legitimate Card variants exist on the book pages:

| Variant | Used for | Shape | Visual |
|---|---|---|---|
| `BookTile` | Book grid on `/books` | 3:4 aspect | Cover image OR *generated* fallback (gradient + glyph). Title overlay only on cover; metadata always *below* the tile. |
| `PageTile` (text) | Page grid on `/books/:slug` | 3:4 aspect | Title + content excerpt + word count + page number. |
| `PageTile` (section) | Section divider in page grid | **Full-width row, h-12 ish** | Uppercase title + chapter count. Not a grid item. |
| `RecentTile` | Horizontal recent strip on `/books` | Wide rectangle | Mini cover + book name + last page + timestamp. Lighter weight than BookTile. |

**Rules:**
- A coverless `BookTile` must look intentional — generate a stable gradient (seeded by book id) and a glyph (first letter or icon). **Never** show the book name twice (once inside, once below).
- A `PageTile` of type `section` is **always** a row divider, not a 2-col grid item. This is the rule that fixes the broken rhythm in the page grid.
- `RecentTile` is *lighter* than `BookTile` (single border, smaller cover). The recent strip should never out-shout the main grid.

### 4.3 Sidebar pattern

Both the left book TOC and the right page TOC are sidebars. They share one recipe.

- Width: `w-64` (left, dense), `w-56` (right, lighter).
- Background: `bg-background/50` (subtle lift from main).
- Item: `px-3 py-1.5 rounded-md text-sm`. Hover: `hover:bg-accent`. Selected: `bg-accent text-accent-foreground` + an optional `border-l-2 border-primary`.
- **Don't** use a filled brand color (`bg-secondary` solid) for selected items — that reads as a warning. Subtle bg + accent border is the rule.
- Sections in a sidebar: `text-xs font-semibold uppercase tracking-wide text-muted-foreground px-3 py-2`.

The left and right sidebars on the page view must share this recipe. Today the right one diverges and looks alarming.

### 4.4 Mode banner pattern

When the user enters a mode (Reorder, Delete, Edit) the affordance has to be unmistakable.

- Mode entry: button toggles to `variant="secondary"` (visibly held).
- Mode active: a floating "Exit X" button appears (`fixed bottom-6 right-6`, `rounded-full shadow-lg`). This already exists for Reorder — generalize it for Delete and Edit.
- Optional: a thin `bg-accent` strip at the top of the affected region with the mode label and an inline close button.

### 4.5 Hero card

Used for the book detail hero and similar "this is the thing" cards.

- Container: `rounded-2xl border border-border/50 bg-gradient-to-b from-card/60 to-card/30 shadow-xl backdrop-blur`.
- Top-right action cluster: outline buttons + overflow menu for Publish/Share/Settings. Single primary action sits in the body.
- Body: `grid grid-cols-[160px,1fr] gap-6` on small screens, `[200px,1fr] gap-8` on larger.

---

## 5. Anti-patterns (do not commit these)

1. **Inline hex or rgb in components.** `bg-[#fe7f2d]`, `text-[#666]`, `border-[#ddd]`. Use tokens.
2. **`bg-primary` on more than one button per view.** Demote the rest.
3. **Different shapes in the same button group.** Either all `rounded-full` icon buttons or all `rounded-md` text buttons. Don't mix in one cluster.
4. **Two visual treatments for the same logical item.** A book tile is a book tile — coverless and cover should both feel like books. A sidebar item is a sidebar item — left and right must match.
5. **Borrowing a feature color (audio yellow, success green) as a UI accent.** Those tokens are reserved.
6. **Truncating critical hierarchy.** Selected sidebar items get 2-line wrap; non-selected single-line. Never let the *active* item be ellipsed.
7. **Stacking many same-weight CTAs.** "Continue Reading," "Save this version," and "Publish" cannot all be primary. Pick one.

---

## 6. When to add a token

Before adding a CSS variable, ask:

1. **Is there an existing token for this role?** Almost always yes — re-read §2 above.
2. **Is this a *new role* (e.g. "warning" — currently absent) or a *new shade* of an existing role?** Only the former justifies a token. New shades go on the existing scale (`muted/50`, `card/30`).
3. **Will every theme define it?** A token only exists if all four themes (default, coffee, muji, pumpkin) and both modes (light, dark) have a value. Half-defined tokens break theme switching.

If yes to all three: add to `:root` *and* `.dark` *and* every `.theme-*` block in `src/index.css`. Map it in `tailwind.config.ts`. Document its role here.

---

## 7. Open gaps to fix

These are the issues this doc was written to address. Track in PRs:

- [ ] `BookTile` with unified coverless treatment (kill duplicate-title bug).
- [ ] `PageTile` section variant → row divider, not grid item.
- [ ] Right-sidebar TOC unified with left sidebar's selected-state recipe.
- [ ] Audit one-action rule on `/books/:slug` (only one of: Continue Reading, Save Version, Publish, gets `bg-primary`).
- [ ] Audit toolbar density on `/books` (search/sort/generate/new) — collapse Generate into overflow.
- [ ] Audit Downloads section on book hero — collapse to a single dropdown.
- [ ] Read/Edit toggle promoted to a labelled segmented control (or replaced with a single Edit CTA).

---

## 8. How to use this doc

- **Reading code:** if a component reaches outside these rules, that's a refactor candidate.
- **Writing code:** check §2 (color roles) and §4 (patterns) before introducing a new color, shape, or recipe.
- **Reviewing PRs:** anti-patterns in §5 should block merge. Add to a PR template if useful.
- **Disagreements:** propose an amendment to this doc in the same PR. Don't fork the rules silently.

This doc lives. Update it when you ship a new pattern that becomes the rule.
