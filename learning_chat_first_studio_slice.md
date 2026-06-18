# learning — chat-first studio spine slice

## Concepts encountered

- **Chat-first / Cursor pattern**
  - Name: "chat-first" = the chat pane is the primary AI surface, not inline generation buttons
  - What it is: architecture where LLM interaction is centralised in one always-visible rail (like Cursor IDE's chat), and the center pane becomes a plain editor
  - In this task: renamed the right-rail (ReviseChat) the "agent" and stripped all in-center generation from SpineStep; center → plain textarea, agent → right rail

- **Prop drilling / prop removal**
  - Name: passing data/callbacks through a chain of component props
  - What it is: when a parent-owned concern (steer) is threaded as a prop down multiple layers
  - In this task: `steer`/`beforeGen` were drilled from `StudioStage` → step components → sub-functions; removing them required coordinated edits at every layer

- **No-op stub**
  - Name: a function that does nothing (`async () => {}`)
  - What it is: a placeholder that satisfies a type contract without side effects
  - In this task: `FoundationsStep` still has internal `beforeGen` wiring (generation UI kept); instead of refactoring internals now, a no-op was inserted at the public boundary so the internal subcomponents compile unchanged

- **Gate / settled-content guard**
  - Name: `railReady` — a boolean that was `true` only once a layer had content
  - What it is: a conditional that deferred showing the rail until something existed to revise
  - In this task: removed entirely so the rail is always-on; "empty center + live chat" is now the intended first-run state

- **Autosave on blur**
  - Name: `onBlur` save pattern
  - What it is: saving data when the user leaves an input field (loses focus), not on every keystroke
  - In this task: SpineStep textarea uses `onBlur={() => { if (dirty) void save(); }}` — the canonical pensive autosave pattern

- **Optional prop / call-site guard (`?.`)**
  - Name: optional chaining on callbacks (`beforeGen?.()`)
  - What it is: TypeScript optional prop + nullish safe-call so the function only executes if provided
  - In this task: `ScaffoldGenerator.beforeGen` is already `?` — OutlineStep no longer passes it, making it a harmless no-op without touching the component

- **Stale-content gate (removed)**
  - Name: `railReady` / "settled content" gate
  - What it is: a guard preventing the rail from showing until the layer has data worth revising
  - In this task: the spec's new model says "empty center + live chat is the first-run state" — so the gate was the thing blocking that and had to go

- **ResizablePanelGroup / 3-pane layout**
  - Name: resizable panels — draggable column dividers with persisted widths
  - What it is: `autoSaveId` keyed panel groups; key switches between `"panes-2"` and `"panes-3"` so each layout stores its own widths
  - In this task: left intact; `showRail` now determines pane count without any content gate
