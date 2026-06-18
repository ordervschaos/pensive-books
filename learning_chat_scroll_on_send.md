# learning: chat scroll on send

## Concepts

- **Optimistic UI** (optimistic = "assume success before confirming")
  - What: show the user's action instantly in the UI before the server confirms it
  - Here: `optimistic` state holds the just-sent message text; renders a user bubble + "sending…" immediately while the edge fn processes

- **Scroll anchor / "stick to bottom"**
  - What: auto-scroll a chat to the latest message as new content arrives
  - Here: `useChatScroll` tracks `atBottom` via scroll listener; only auto-scrolls on content change if user is within 48px of bottom (respects reading position)

- **Threshold guard**
  - What: a pixel distance check that decides whether to auto-scroll
  - Here: `THRESHOLD = 48` — if `scrollHeight - scrollTop - clientHeight <= 48`, treat as "at bottom"

- **Imperative escape hatch**
  - What: a ref-based callback (`scrollToBottom`) that bypasses declarative scroll logic
  - Here: used by the "↓ latest" pill and now by the send-triggered effect to force-scroll unconditionally

- **`useEffect` dependency array as event signal**
  - What: using a state value's transition (null → non-null) as a trigger for a side effect
  - Here: `useEffect(() => { if (optimistic != null) scrollToBottom(false); }, [optimistic])` — fires on every change to `optimistic`; the `!= null` guard means it only acts when a message was just sent, not when it's cleared

- **`behavior: "auto"` vs `"smooth"` scroll**
  - What: `"auto"` = instant jump, `"smooth"` = animated glide
  - Here: send-triggered scroll uses `"auto"` (instant) so it doesn't animate the user away mid-read; the "↓ latest" pill uses `"smooth"` by default
