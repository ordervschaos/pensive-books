# Learning: PageReview readability (no truncation, rendered prose)

Concepts encountered while making the studio "Read" page fully readable.

- **Tailwind Typography plugin (`@tailwindcss/typography`)**
  - Name: a Tailwind plugin that ships a `prose` class for styling raw HTML (headings, paragraphs, lists).
  - What: without it, `prose`/`prose-*` utilities are no-ops; Tailwind's preflight reset strips `<p>`/`<h1>` margins so markdown renders flat.
  - Here: it was in `package.json` but never added to `tailwind.config.ts` `plugins` — so every existing `prose` class (chat messages too) did nothing. Wired it in to style ReactMarkdown output.

- **Preflight (CSS reset)**
  - Name: Tailwind's base layer that normalizes/zeros browser default styles.
  - What: removes default paragraph/heading margins, so rendered markdown paragraphs run together unless restyled.
  - Here: the reason `<ReactMarkdown>` alone wasn't enough — needed `prose` + `prose-p:my-3` to re-add spacing.

- **ReactMarkdown**
  - Name: React component that parses a markdown string into real DOM elements.
  - What: turns `*italic*`, blank-line paragraph breaks, em-dashes into formatted HTML instead of literal characters.
  - Here: replaced the `whitespace-pre-wrap` raw-text `<p>` in `ProseNodePanel` so prose is "fully rendered."

- **Auto-growing textarea (scrollHeight technique)**
  - Name: sizing a textarea to its content by reading `el.scrollHeight`.
  - What: set `height='auto'` then `height = scrollHeight + 'px'` on each value change; pair with `resize-none overflow-hidden` to kill the scrollbar/handle.
  - Here: the `AutoTextarea` helper in `PageReview`, replacing fixed `rows={3}`/`rows={4}` that truncated long beats mid-sentence.

- **`useLayoutEffect`**
  - Name: like `useEffect` but fires synchronously after DOM mutation, before paint.
  - What: used over `useEffect` for measurement+resize so the user never sees a one-frame wrong height (flicker).
  - Here: drives the textarea height recalculation keyed on `value`.

- **`field-sizing: content` (considered, not used)**
  - Name: a modern CSS property that makes form controls auto-size to content natively.
  - What: would replace the JS scrollHeight dance — but Chrome-only as of now, no Safari.
  - Here: rejected for the JS approach to keep cross-browser behavior in a production app.

- **Resolution ladder (architecture term, pre-existing)**
  - Name: a page modeled as stacked levels — objective → beat → prose — each readable/editable/regenerable in place.
  - What: the UI being fixed; the three `LevelCard`s are the ladder rungs.
  - Here: the truncation/formatting bugs were all in how the rungs displayed their text.
