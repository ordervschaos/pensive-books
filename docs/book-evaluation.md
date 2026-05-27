# The Editor's Read — Book Evaluation

## Overview

"The editor's read" gives an author an AI **developmental edit** of their manuscript:
a holistic verdict, a prioritized fix-list, and section-by-section notes (character,
plot, pacing, dialogue, prose, genre contract, world-building, resonance, mechanics) —
every issue backed by a quote and a deep-link to the page it's on.

It runs **Claude (`claude-opus-4-7`)** against a fixed fiction rubric. A run takes
~30–90s and is **author-only** (owners and accepted editors). Each run is stored as a
row in `book_evaluations`, so re-running after a revision keeps a history rather than
overwriting.

It surfaces on the book detail page (`BookDetails.tsx`) under the brief summary, gated
by `canEdit`.

---

## Two backends (env-switched)

The same UI component talks to one of two evaluators, chosen at build time by the
`VITE_EVAL_BRIDGE_URL` env var:

| | **Edge function** (default / production) | **Local bridge** (dev) |
|---|---|---|
| Trigger | `VITE_EVAL_BRIDGE_URL` unset | `VITE_EVAL_BRIDGE_URL` set (e.g. `http://localhost:8787`) |
| Who runs Claude | Supabase edge function → Claude **API** (metered) | Claude **Code** on your machine (zero API cost) |
| Where the report lives | `book_evaluations` row | `reports/<bookId>-read.json` on disk |
| Async model | insert `pending` row, finish in background, Realtime push | bridge runs the slash command, returns when done |
| Cost | ~$0.33 per 7,381-word run (see [Cost](#cost)) | $0 (uses your Claude Code session) |

Both produce the **identical `result` JSON shape**, so the rendering code is shared.
The local bridge exists for zero-cost iteration on the rubric and the report design.

This doc focuses on the **edge-function path** (the product), then summarizes the bridge.

---

## System architecture (edge-function path)

```
┌──────────────────────── USER BROWSER ────────────────────────┐
│  BookEvaluationSection.tsx (author-only)                      │
│   • "Get feedback →"  ──invoke──┐         ┌── Realtime push   │
│   • renders Report              │         │   (pending→done)  │
└─────────────────────────────────┼─────────┼──────────────────┘
                                  │         │
                  functions.invoke│         │postgres_changes
                                  ▼         │  (UPDATE filter)
┌─────────────────────── SUPABASE ──────────┼──────────────────┐
│  evaluate-book edge function (Deno)        │                  │
│   1. auth.getUser()  + access check        │                  │
│   2. refuse non-fiction (by brief band)    │                  │
│   3. INSERT book_evaluations (pending) ────┼──► returns 202   │
│   4. EdgeRuntime.waitUntil( runEvaluation )│   in ~1s         │
│        ├─ fetch pages → buildManuscript     │                  │
│        ├─ callClaude (api.anthropic.com)    │                  │
│        └─ UPDATE row (done | error) ────────┘ (fires Realtime) │
│                                                                │
│  Postgres: book_evaluations (RLS, in supabase_realtime pub)   │
└────────────────────────────────────────────────────────────────┘
                                  │
                     x-api-key    ▼
                 ┌──────── Anthropic API ────────┐
                 │  POST /v1/messages             │
                 │  claude-opus-4-7, adaptive     │
                 │  thinking, cached rubric        │
                 └────────────────────────────────┘
```

### Why the background task

A developmental edit is a 30–90s Claude call — longer than a comfortable HTTP request.
So the function **does not** make the client wait:

1. Insert a `pending` row and **return it immediately (202)**.
2. Do the slow work in `EdgeRuntime.waitUntil(...)` (survives past the response).
3. `UPDATE` the row to `done`/`error` when finished.
4. The browser, subscribed via **Supabase Realtime**, gets the `UPDATE` and renders.

This is the standard Supabase pattern for work that outlives the request.

---

## Request lifecycle

```
Client                evaluate-book fn            Anthropic           Postgres
  │  invoke({bookId}) ──►                                                │
  │                    auth + access check                              │
  │                    band ∈ nonfiction? ─► 400 "rubric isn't ready"   │
  │                    INSERT pending ───────────────────────────────►  │
  │  ◄── 202 {evaluation:{id}}                                          │
  │  watchRow(id): subscribe channel book_eval_<id>                     │
  │                    [background] fetch pages ◄──────────────────────  │
  │                    buildManuscript (tiptap→text, tag page ids)      │
  │                    callClaude ──►  reads ~30–90s ──►                │
  │                    ◄── JSON result                                   │
  │                    UPDATE done/error ────────────────────────────►  │
  │  ◄═══════════ Realtime UPDATE (postgres_changes) ═══════════════════│
  │  applyRow → render Report                                           │
```

The client also **re-fetches the row once** right after subscribing (`watchRow`), to
catch a completion that landed in the gap before the subscription went live. On mount
it loads the latest row, so a finished report shows instantly and an in-flight one
resumes watching.

---

## Data model

Migration: `supabase/migrations/20260527000000_create_book_evaluations.sql`.

### `book_evaluations` table

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` identity | PK |
| `book_id` | `integer` → `books(id)` | `on delete cascade` |
| `created_by` | `uuid` | defaults to `auth.uid()` |
| `created_at` | `timestamptz` | |
| `kind` | `text` | `fiction` \| `nonfiction` (default `fiction`) |
| `model` | `text` | e.g. `claude-opus-4-7` |
| `status` | `text` | `pending` \| `done` \| `error` |
| `word_count` | `integer` | manuscript size **at run time** (for staleness) |
| `brief_snapshot` | `jsonb` | the brief used, for compare/staleness |
| `result` | `jsonb` | the editor's read — the UI contract (below) |
| `error` | `text` | failure message when `status='error'` |

Index: `(book_id, created_at desc)` — "latest report for this book" and history.

**One row per run.** An evaluation is a point-in-time event ("on this date, at N words,
the editor said X"), not a living document. Re-running adds a new row so the author can
see progress across drafts.

### Access control (RLS)

Reports are **author-only — the same surface as editing the book**. A `SECURITY DEFINER`
helper decides:

```sql
user_can_edit_book(_book_id) := owner_id = auth.uid()  OR  user_is_book_editor(_book_id)
```

`user_is_book_editor` is the existing helper (`access_level='edit' AND status='accepted'`).
Routing the check through `SECURITY DEFINER` avoids the `books`↔`book_access` RLS
recursion that was fixed in `20260520000002`.

- `SELECT` / `INSERT` / `UPDATE` policies all gate on `user_can_edit_book(book_id)`.
- These govern **client** reads (initial load + Realtime) and any client writes.
- The edge function writes with the **service role**, which is RLS-exempt — so the
  background task can always finish even though the client only has read access.

### Realtime

The table is added to the `supabase_realtime` publication (guarded `ALTER PUBLICATION`)
so the browser learns of `pending → done` without polling.

---

## The edge function

`supabase/functions/evaluate-book/index.ts` (+ `rubric.ts`).

### Request handling (`Deno.serve`)

1. **Auth** — user-context client (forwards the `Authorization` header) → `auth.getUser()`.
2. **Access** — fetch the book; allow if `owner_id === user.id` or an accepted
   `book_access` row exists (mirrors `generate-flashcards`).
3. **Fiction-only guard** — if `brief.scope.band ∈ {essay, guide, nonfiction_book,
   comprehensive}`, return `400 "The non-fiction rubric isn't available yet."`
4. **Insert pending** with the service-role client, return `202 {evaluation}`.
5. Hand `runEvaluation(...)` to `EdgeRuntime.waitUntil`.

### Manuscript assembly (`buildManuscript`)

- Fetches non-archived `pages` ordered by `page_index`.
- Each page is converted to plain text: **tiptap JSON → text** (recursive walk; block
  types add `\n\n`, `hardBreak` → `\n`), falling back to stripped `html_content`.
- Each page is tagged so the model can cite **real** ids:
  ```
  [id=42 · #3 · "The Long Road" (section divider)]
  ```
- The author's brief is injected as **"the contract to judge against"** (scope band +
  word target, genre, audience, premise, tone, success criteria).
- `word_count` is computed and stored.

### Claude call (`callClaude`)

Raw `fetch` to `https://api.anthropic.com/v1/messages` (no SDK in the Deno function):

- `model: "claude-opus-4-7"`, `max_tokens: 20000`
- `thinking: { type: "adaptive" }` — adaptive thinking is GA on Opus 4.7
- `system` is two blocks: the editor persona (`EDITOR_SYSTEM`) + the rubric
  (`FICTION_RUBRIC`) with `cache_control: { type: "ephemeral" }`. The rubric is stable
  across books, so **prompt caching** makes re-runs cheaper.
- The user message is the assembled manuscript + "return JSON only, no fences".
- Response: filter `content` for `type === "text"` (4.7 omits thinking text by default).

### Defensive parse (`parseResult`)

The model is told "JSON only", but the parser still strips ```` ```json ```` fences and,
failing that, slices from the first `{` to the last `}`, then **shape-checks** that
`verdict` and a `sections[]` array are present before saving.

### The prompt / rubric (`rubric.ts`)

A deployed edge function can't read repo files, so the rubric is **embedded** in
`rubric.ts` — an in-sync copy of `knowledgebase/evaluation/fiction-evaluation-criteria.md`.
It carries:

- **`EDITOR_SYSTEM`** — the developmental-editor persona: the 60/40 reading stance
  (Edward Weeks), evidence-for-every-claim, cite-the-page-using-only-given-ids,
  actionable, honest-but-constructive, identify the genre contract first — plus the exact
  output JSON contract.
- **`FICTION_RUBRIC`** — the 9-section criteria (Character, Plot, Pacing, Dialogue,
  Prose & Style, Genre Contract, World-Building, Emotional & Thematic Resonance,
  Presentation & Mechanics) and a closing synthesis checklist.

> ⚠️ **Keep in sync:** if `knowledgebase/evaluation/fiction-evaluation-criteria.md`
> changes, update `rubric.ts` to match — they are two copies of one rubric.

---

## The `result` contract (shared shape)

Written by the evaluator, read by `BookEvaluationSection.tsx`. Both backends emit this.

```jsonc
{
  "verdict": {
    "genre_contract": "what the editor identified",
    "stance": "short holistic label",
    "letter": "2–4 sentence editorial letter",
    "priorities": ["highest-leverage fix", "next", "next"]
  },
  "sections": [
    {
      "id": "character",          // character|plot|pacing|dialogue|prose|
                                  // genre_contract|world_building|resonance|mechanics
      "title": "Character",
      "stance": "needs work",     // strong | solid | needs work
      "assessment": "the editor's read of this dimension, in prose",
      "strengths": ["evidence-backed positive", "..."],
      "issues": [
        {
          "severity": "high",     // high | medium | low
          "note": "the problem",
          "evidence": "exact quote or moment",
          "suggestion": "concrete revision",
          "page_ref": { "id": 42, "title": "The Long Road", "index": 3 }  // or null
        }
      ]
    }
  ]
}
```

Only applicable sections are emitted (e.g. World-Building only for speculative/historical
work). `page_ref.id` is always a **real** page id from the manuscript — the UI renders it
as a deep-link `/books/<bookId>/pages/<id>`.

---

## The client component

`apps/web/src/components/book/BookEvaluationSection.tsx`, wired into `BookDetails.tsx`
behind `canEdit`.

- **State machine:** `checking → idle | running | done | error`.
- **On mount (edge path):** load the latest `book_evaluations` row. `done` → render;
  `pending` → show "reading…" and `watchRow(id)`; `error` → show message; none → `idle`.
- **`run()`** → `runEdge()` calls `supabase.functions.invoke("evaluate-book", {body})`,
  then `watchRow(evaluation.id)`. Surfaces the function's own `{error}` (e.g. the
  non-fiction message) via `error.context.json()`.
- **`watchRow(id)`** subscribes to `channel(book_eval_<id>)` on `postgres_changes`
  `UPDATE` filtered by `id=eq.<id>`, plus the one-shot race re-check.
- **Rendering** (`Report` + `SectionCard`): editorial letter, genre/stance `<dl>`,
  numbered priorities, collapsible section cards with a stance badge, strengths (`+`),
  severity-marked issues (`⚠/●/·`), evidence in quotes, suggestion (`→`), and the page
  deep-link (`↪`). Styled with the `pv-*` design tokens.

---

## Deploy & operate

The function and migration live in the repo; deploying needs the Supabase CLI.

```bash
# one-time
supabase login
supabase link --project-ref qiqeyirtpstdjkkeyfss

# data model
supabase db push                                   # applies the migration

# secret + function
supabase secrets set ANTHROPIC_API_KEY=<key>       # the only required secret
supabase functions deploy evaluate-book
```

Secrets read by the function: `ANTHROPIC_API_KEY` (set as above); `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (provided by the platform).

**Smoke test:** `OPTIONS` → 200 (CORS), `POST` with no auth → 401. A real end-to-end run
needs a logged-in owner and spends tokens.

---

## Cost

Measured 2026-05-27, first live run: **~$0.33** for a **7,381-word** fiction manuscript
(`claude-opus-4-7`, adaptive thinking, rubric prompt-cached). Scales roughly linearly
with word count for rough estimates; re-runs are cheaper on the cached rubric portion.
Revisit if the model or rubric size changes.

---

## Local bridge (dev path)

For zero-cost iteration, set `VITE_EVAL_BRIDGE_URL=http://localhost:8787` in
`apps/web/.env.local` and run the bridge. Then **Claude Code** (your own session) is the
evaluator — no Anthropic API spend.

- `scripts/fetch-book.mjs <bookId>` → writes `reports/<bookId>-manuscript.md` (metadata,
  brief, every text page tagged with its `id:` and `page_index`).
- `.claude/commands/evaluate-book.md` — the `/evaluate-book <bookId>` slash command:
  Claude Code reads the manuscript + `knowledgebase/evaluation/fiction-evaluation-criteria.md`,
  evaluates, and writes both a human-readable report and `reports/<bookId>-read.json`
  (the same `result` shape).
- `scripts/eval-bridge.mjs` — a tiny local HTTP server the component polls:
  `GET /eval/<id>` returns the stored JSON; `POST /eval/<id>` triggers a run.

`reports/` holds private manuscript text and is **gitignored** — it never leaves your
machine.

---

## Limitations & future work

- **Fiction only.** Non-fiction is refused by the brief's scope band; the non-fiction
  rubric isn't wired up yet.
- **Single-shot context.** The whole manuscript goes to Claude in one request. Opus 4.7's
  1M context covers most books, but a very long book will eventually need **map-reduce**
  (evaluate in chunks, then synthesize).
- **Staleness affordance (designed, not built).** `word_count` and `brief_snapshot` are
  stored so the UI can later show "this read is N words / a brief-change out of date" and
  offer a past-reads history.

---

## Files

| File | Role |
|---|---|
| `supabase/migrations/20260527000000_create_book_evaluations.sql` | table, `user_can_edit_book`, RLS, Realtime |
| `supabase/functions/evaluate-book/index.ts` | the evaluator (request + background run) |
| `supabase/functions/evaluate-book/rubric.ts` | embedded editor persona + fiction rubric |
| `apps/web/src/components/book/BookEvaluationSection.tsx` | UI: trigger, watch, render |
| `apps/web/src/pages/books/show/BookDetails.tsx` | mounts the section (canEdit) |
| `knowledgebase/evaluation/fiction-evaluation-criteria.md` | canonical rubric (keep `rubric.ts` in sync) |
| `scripts/fetch-book.mjs` · `scripts/eval-bridge.mjs` · `.claude/commands/evaluate-book.md` | local zero-cost dev path |
