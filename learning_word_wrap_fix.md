# Word Wrap Fix for Relationships Panel

## Concepts

- **AutoTextarea** — React component wrapper around HTML `<textarea>` that automatically resizes its height to fit content. Used throughout FoundationsStep for multi-line editable fields. Fixed the word-wrap issue by replacing a single-line `<input>` element (which truncates overflow text) with `<AutoTextarea>` which grows vertically and wraps text naturally.

- **Input vs Textarea distinction** — HTML `<input type="text">` renders as a single-line field that cannot wrap text; overflow is hidden or scrolled. HTML `<textarea>` is multi-line by default and supports text wrapping. The relationships "bond" field needed wrapping behavior, so textarea-based component was the right choice.

- **Flex layout with min-w-0** — CSS pattern (`min-w-0 flex-1` on the input) allows a flex child to shrink below its minimum content width and enables horizontal text wrapping/overflow. When replaced with `<AutoTextarea>`, the same classes preserve the flex behavior while enabling vertical growth instead of horizontal truncation.

- **Component consistency** — FoundationsStep already uses `<AutoTextarea>` for other multi-line fields (Cast fields, World setting/period, Voice exemplar). Reusing the same component ensures consistent behavior, styling, and saves custom implementation work.
