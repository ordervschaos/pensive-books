# learning — better diff view for the proposed-revision card

- **LCS (Longest Common Subsequence)** — "longest run of items two sequences share, in order, not necessarily contiguous." Dynamic-programming algorithm. Here it's run over *word tokens* of the old vs new spine to find which words survived; everything else is a delete or insert. Backbone of `diffWords`.
- **Inline (unified) diff** — one flowing passage where kept text is normal, removed words strike through, added words tint. Replaces the old "two stacked walls" (whole NOW struck, whole PROPOSED below). Implemented as `InlineWordDiff`.
- **Tokenization (`split(/(\s+)/)`)** — capturing split keeps whitespace as its own tokens so spacing/line breaks survive reconstruction and align cleanly in the diff.
- **Whitespace-edge stripping (`StyledRun`)** — pulls leading/trailing spaces *outside* the tinted span so a space never carries a stray strike/highlight; only the core word is styled.
- **Memoization (`useMemo`)** — the O(n·m) LCS table is recomputed only when before/after change, not every render.
- **Guard clause / fallback** — `n*m > 4M` (huge inputs) bails to a plain del-block + ins-block instead of allocating a giant `Uint32Array`.
- **Typed array (`Uint32Array`)** — flat 1-D array indexed `i*W+j` as the 2-D DP grid; cheaper than nested JS arrays.

## How it showed up
`apps/web/src/components/book/studio/ReviseChat.tsx`: rewrote `SpineDiff` (added a diff⇄result toggle) and `FoundationsDiff` text rows to use the new `diffWords` + `InlineWordDiff` + `StyledRun` helpers. Chips (`[xxxxxxxx]` entity refs) still render via `TextWithChips` inside each run.
