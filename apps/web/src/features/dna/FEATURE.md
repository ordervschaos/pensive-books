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
| `pages/` | 4 route components: `DnaTreePage` (`/dna/tree/*` — the ONE studio surface, three tabs: `overview` / `tree` / `taste`; `/books/:slug/dna` redirects to `/dna/tree`), `DnaMetersPage`, `DnaLedgerPage`, `DnaJsonPage` |
| `components/` | 6 UI components: `AgentRail` (the agent thread rail), `TreeOverviewTab` (wraps `DnaOverview` in the tree's dark chrome for the `overview` tab), `DnaOverview`, `DnaStoryMap`, `DnaAnalysis`, `DnaStageDiagram` (now just `DnaFullDiagram`, Overview's shape panel) |
| `hooks/` | `useAutoAccept` (auto-applies agent proposals) |
| `lib/` | engine + clients (DNA-only): `novelDna` (pure tree engine), `novelDnaRender` (tree→pages), `bookNodes` (DB load/save), `dnaSchema` (SSOT content schema + lints), `dnaChat`, `dnaExpand` (the generation engine; the agent drives it via `propose_expansion`), `dnaJourney`, `dnaProposals`, `agentThread`, `migrateToDna`, `meterRead`, `shapeRead`, `synopsisRead` (the plan-plane "editor's read" → `craft_flag`), `factLedger`, `confusionRead` (the cold-reader pass → `reader_confusion`), `agentCommands` (+ their `.test.ts`) |

Routes are registered in `apps/web/src/App.tsx`.

## Edge functions — `supabase/functions/` (cannot move; see below)

Invoked by the web layer above:
`dna-expand` · `dna-chat` · `book-agent` · `read-meters` · `read-facts` · `read-shape` · `read-synopsis` · `read-confusion`
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

**Edge** (`_shared/`): `llm.ts` (single AI-call chokepoint → `ai_calls` log,
used by ~19 fns), `task.ts` (durable tasks, ~13), `access.ts` (auth, ~14),
`brief.ts` (~12), `cors`, `model-config`, `json`, `self-chain`.

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
