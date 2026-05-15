# MyBooks layout-shift fix

## Goal
Eliminate initial-load layout shift on `/books` (MyBooks page) by rendering the final layout structure during loading, with fixed-size skeleton placeholders instead of swapping in a different temporary layout.

## File changed
`src/pages/books/index/MyBooks.tsx`

## Changes

### 1. Removed the early-return loading block
Previously, `if (loading) return ...` rendered a small 4-card mini-skeleton layout that bore no relation to the real layout. Once data arrived, the entire page recomposed (Recent section + toolbar + filter pills + 6-column grid), causing major CLS.

Now, the same layout is rendered immediately. Only the *contents* differ during loading.

### 2. Progress bar moved into the always-rendered layout
The fixed top progress bar still appears while `loading === true`, but it sits alongside the real layout instead of replacing it. Since it uses `position: fixed`, it never contributes to layout shift itself.

### 3. Book grid skeleton matches real cards
While loading, the grid renders 12 placeholder cards using the same:
- Grid classes: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`
- Gap: `gap-x-5 gap-y-8`
- Card shape: `aspect-[3/4] rounded-xl border border-border/50`
- Metadata strip below each card: two muted bars with the same `mt-3` offset

Result: when real books load, each card slots into the exact same box the skeleton occupied.

### 4. Filter pill counts no longer shift pill width
The count span is now always rendered with `min-w-[1ch]`. During loading it shows `0` with `opacity-0` (invisible but space-reserved). When real counts arrive, the pill width stays stable for single-digit counts.

### 5. Recent section (unchanged)
`RecentBooksCard` already had its own loading skeleton with matching dimensions (`h-14 w-10` cover + text bars, `p-3` card, same `grid-cols-2 lg:grid-cols-4` layout), so it was left as-is.

## What still might shift slightly
- Filter pill width for **multi-digit** counts (1 digit → 2 digits adds ~6px). Acceptable.
- If the user has zero books, the grid skeleton (12 cards tall) collapses into the empty-state panel. Unavoidable without knowing the count up front.
- If `RecentBooksCard` resolves to zero recent items, the component returns `null`, removing its slot. Not addressed in this pass — user noted recent section was already predictable, so left untouched.

## Verification
- `npx tsc --noEmit` — clean.
- No behavior change once data has loaded; only the loading state was reworked.
