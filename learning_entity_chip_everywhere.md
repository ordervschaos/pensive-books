# learning: entity chips in all text surfaces

## Concepts

- **Markdown code span** (inline code)
  - What: text wrapped in backticks `` `like this` `` — renders as a `<code>` node in the AST
  - Here: the existing `code` renderer in `makeMarkdownComponents` intercepts `[8hex]` / `[digits]` patterns inside code spans and renders `EntityChip`

- **ReactMarkdown custom renderer**
  - What: a `Components` map that replaces default HTML elements with custom React components
  - Here: `code: ({ children }) => ...` intercepts inline code nodes; matched IDs become chips, others fall back to styled `<code>`

- **Pre-processing markdown** (transform before parse)
  - What: mutating the raw markdown string before the parser sees it, to inject syntax the renderer can handle
  - Here: `preprocessEntityRefs` replaces bare `[id]` → `` `[id]` `` so the existing `code` renderer handles them without a new parser plugin

- **Regex negative lookahead** `(?!\(|\[)`
  - What: a zero-width assertion that matches only if NOT followed by `(` or `[`
  - Here: prevents converting `[id](url)` (real markdown links) or `[id][ref]` into code spans

- **`split` as inline tokenizer**
  - What: using a regex with a capture group to split a string into alternating text / matched parts
  - Here: `text.split(/(\[[0-9a-f]{8}\]|\[\d+\])/)` produces `["text ", "[id]", " more text"]` — odd indices are matches, even are literal text

- **Two rendering surfaces for the same data**
  - What: the same entity ID appears in both markdown (ReactMarkdown) and raw text (SpineDiff, FoundationsDiff)
  - Here: two strategies — preprocess for markdown, `TextWithChips` component for raw — because ReactMarkdown's AST doesn't expose raw text nodes for easy manipulation
