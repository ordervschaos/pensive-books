# Learning: Spine "propose more" + shared skeleton extraction

Concepts encountered while redesigning SpineStep and standardizing cross-step primitives.

---

- **append-not-replace generation** (UX pattern): new AI results join the existing pool rather than wiping it; existing cards stay visible. Showed up as changing the routes accept callback from `[kept, ...res.routes]` to `[...current, ...res.routes]`.

- **avoid list** (prompt technique): send existing option summaries as `avoid: [...]` so the AI generates meaningfully different alternatives instead of near-duplicates. Showed up in `proposeMore()` passing all current route summaries as avoid context.

- **skeleton card** (loading pattern): animate-pulse placeholder card appended below real content during generation — no layout shift, no full-screen spinner. Showed up as `SkeletonCard` / `SkeletonRoute` shown beneath existing routes/candidates while `generating === true`.

- **shared primitive extraction** (component architecture): move repeated UI fragments (SkeletonCard, SkeletonProposalCard) from per-step local functions into the shared `studioUi.tsx` so every step imports the same markup. Showed up when FoundationsStep and SpineStep both needed the same skeleton shape.

- **action placement outside chosen card** (UX rule): "propose more" is a pool-level action, not a chosen-item action — lives below the card list, not inside the chosen panel. Showed up when the user corrected the initial placement inside the chosen route card.

- **2-column grid vs 3-column** (layout): removing the Avoid column simplified TentpolesSub from a 3-column kanban to a 2-column Pinned / Proposals layout. Matched the user's "simplify it" intent.

- **discard = permanent delete** (data model): removing the Avoid column means discarded tentpoles are gone, not staged. `setStatus(id, "killed")` → `deleteCard(id)` everywhere; `onKill` prop → `onDelete`.
