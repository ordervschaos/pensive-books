# Feature: Novel DNA

> The "Build" half of the product. Turns a book's **brief** into a self-similar
> `book_nodes` tree (premise → logline → acts → beats → scenes → prose), then
> **renders** that tree into `pages` the reader reads. The DNA tree is the source
> of truth; pages are a projection.

This file is the **manifest** for the feature. The code lives in two deploy
targets (Vite web app + Supabase edge functions) that cannot physically share a
folder, so this doc is the single place that lists all of it.

---

## Interface with the rest of the app (the seam)

The coupling to the book editor is a **narrow data contract**, not function calls:

```
 ENTRY                         DNA (owns book_nodes)                 EXIT
 books row  ───────────────▶  generate / revise / meter  ────────▶  pages table
 (name, brief, foundations,    private model: book_nodes            (novelDnaRender
  canon, craft_notes)                                                reconcile → pages)
        ▲                                                                  │
   editor writes brief                                            reader/editor reads pages
```

- **Entry** = the `books` row. The editor writes `brief` (and `foundations`,
  `canon`, `craft_notes`); DNA reads them.
- **Private model** = `book_nodes` (+ `book_agent_runs`, `dna_chats`).
  Nothing outside DNA touches these.
- **Exit** = `lib/novelDnaRender.ts` reconciles `book_nodes` → `pages`. The
  editor/reader only ever read `pages`.

If you keep new DNA work behind this seam (books-in, pages-out, book_nodes
private), the editor never needs to know DNA exists.

---

## Web code — `apps/web/src/features/dna/`

| Dir | What |
|---|---|
| `pages/` | 5 route components: `DnaTreePage` (`/dna/tree/*` — the ONE studio surface, seven tabs: `overview` / `tree` / `taste` / `analytics` / `meters` / `characters` / `story`; `/books/:slug/dna` redirects to `/dna/tree`; the file is just the route shell — state, subscriptions, tab layout), `DnaMetersPage` (the standalone `/dna/meters` route — now just chrome + load/subscribe around the shared `MetersPane`), `DnaLedgerPage`, `DnaJsonPage`, `DnaArchitecturePage` (`/dna/docs/architecture`) |
| `components/` | 6 UI components: `AgentRail` (the agent thread rail), `TreeOverviewTab` (wraps `DnaOverview` in the tree's dark chrome for the `overview` tab), `DnaOverview`, `DnaStoryMap`, `DnaAnalysis`, `DnaStageDiagram` (now just `DnaFullDiagram`, Overview's shape panel) |
| `components/tree/` | the tree studio's UI, split out of `DnaTreePage` and layered by dependency: `treeChrome` (the **Console-on-Paper** token set `T` + `MONO`/`SERIF` stacks + kind colors + row geometry/style atoms + `QuickToggle` — the studio's Paper-DS-light skin, decision record in `docs/dna-studio-redesign-handoff.md`) → `nodeDisplay` (pure derivations: `nodeTitle`, field display strings, prose rollup) → `search` (pattern build/search + `Highlighted` + `SearchPanel`) → `EditableField` (the typed click-to-edit field) → `TreeRow` (row + kebab + backlinks + rollup badge) → `proposalOverlay` (`indexProposal`, phantom/diff rows, `ProposalPicker`) → `Subtree` (the recursive renderer + `TreeView` contract + groups/add-rows/prose block) · plus `staleActions` (the ONE accept/discard implementation for stale nodes), `BriefSection` (the origin editor), `panels` (`VoiceFeelPanel`/`JourneyStrip`/`FocusPanel`/`SpineTimeline`), `panes` (`StoryPane`/`CharactersPane`), `MetersPane` (the meters dashboard body — serial graph + shape/craft/cold reads; shared by the `meters` tab and the standalone `DnaMetersPage`), `modals` (`DiscardStoryModal`/`ProseReaderModal`/`HistoryModal`) |
| `hooks/` | `useAutoAccept` (auto-applies agent proposals) |
| `lib/` | engine + clients (DNA-only): `novelDna` (pure tree engine), `novelDnaRender` (tree→pages), `bookNodes` (DB load/save), `dnaSchema` (SSOT content schema + lints), `dnaChat`, `dnaExpand` (the generation engine; the agent drives it via `propose_expansion`), `dnaJourney`, `dnaProposals`, `agentThread`, `migrateToDna`, `meterRead`, `shapeRead`, `synopsisRead` (the plan-plane "editor's read" → `craft_flag`), `factLedger`, `confusionRead` (the cold-reader pass → `reader_confusion`), `agentCommands`, `treeVersions` (linear save-points history over `book_tree_versions`), `importEpub` (draft onboarding Layer A: epub → MigrationPages → `buildDnaFromStack` tree with locked user prose → `reconcileDna`; the generic epub parser is `@/lib/epubImport`, the inverse of `@/lib/epub`; entry point = "Import an .epub" on `pages/books/new/NewBook.tsx`), `dnaDecompose` (Layer B, the semantic ascent: per-chapter reads → beat rows + digests, then three folds via the `dna-decompose` edge fn — top rungs, entities (cast/relationships/locations/voice), and story systems (world_facts/threads/games/tentpoles/meters, with chapter-number links assembled into beat-level `threads`/`realizes`/`resolves` so the obligation ledger works on imports; games get twins via `reconcileGameTwins`); all writes ride `applyNodeOps`, finishing with a provenance re-stamp "seal"; trigger = `components/tree/DecomposeButton`, shown only on the fresh-import shape) (+ their `.test.ts`) |

Routes are registered in `apps/web/src/App.tsx`.

## Edge functions — `supabase/functions/` (cannot move; see below)

Invoked by the web layer above:
`dna-expand` · `dna-chat` · `book-agent` · `read-meters` · `read-facts` · `read-shape` · `read-synopsis` · `read-confusion` · `dna-decompose` (imported-draft semantic ascent; NOT bridge-mirrored — dev invokes the deployed fn directly)
(siblings `beats-agent`, `revise-node` also belong to the feature.)

The committed schema artifact `supabase/functions/_shared/dna-schema.json` is the
edge/bridge mirror of `lib/dnaSchema.ts`; the lock test
`lib/dnaSchema.artifact.test.ts` fails if they drift.

## Dev bridge — `scripts/eval-bridge.mjs`

Reimplements the edge pipeline for local dev (web calls `localhost:8787`, not the
deployed fn). **Every edge change must also land here** or features break only in dev.

---

## Shared substrate it rides (stays shared — do NOT fold into the feature)

**Web** (via `@/` alias, depth-independent): `@/integrations/supabase/client`,
`@/lib/bridge`, `@/lib/brief`, `@/lib/foundations`, `@/lib/stopRun` (universal
stop chokepoint), `@/hooks/useLatestTaskRow`, `@/hooks/use-toast`,
`@/components/book/shared/*` (studioUi, useChatScroll), `@/components/ui/*`.

**Edge** (`_shared/`): `llm.ts` (single AI-call chokepoint → `ai_calls` log),
`task.ts` (durable tasks), `brief.ts`, `cors`, `model-config`, `json`,
`self-chain`. (Live fns authenticate inline via `createClient` + `getUser()`;
the old `access.ts` auth helper was retired with the pre-pivot fn cluster.)

These are a deliberate **shared kernel**. DNA's edge fns intentionally route
through the single AI/task/auth chokepoints — duplicating them into the feature
would regress logging, durability, and unified-stop.

---

## Why edge fns are NOT in this folder

1. **Deployment constraint.** The Supabase CLI deploys functions only from
   `supabase/functions/<name>/`. They can't live under `features/dna/`.
2. **Shared kernel.** They depend on `_shared/claude|task|access`, used by 13–19
   other functions. Moving them would force duplicating those chokepoints.

So the feature is **physically split by deploy target, logically unified by this
manifest.** When extending DNA: web code → here; edge code → `supabase/functions/`
(mirror into `scripts/eval-bridge.mjs`); update this file.
