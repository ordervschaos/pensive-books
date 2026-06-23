# Learning — North Star doc

Named concepts encountered while writing `docs/NORTH_STAR.md`.

- **North Star metric** — the single "are we winning" number a product orients around. *Here:* the
  read-through test — read a generated book end-to-end with no edit-reflex.
- **Self-similar tree** — one node shape repeated at every depth (fractal-like). *Here:* the Novel DNA
  ladder seed→premise→pillar→movement→beat→scene→prose; same four verbs at each rung.
- **Source of truth vs render (projection)** — one canonical store; everything else is derived/recomputed
  from it. *Here:* the DNA tree is truth; `pages` are a `reconcile()` render of it.
- **Hydration** — filling a skeletal structure with content. *Here:* AI generates each rung *from* the
  rungs above + locked intent, instead of free-writing.
- **Leash (constraint-bounded generation)** — letting the model generate only within fixed structure.
  *Here:* the spine/locks are the leash; same AI, different blast radius vs clipboard paste.
- **"Don't make me think"** (Steve Krug) — UX law: a screen should make its purpose/action self-evident.
  *Here:* O3 + UX rule #1; pauses-to-figure-out = bug.
- **Blast radius** — the set of things a change will cascade into. *Here:* shown before any regenerate so
  there are no silent rewrites.
- **Live projection (no-refresh)** — UI subscribes to server state instead of fetch-once. *Here:* UX
  rule #5; standing app-wide standard.
- **Wedge / moat** — the narrow entry point into a market / the defensible advantage. *Here:* wedge =
  Pensive's existing publish pipe; moat = structure-that-remembers-itself (continuity + series canon).
- **Canon (series carry-forward)** — fixed facts a sequel must conform to. *Here:* O5; book 2 generated
  constrained by book 1's cast/voice/open threads.
- **Standing / living doc** — a reference that changes with the *strategy*, not the code. *Here:* the
  whole point of NORTH_STAR.md vs the implementation specs.
