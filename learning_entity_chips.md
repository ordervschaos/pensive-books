# Learning: Entity Chips in AI Chat Markdown

## Concepts

- **Custom ReactMarkdown renderer** — ReactMarkdown accepts a `components` prop that maps HTML element names (like `code`) to custom React components, letting you intercept any rendered node. Used here to swap `` `[xxxxxxxx]` `` code nodes into interactive chips.

- **Inline `code` node interception** — Markdown wraps backtick spans in `<code>` tags. By overriding the `code` component in ReactMarkdown, you inspect `children` (the inner text), pattern-match, and either render a chip or fall back to a plain `<code>`.

- **Entity ID disambiguation** — The AI outputs two types of IDs in the same pattern: 8-char hex UUIDs (`crypto.randomUUID().slice(0,8)`) for tentpoles and cast, and integer IDs for pages. The resolver tries tentpoles → cast → pages in order.

- **Radix Tooltip / `TooltipProvider`** — Radix's tooltip requires a `Provider` wrapper for context (delay, open state). Wrapping each chip in its own `TooltipProvider` keeps chips self-contained (no shared state). `delayDuration` controls hover delay in ms.

- **Radix Dialog (controlled)** — Dialog with `open`/`onOpenChange` props is controlled mode: parent `useState(false)` owns visibility. The trigger here is the chip button itself (not `DialogTrigger`), so `open` flips on click.

- **`not-prose` class** — Tailwind's `prose` plugin styles all descendant elements. Adding `not-prose` to an element opts it out of prose styles, preventing the chip's border/background from being overridden.

- **`Components` type from react-markdown** — The type of the `components` prop. Importing it explicitly (`import type { Components } from "react-markdown"`) lets you type the factory function's return value.

- **Factory pattern for renderer** — `makeMarkdownComponents(foundations, model)` is called per render to capture the lookup context in a closure, rather than threading props through children. Keeps the renderer stateless.

- **Fallback graceful degradation** — If `lookupEntity` returns `null` (ID not found in current data), the chip renders as plain `<code>[id]</code>`. This matters for archived session history where IDs may reference deleted entities.
