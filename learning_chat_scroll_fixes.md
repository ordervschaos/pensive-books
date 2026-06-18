# Learning: chat scroll UX fixes

## Concepts encountered

- **Scroll anchoring** (DOM term: sticking to the bottom of a scroll container)
  - What it is: keeping the viewport pinned to the newest content so the user sees updates without manual scrolling.
  - How it showed up: the studio chat rails needed to jump instantly on first paint, then only smooth-scroll new messages when the user is already at the bottom.

- **Scroll threshold / "at bottom" heuristic**
  - What it is: treating a user as "at bottom" when they are within N px (here 48 px) of the scroll floor, not only exactly at it.
  - How it showed up: `distFromBottom = scrollHeight - scrollTop - clientHeight <= 48` is the condition that decides whether to auto-scroll on new content.

- **First-run ref guard** (`useRef` as a mutable flag, not as a DOM ref)
  - What it is: a React ref holding a boolean that survives re-renders without triggering them — used here to distinguish the very first effect run from later ones.
  - How it showed up: `firstRun.current` flips from `true` → `false` after the initial instant-scroll, preventing every subsequent content update from replaying the jump.

- **`behavior: "auto"` vs `behavior: "smooth"` on `scrollTo`**
  - What it is: `"auto"` is an instant jump; `"smooth"` is the animated glide. Both are native browser APIs on `Element.scrollTo`.
  - How it showed up: first paint uses `"auto"` (no animation through history), new messages use `"smooth"` only when already at bottom.

- **Passive event listener** (`{ passive: true }` on `addEventListener`)
  - What it is: tells the browser the handler will never call `preventDefault()`, letting it skip a synchronization step and fire scroll at full speed.
  - How it showed up: `el.addEventListener("scroll", handleScroll, { passive: true })` on the scroll container in `useChatScroll`.

- **Custom hook extraction** (React pattern: shared stateful logic across components)
  - What it is: pulling `useRef`, `useState`, and `useEffect` calls into a named function (`useChatScroll`) so multiple components get identical behavior without copy-pasting.
  - How it showed up: `ReviseChat` and `ProseEditor` both call `useChatScroll(contentSignal)` and get back `{ scrollRef, atBottom, scrollToBottom }`.

- **Content signal / dependency array as `readonly unknown[]`**
  - What it is: passing the dependency array to a hook as a parameter so the caller controls what triggers the scroll effect, without the hook knowing the specifics.
  - How it showed up: `useChatScroll([messages.length, thinking, !!pending] as const)` in ReviseChat; `[steps.length, row?.status, !!row?.pending]` in ProseEditor.

- **Ungating** (removing a conditional render so content persists across state transitions)
  - What it is: changing `{condition && <Component />}` to `{alwaysTrueCondition && <Component />}` so the component survives the condition going false.
  - How it showed up: `ProseEditor` had `{active && steps.length > 0 && ...}` — removing `active &&` means the transcript stays visible after the run ends/applies instead of disappearing.

- **Absolutely-positioned overlay pill** (CSS pattern: `absolute` child inside `relative` parent)
  - What it is: a small floating button that sits above scrollable content without pushing content down, disappearing when no longer needed.
  - How it showed up: the "latest ↓" chip is `absolute bottom-2 left-1/2 -translate-x-1/2` inside a `relative` wrapper around the scroll container, visible only when `!atBottom`.

- **`backdrop-blur-sm`** (Tailwind utility for CSS `backdrop-filter: blur()`)
  - What it is: blurs whatever is behind a semi-transparent element, giving depth without a fully opaque background.
  - How it showed up: applied to the pill button (`bg-background/90 backdrop-blur-sm`) so content scrolling beneath it stays legible.
