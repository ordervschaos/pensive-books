# Learning: the resolution graph as the AI-tools surface

Task: make the AI-tools tab a connected node-graph (brief→spine→objective→beat→prose) that's actionable + reviewable in place, and fold every BookJourney capability onto that surface (journey kept for reference, not mounted).

---

- **Read-model vs view** — separate "what state is each node" from "how it's drawn"
  - `planGraph.buildMap` is a pure read-model (gap/drift/synced per cell + totals); the Map only renders it.
  - To draw node previews I extended the read-model with the node *text* (objectiveText/beatText/proseText/spineText), not just the state — the view stays dumb.

- **One UI grammar, shared module** — don't re-implement the same controls per screen
  - The page workshop and the map's node sheet both need RE-CREATE (replace) and REVISE (preserve, diff). Two copies drift.
  - Extracted `Connector`/`RecreateButton`/`NodeReviser`/`NodeLabel`/`ReviseButton`/`diffStyles` into `ladder-ui.tsx`; both surfaces import them.

- **Re-create vs revise** — the two-operation model, kept visually distinct everywhere
  - RE-CREATE = regenerate from a neighbour (↓ parent / ↑ child), REPLACES. REVISE = instruction → before/after diff → accept, PRESERVES.
  - In the single-node sheet, ↓/↑ are buttons ("re-create from {parent/child}"); ✎ Revise opens the diff gate.

- **Side sheet = act without losing context** — the map stays visible behind it
  - "Reviewable from this screen without getting lost in a page": a right-hand Sheet (NodeEditor) overlays the graph; you act + review, then close back to the same graph.
  - Prose gets an explicit "Open page ↗" escape hatch — navigation is opt-in, not forced.

- **Write the page body with no editor mounted** — `buildDoc(title, text)`
  - The page editor normally turns proposed prose → TipTap content on apply. The map has no editor open.
  - Prose re-create/revise route through the SAME durable `generate-page` task (resumable, watched via `useLatestTaskRow`), then write `pages.content` directly with `buildDoc` + re-stamp provenance (`stampProse`). Same path `generate-book`/`WriteNextPage` already use.

- **Durable task, synchronous-looking UI** — slow prose gen survives refresh
  - Prose generation is slow + tab-fragile, so it's a `book_generations` row watched over Realtime; a refresh resumes the loader and a finished proposal is still there to review.
  - Short nodes (spine/objective/beat) are quick → their transforms are synchronous inline.

- **Retire by un-mounting, not deleting** — keep the linear flow for reference
  - BookJourney + BookSpine are no longer mounted in the AI tab, but the files stay in the repo (tsc still typechecks them; the bundle just doesn't include them since nothing imports them).
  - Their whole-book capabilities (scaffold · write · stale · editor's read · revise · publish) moved into `GraphActions`, a self-contained card under the graph — including the eval→revise prefill handoff, lifted into local state.

- **Fan-out drawn with a rail + tick, not SVG** — cheap graph affordance
  - The spine→pages branch is a single absolute vertical rail + a per-row horizontal tick (the journey's rail trick), avoiding an SVG edge layer for a list that can get long.

- **Per-node parentage is not uniform** — the objective has no per-page "down"
  - Most edges are 1:1 (re-create down from parent). The objective's parent edge is the 1→N scaffold (`spine-to-objectives`), a whole-book birth — so in the sheet the objective offers only ↑ (from beat) + revise; new objectives come from the outline action, not a per-node expand.
