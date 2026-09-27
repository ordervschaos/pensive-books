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

- New change kinds: add to the `ManuscriptChange` union (both mirrors), validate in `exec-tools.ts`,
  write in `manuscriptAgent.acceptChange`, paint in `SidePanel`/`PageCanvas`.
- New smart chat units: a result-blind tool that pushes an `action` step; render in `ChatStep`; handle in
  the page shell's `onAction`.
- Page moves / merges / splits are the obvious next kinds; an auto-accept mode would mirror the Studio's
  `useAutoAccept` watcher over `acceptChange`.
