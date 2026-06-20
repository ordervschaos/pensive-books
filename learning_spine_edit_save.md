# learning — spine textarea edit/save bug

- **Conditional rendering (React)** — render different JSX branches based on a boolean; the unselected branch unmounts from the DOM. Bug: `SpineStep` had `if (!spine.trim()) { return <empty branch> } return <full branch>` — two separate `<AutoTextarea>` instances.

- **onBlur does not fire on unmount** — React does not emit a `blur` event when an element is removed from the DOM. Only fires on real focus-leave gestures. How it showed up: clearing the spine text flipped the component from the non-empty branch to the empty branch; the non-empty textarea unmounted silently, `onBlur` never fired, `save()` was never called, and on refresh the old DB value came back.

- **React reconciler / component identity** — React re-uses DOM nodes only when component type + tree position match across renders. Two textareas in two conditional branches = two distinct DOM nodes; no focus or event carry-over between them. How it showed up: branch-switch destroyed the focused textarea element mid-edit.

- **Dirty flag pattern** — boolean (`dirty` + `dirtyRef`) tracking whether local state has diverged from the server source of truth and needs saving. How it showed up: `dirty` guarded the `onBlur` save path; `dirtyRef.current` guarded `reload()` inside async callbacks (where reading `dirty` state would be stale).

- **useRef as closure escape hatch** — `useRef` holds a mutable value readable from any async callback without stale-closure issues. How it showed up: `dirtyRef.current` checked inside `reload()` (an async fn) to discard fetched data if the user started editing mid-fetch.

- **Realtime → reload loop** — Supabase Realtime fires on every `books` UPDATE → bumps `infoKey` → bumps `reloadKey` → triggers `SpineStep.reload()`. The `dirty` guard prevents overwriting mid-edit content.

- **Fix** — collapsed the two conditional textarea branches into one always-rendered `<AutoTextarea>`; `{isEmpty && ...}` shows the prompt above it. `onBlur` unconditionally calls `save()` when dirty — clearing the spine is a valid write (saves `""`).
