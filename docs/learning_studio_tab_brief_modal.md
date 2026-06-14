# Learning — Studio rename, Brief-out-of-tabs, write-mode modal

Concepts encountered while removing the Brief tab, renaming "AI tools" → "Studio", and adding a
post-create "manual vs Studio" choice modal.

## Patterns

- **Slot prop (a.k.a. render prop / children-as-prop)**
  - *Name:* a parent component exposes a hole (`briefSlot?: React.ReactNode`) that the caller fills.
  - *What:* lets `BookInfo` place arbitrary content at a fixed spot (under title, above word meter) without knowing what it is.
  - *Here:* `BookDetails` passes `<BriefSummary .../>` as `briefSlot`; `BookInfo` just renders `{briefSlot}`. Keeps `BookInfo` agnostic of the brief.

- **Variant prop / presentational mode flag**
  - *Name:* one component, two skins via a boolean.
  - *What:* `BookBriefSection` gained `embedded` — `true` drops the Card chrome + heading so it sits inside a dialog that supplies its own title.
  - *Here:* same form reused in three places (header dialog, Studio brief step, was the old tab) instead of forking the form.

- **Callback prop for lifecycle hand-off**
  - *Name:* child tells parent "I'm done" so the parent can react.
  - *What:* `onSaved?: () => void` fired after a successful save; the host dialog uses it to close itself.
  - *Here:* `BriefSummary`'s dialog closes on save; the Studio step ignores it (no-op).

- **Query-param as initial-state seed**
  - *Name:* URL carries a one-shot intent.
  - *What:* `?tab=studio` tells `BookDetails` to open the Studio tab on first render; falls back to localStorage otherwise.
  - *Here:* the write-mode modal navigates with the param; BookDetails reads `window.location.search` in the `useState` initializer, and the slug-canonicalizing redirect re-appends `window.location.search` so the param survives.

- **Fork / branch UI (decision modal)**
  - *Name:* a deliberate either/or gate before two divergent flows.
  - *What:* `WriteModeDialog` — manual vs AI Studio, shown right after brief intake.
  - *Here:* dismiss (Esc/overlay) is treated as "manual" so the author always lands somewhere.

- **Graceful default on dismissal**
  - *Name:* closing without choosing still resolves to a safe path.
  - *Here:* `onChoiceOpenChange(false)` calls `chooseMode("manual")` rather than leaving the user stranded.

## Gotchas

- **Sequential dialog swap → dead body**
  - *What:* opening a second Radix dialog in the same tick the first closes can leave `body { pointer-events: none }`, freezing the page.
  - *Here:* `setTimeout(() => setChoiceOpen(true), 150)` defers the choice modal until the intake dialog finishes its close animation.

## Files touched

- `BookBriefSection.tsx` — `embedded` + `onSaved` props.
- `BriefSummary.tsx` *(new)* — header summary + edit dialog.
- `WriteModeDialog.tsx` *(new)* — manual/Studio fork.
- `BookInfo.tsx` — `briefSlot` prop.
- `BookDetails.tsx` — dropped Brief tab, "AI tools"→"Studio", `?tab=studio` seed + redirect preservation.
- `NewBook.tsx` — choice modal after intake; route by mode.
