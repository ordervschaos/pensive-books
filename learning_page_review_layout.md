# learning_page_review_layout

Concepts encountered while refining PageReview.tsx center layout (collapsible cards, level reorder, affordance relocation).

## Concepts

- **Controlled collapse (controlled component pattern)**
  - What: a UI element's open/closed state is owned by the parent, not the element itself; the element receives `open` + `onToggle` props and never self-manages state.
  - Here: `LevelCard` gets `collapsible / open / onToggle` — `PageReview` holds `objectiveOpen` + `beatOpen` in state and drives both cards.

- **Empty-state / content-driven default**
  - What: the initial value of a UI flag is derived from whether data exists, rather than a hard-coded literal.
  - Here: after data loads, `setObjectiveOpen(!o.trim())` and `setBeatOpen(!b.trim())` — cards start expanded only when empty so the author can fill them; collapsed with a preview when content already exists.

- **Glanceable preview (information scent)**
  - What: a truncated one-liner of hidden content shown inside the collapsed header so the user can tell what's inside without opening.
  - Here: `preview={objective.trim()}` passed to `LevelCard`; rendered as `<span className="truncate">` next to the label when `!open`.

- **Chevron affordance (disclosure triangle)**
  - What: a rotating `▾`/`▸` icon that signals "this is collapsible" and shows current open/closed state via CSS `rotate`.
  - Here: `<ChevronDown className="transition-transform ${open ? 'rotate-0' : '-rotate-90'}">` — Tailwind transition animates the rotation on toggle.

- **Resolution ladder (Pensive domain)**
  - What: the four abstraction levels of a book page — Objective → Beat → Prose → Scene — each being a finer-grained encoding of the same narrative moment.
  - Here: reordered from `…Beat → Scene → Prose` to `…Beat → Prose → Scene` so the prose (primary content) precedes the image gallery (secondary).

- **Affordance colocation**
  - What: placing a UI control physically next to the data it acts on, rather than in a toolbar or breadcrumb far from the content.
  - Here: "Open in Manuscript" moved from the breadcrumb row into the Prose `LevelCard` footer, where it clearly applies to the prose text.

- **Header-as-button (interactive region)**
  - What: wrapping a card's header `div` in a `<button type="button">` so the entire header hit-area triggers the toggle, matching native accordion UX.
  - Here: when `collapsible` is true, `LevelCard` renders the header inside a `<button onClick={onToggle} className="w-full text-left">`.
