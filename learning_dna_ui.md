# learning · DNA feature UI pass

Named concepts touched while rebuilding the Novel DNA authoring UI. Dense + scannable.

## UI / interaction principles
- **Layout shift (CLS — Cumulative Layout Shift)** — content jumping as state changes. *Here:* old `NodeCard` swapped `accept → generate verbs → generating spinner` in the same header, reflowing the card; fix = a **persistent action bar** (`min-h-[24px]`, always rendered) so only its *contents* swap, never its box.
- **Stable zones** — a card split into fixed regions (identity → summary → fields → actions) so the eye always finds a control in the same place. *Here:* the four-zone `NodeCard`.
- **Progressive disclosure** — reveal an action only once its precondition holds. *Here:* `ready = status==="accepted"` gates the generate verbs; an un-approved rung shows only the **approve** gate (engine rule §7: expand only from an accepted parent).
- **Scannability** — read a stack top-to-bottom without opening each item. *Here:* `cardTitle()` derives a one-line title per kind; `KindSummary` shows derived state inline.
- **Affordance** — a control *looking* like what it does. *Here:* lock/unlock/delete became icon buttons with verb tooltips; ★ marks load-bearing fields.

## The data model that was invisible (now surfaced on cards)
- **Self-similar tree** — one node shape (`book_nodes`) for every kind; one `NodeCard` learns once, renders all. The book IS the tree; pages are a projection.
- **Derived state (never stored)** — pure functions over the node array, recomputed on render. The UI's job is to *surface* them; it stores nothing.
- **Game = possibility space** — a contest with BOTH a `win_condition` and `lose_condition` (no lose = no stakes). *Surfaced:* two color-dotted poles (emerald WIN / rose LOSE).
- **Coupling / cascade** — a directed edge (`couples: {to, when, effect}`) where one game's outcome rewrites another's stakes (`void`/`raise`/`lower`/`enable`), propagated transitively by `cascade()`. *Surfaced:* the `⛓ won → void Household` line.
- **Causality (producer–consumer)** — each beat `establishes` state keys and `needs` keys earned upstream; a `therefore` whose needs aren't produced earlier is "and-then in disguise". *Surfaced:* `needs … → establishes …` strip + the ∴/↯ connector glyph on the title.
- **Value shift / polarity** — every scene must turn a value `from → to` (up/down), else it's a flat "and-then". *Surfaced:* `hope → despair ↘` with directional arrow.
- **Emotional topography** — the polarity sequence in reading order; a long same-polarity run = a sagging middle. *Surfaced:* the colored strip + a **legend** (up/down/flat).
- **Promise ledger** — per thread, `setups → payoffs` count in reading order; payoffs:0 = dangling promise.
- **Pacing drift** — a movement's turning point landing off its authored `target_pct`.

## Engine plumbing (left untouched, relied on)
- **Staleness via input-set hash** — a node stores `src_hash` of its inputs; `isStale()` flags drift. UI shows a `stale` chip.
- **Blast radius** — the unlocked subtree a regenerate would touch (locks stop the sweep). Shown in the chat proposal cards.
- **Lints / conformance** — `validate()` returns `{rule, severity, message}`; *Surfaced:* severity dot + rule name + message rows.

## Taming scroll — the collapsible outline (follow-up pass)
- **Outline / progressive disclosure (at scale)** — a long stage rendered as one-line rows you drill into, not a wall of open cards. *Here:* `NodeCard` collapses to `chevron · kind · title · status`; the body (summary/fields/actions) renders only when `expanded`.
- **Smart default vs. explicit override** — compute a sensible open/closed state, let the user override it. *Here:* `expanded[id] ?? openDefault(n)` — a `Record<id,bool>` of explicit toggles layered over a derived default. New nodes get the default automatically (no stale state).
- **Attention propagation (subtree roll-up)** — a parent is "needs work" if it OR any descendant is. *Here:* one bottom-up tree walk builds `attn: Set<id>`; a branch folds only once the whole subtree is accepted + in-sync.
- **Generative frontier** — keep the *next actionable node* open so approving a rung reveals its next move instead of hiding it. *Here:* `hasOpenTarget(n)` = accepted but still has an ungenerated child-kind (pillar before cast, movement before beats); excluded `prose` (not a child node).
- **Group-collapse via parent state** — fold a parent ⇒ hide its children, by gating the children's render on `isOpen(parent)` (state lifted to the container, not the card). *Here:* a movement folds its beats (Structure); a beat folds its scenes (Scenes).
- **Bulk affordance** — `expand all` / `collapse all` writes an explicit override for every node id. Operability escape hatch when the smart default isn't what you want.
- **Collapsed-row signal** — a folded parent still advertises what's inside: `6 beats · 2 need work`, so you don't expand blind.

## House design primitives (reused, not reinvented)
- `Eyebrow` (mono uppercase label · tone), `Panel` (card shell · variant), `ActionLink` (italic AI-move affordance, spinner when busy), `RunningInline`, `StepDot`, `StageHead` — all from `studioUi.tsx`. Composing these kept the new card visually identical to the rest of the Build Studio.
