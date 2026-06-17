# Learning — OutlineStep manual editor (chat-first studio)

## Concepts encountered

- **Chat-first / Cursor model** — three-pane IDE pattern (Navigator | Stage/editor | Rail/chat); the AI surfaces in the right rail, the center is a plain editor. Showed up as the architectural mandate removing all AI generation UI from OutlineStep's center.

- **Empty state CTA** — UI pattern: when content is absent, show a calm message + a primary action that points into the generating surface (here `GenerateInChat`). Showed up in `EmptyOutline` and the empty-movement fallback.

- **Autosave on blur** — inputs save to the server when they lose focus rather than on explicit save-button click. Showed up in every editable field (page title, chapter title, objective textarea).

- **Optimistic draft state** — local React state (`titleDraft`, `objectiveDraft`) shadows the server-sourced prop during editing; on blur the server is called and local state is cleared so the next prop update wins. Avoids flickering while the user types. Showed up in `PageRow` and `MovementBlock`.

- **Archived soft-delete** — records are not hard-deleted; `pages.archived = true` removes them from live queries while preserving data. Showed up in `deletePage` and `deleteChapter`.

- **`create_next_page` RPC** — Supabase stored procedure that appends a page at the correct `page_index` for a book; then a follow-up `pages.update` sets type/title. Showed up in `AddAffordances.createPage`.

- **`Movement` model** — studioModel's grouping of sections + their text pages; section key encodes the DB page id as `mv-{id}`. Showed up when extracting `sectionPageId` from `movement.key`.

- **`MapPage` type** — planGraph's per-page read model: `title`, `objectiveText`, `pageType`, cell states (`objective`/`beat`/`prose`). Showed up as the `page` prop type in `PageRow`.

- **`saveObjective`** — ladder.ts helper that writes an objective with provenance/staleness stamping. Kept for objective edits so the spine→objective edge stays intact.

- **`GenerateInChat` atom** — studioUi primitive that sends a `triggerGenerate` message into the rail chat; used for the outline empty state so the author can kick off generation without navigating to the chat.

- **`Panel` / `Eyebrow` / `ActionLink`** — studioUi house primitives for card shells, mono labels, and italic action affordances. Composed throughout to match SpineStep/FoundationsStep style.

- **`AutoTextarea`** — auto-growing textarea UI component; used for the objective field so it expands to fit content.

- **`DurableReviser` / `DurableOptions`** — removed from OutlineStep; per-page AI now lives in the rail chat. Both still have callers elsewhere (`ScaffoldGenerator`, `PageReview`, `ProseNodePanel`) so their files were not deleted.

- **`ScaffoldGenerator`** — removed; bulk scaffold generation now triggered via `GenerateInChat bookId layer="outline"` in the rail chat.

- **tsbuildinfo cache** — tsc incremental build cache file; stale cache can report phantom errors at wrong line numbers. Cleared with `find … -name "*.tsbuildinfo" -delete`.
