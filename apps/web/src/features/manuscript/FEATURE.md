# Feature: Manuscript Agent (the agent canvas)

> The book's SECOND agent — about the **book**, not the story. It reads and edits pages and the
> book's own fields, and stages every change for review on a red/green canvas at word, block, page,
> and whole-book grain. Route: `/books/:slug/agent` (the **Agent** button beside **Studio**).
> The Studio (DNA tree + its agent) is untouched; this is additive.

```
 ┌────────────── rail ──────────────┐ ┌──────────────────── canvas ────────────────────────┐
 │ chat: steps · choices · staged   │ │ top bar: pages ▸ · Book title · Accept all/Reject all · ⋮ │
 │ card · action units · model pick │ │ [side panel: pages | changes]   page / book / new page  │
 │                                  │ │ bottom bar: prev · "p3 The Door" 4/12 · next            │
 └──────────────────────────────────┘ └────────────────────────────────────────────────────┘
```

## The contract (the seam)

- **Model**: one `book_agent_runs` row per book with `kind='manuscript'` (same table as the Studio
  thread: RLS, Realtime, cooperative cancel via `lib/stopRun`, and the `book_agent_sessions` archive RPCs
  all reused). `context_model` carries the author's model pick per thread.
- **The agent only stages.** `row.proposals` is a flat `ManuscriptChange[]`:
  `page_edit` (body text before→after, optional retitle) · `page_add` · `page_delete` · `book_edit`.
  The edge fn never writes `books`/`pages`.
- **The author's browser writes.** `lib/manuscriptAgent.ts` is the ONE write path — accept whole
  (`acceptChange`), reject (`rejectChange`), or partially (`resolvePartial`: fold accepted hunks into
  the page, keep the rest staged). Resolved changes stay in the feed as `applied`/`discarded` steps.
- **The text projection.** Pages are TipTap JSON; the agent and the diff work on a plain-text body
  (`lib/manuscriptText.ts`, byte-identical mirror of `manuscript-agent/shared.ts`). The inverse
  `docFromBody` is format-preserving: unchanged blocks keep their original JSON nodes.
- **The diff is live-vs-proposed.** `lib/manuscriptDiff.ts` diffs the CURRENT page text against
  `after` (blocks by LCS, then word hunks inside modified blocks). An in-place author edit after the
  proposal just shows up as more red/green — never silently overwritten.

## Web code — `apps/web/src/features/manuscript/`

| Dir | What |
|---|---|
| `pages/ManuscriptAgentPage.tsx` | the route shell: permissions, live book/pages + live run row, URL-carried selection (`?page=` / `?add=`), rail resize, Accept all / Reject all, the publish dialog for the agent's Publish unit |
| `components/chat/` | `ManuscriptChat` (feed + composer + model picker + past chats), `ChatStep` (user/note/read/finding/plan/action/applied/discarded), `StagedCard` (pending changes, resolvable in-chat) |
| `components/canvas/` | `PageCanvas` (delete banner · edit diff · in-place editor) + `AddPreview`, `DiffView` (hunk ✓/✗ on hover, block gutter ✓/✗), `PageEditor` (TipTap via `getEditorConfig`, autosave), `BookHeader` (title/subtitle/author, inline edit or diff), `SidePanel` (pages \| changes), `BottomNav`, `selection.ts` |
| `hooks/useManuscript.ts` | book + pages as a live projection (debounced refetch on Realtime) |
| `lib/` | `manuscriptText` (projection + inverse, tested), `manuscriptDiff` (engine, tested), `manuscriptAgent` (client + writes), `models` (picker list, mirrors `SELECTABLE_TIERS`) |

Cross-feature imports (deliberate, generic): `@/features/dna/lib/agentThread` for the session-archive
RPC wrappers; `@/components/book/shared/*` primitives; `@/components/editor/config/editorConfig`.

## Edge function — `supabase/functions/manuscript-agent/`

`index.ts` (protocol: `{bookId,message,model}` · `{runId,answer}` · `{runId,chain}`) · `advance.ts`
(one model call per link, in-worker continuation, cancel poll) · `tools.ts` (`read_pages`,
`search_pages`, `record_notes`, `propose_changes`, `ask_author`, `suggest_action`, `finish`) ·
`exec-tools.ts` (execution + `<book>` state + proposal validation against the live pages; `edits`
find/replace must match exactly once) · `transcript.ts` (compaction, notes ledger, cache breakpoints) ·
`prompts.ts` · `shared.ts` (types + the projection).

Model: `agentModelForTier(context_model)` else `getRoleModels().agent`. Watchdog: `revive_stalled_chains`
routes `kind='manuscript'` rows here (migration `20260927120000`). `verify_jwt=false` in config.toml,
same as book-agent.

## Build on top

### Canvas context and page links (2026-11-23, local implementation)

The composer names the open book/page/new-page preview. Messages and question answers send
`canvas: {kind, pageId? , changeId?}`; `canvas.ts` validates its shape, and `exec-tools.readCanvas`
checks book membership and archive state before recording the snapshot in the user/answer step.
The transcript retains a separate reference block for replay. This anchors “this page” without
restricting an explicit whole-book request. `lib/manuscriptContext.ts` re-exports the pure edge
contract, also used by the canvas's `Selection` type.

`CanvasAnchor` renders the same name in composer and message receipt. Receipts reopen existing
targets. `ChatStep` handles `[page name](?page=<stable id>)` links only for this book's live pages,
marks the current page, and preserves modified clicks. Missing targets remain plain text.
Fresh chats offer context-specific prompts that fill an editable draft. No migration is needed;
release the web app and `manuscript-agent` together. See
[the comparison and follow-ups](../../../../../docs/agentic-writing-experience.md).

### Tools v2 + calm transcript (2026-11-25)

Ported from Dottr's agent (`~/Code/dottr/dottr`, `docs/where/agent.md`):

- **Reads:** `search_pages` takes `match: phrase|word|regex` + `caseSensitive` and returns per-page
  counts; `read_chapter{sectionId}` reads a section and its pages (≤12); `check_prose{pageIds}` is a
  deterministic craft read (rhythm, echoes, filter words, hedges, -ly, openers) from the pure
  `manuscript-agent/analysis.ts`, which the web tests import directly.
- **Writes (staged):** `page_move` change kind (client `movedOrder` + `reorderPages`; banner above the
  page; ↕ marker in the pages panel); `replace_across_book` stages one `page_edit` per affected page
  (body + title, ≤60, skips pages with a staged edit); `withdraw_changes` lets the agent retract its
  own staged changes (runs first in a message, feed shows "Withdrawn", `step.by = "agent"`).
- **Memory:** `remember` / `forget` write `book_agent_runs.memory` (string[], ≤30); it rides in
  `<memory>` every turn and survives New chat (the session RPCs don't touch the column). The author
  sees and deletes entries from the 🔖 popover in the rail header (`forgetMemory`).
- **UI:** consecutive read/finding steps fold into one `WorkGroup` row ("Worked · read 5 pages · 1
  search"), which shows the current action while the turn is live; receipts whose target is on the
  canvas read "showing"; the composer pill has ✕ to leave the open page out of one message.

### Further extensions

- New change kinds: add to the `ManuscriptChange` union (both mirrors), validate in `exec-tools.ts`,
  write in `manuscriptAgent.acceptChange`, paint in `SidePanel`/`PageCanvas`.
- New smart chat units: a result-blind tool that pushes an `action` step; render in `ChatStep`; handle in
  the page shell's `onAction`.
- Page moves / merges / splits are the obvious next kinds; an auto-accept mode would mirror the Studio's
  `useAutoAccept` watcher over `acceptChange`.
