# Novel DNA — build spec

**Status:** build spec. Implements `novel-as-json.md` (the model) and generalizes
`structure-as-render.md` (pages are a render) to the whole ladder. The **information-flow graph** (what
generates from what, brief → book) is `novel-dna-flow.md` — the core of the system.

**The one idea:** a book is a **single self-similar tree** the author builds rung by rung. The tree is
the source of truth for *everything* — premise, characters, structure, and prose. **Chapters and pages
are not in the tree; they are projections of it** (a partition and a pagination). The author works four
verbs at every depth — **expand · choose · edit · lock** — and the data carries authoring state so the
AI does the heavy lifting and never overwrites intent.

This **retires** the heterogeneous stack (`brief`/`foundations`/`spine`/`outline` columns + page-native
beats/prose) in favor of one node store. `pages` stays — but only as the **render target**.

---

## 1. The whole thing in one picture

```
DNA TREE (authoring — the source of truth)            RENDER (reader-facing, derived)
─────────────────────────────────────────            ───────────────────────────────
seed                                                   (no render)
 └ premise                                             (no render)
    └ pillar                                           (no render)
       └ movement ×3–5                                 (no render — structural)
           └ beat ×~3                                  (no render — causal skeleton)
               └ scene ×~3   ← leaf; owns its prose     scenes partition into CHAPTERS:
                  · plan: goal/conflict/outcome/shift    each chapter ──► [ section page (title)
                  · prose: the actual text                                 + text page (its scenes' prose, flowed) ]
                                                         page_index, est_pages = derived
```

- **Reading order** = depth-first leaf order of the tree (movements→beats→scenes).
- **Chapter** = a contiguous partition of that scene order (see §4). Pure derived grouping.
- **Page** = a render unit produced by `reconcile()` (§8). Pure projection.
- Nothing below "scene" is authored on a page; a page is *assembled* from scenes.

---

## 2. The self-similar node

One shape at every level. Four verbs (§6) act on it identically.

```jsonc
{
  "id": "n_a3f",
  "book_id": 1169,
  "parent_id": "n_root",
  "level": 5,                     // 0..5 (entities sit on the pillar's branch, level 2-ish)
  "kind": "scene",               // ladder: seed|premise|pillar|movement|beat|scene
                                  // entities (§3b): character|relationship|tentpole|world_fact
  "position": 2,                 // order among siblings

  "content": { /* kind-specific — §3. A scene's prose lives here too: content.prose.text */ },

  "authoring": {
    "source": "ai_then_user",    // user | ai | ai_then_user  (who wrote current content)
    "locked": false,             // user pin → hard constraint downstream; regen never overwrites
    "status": "accepted",        // empty | proposed | draft | accepted
    "src_hash": "a91f"           // hash of the PARENT content this was generated from (§6 staleness)
  },

  "proposals": [ { "id": "p1", "content": {} }, { "id": "p2", "content": {} } ],
  "chosen": "p1"
}
```

`authoring` is what turns flat DNA into a build system. `src_hash` replaces the doc's stored `stale`
boolean — **staleness is derived, not stored** (a node is stale iff `hash(parent.content) ≠ src_hash`),
reusing the `cyrb53` edge-hash machinery already in `planProvenance.ts` / `plan-provenance.ts`. Storing a
dirty bit drifts under concurrency; a hash never does (learned in `multiresolution-outline.md`).

---

## 3. The rungs

> Field-level authority lives in **`novel-dna-schema.md`** (the complete data contract — every field,
> its fill-source, and the render-completeness predicate). This section is the summary.

Each rung's *ask* is small, and prefers "choose a proposal" over "fill a blank". Cognitive load is
front-loaded onto L2 (the human core the AI can't guess) and tapers to "voice corrections" at the leaf.

| L | kind | `content` shape | author's bounded job |
|---|---|---|---|
| 0 | seed | `{ logline }` | give the idea, or pick a proposal |
| 1 | premise | `{ genre[], tone[], dramatic_question, shape:{setup,turn1,turn2,turn3,resolution} }` | steer the turns + ending |
| 2 | pillar | `{ controlling_idea, ending }` + a **cast/world branch** (§3b) | **supply wound + lie** (on the protagonist character node) |
| 3 | movement | `{ goal, turning_point, value }` (×3–5) | place the turning points |
| 4 | beat | `{ summary, connector:"therefore"\|"but", threads:[{promise,kind}] }` | which promises matter |
| 5 | scene | `{ pov, loc, present[], goal, conflict, outcome, value_shift, advances[], realizes_tentpole?, prose:{ text, src_hash } }` | tweak shifts / order; voice |

Fan-out (geometric): 1 → 1 → 1 → ~4 → ~12 → ~40. The **scene is the leaf**: it carries both its *plan*
(L5 spec) and its *prose* (`content.prose.text`). Prose is the scene at full resolution; it has its own
`prose.src_hash` (vs the scene plan) so a plan edit marks only the prose stale — the existing
beat→prose dirty edge, now scene-internal.

**Beat↔scene fan-out (settled):** a `beat` is **always** its own row; a beat with a single scene is
normal (a thin beat renders 1:1). Keeps the tree uniform — never collapse L4 into L5.

Book-level constants that aren't rungs and aren't entities (one per book): **voice exemplar**,
**narration default**, **canon** (sequels). Keep on `books` — they're settings, not ladder content.

### 3b. Entities — the cast/world branch (foundations, as nodes)

Foundations is **not a rung.** Its content splits two ways: *ladder content* that compresses down (→
`pillar.controlling_idea`, `pillar.ending`, premise `shape`) and *entity registries* that many nodes
**reference**. Entities are first-class nodes — same shape, same four verbs — on a branch off the pillar,
distinct from the narrative spine:

```
pillar ──┬── (narrative spine)  movement → beat → scene
         └── (cast & world)     character ×N · relationship ×N · tentpole ×N · world_fact ×N
```

| kind | content | maps from today |
|---|---|---|
| character | `{ name, role:"protagonist"\|"antagonist"\|…, want, need, wound, lie, truth, idiolect, tag }` | `foundations.cast` |
| relationship | `{ a:<char id>, b:<char id>, bond, charge }` | `foundations.relationships` |
| tentpole | `{ summary }` — `authoring.status` ∈ proposed/accepted = **fluid/pinned**; archived = **killed** | `foundations.tentpoles` |
| world_fact | `{ rule }` | `foundations.world` |

- The four verbs are unchanged: `expand(pillar→cast)` proposes characters; `lock(character)` pins the
  protagonist's wound+lie as a hard constraint on all downstream `expand`; a tentpole's status/locked IS
  the fluid/pinned/killed model.
- **Scenes/beats reference entities by id** (`scene.content.pov`, `present[]`, `realizes_tentpole`,
  `advances[]`→relationship/thread ids). Cross-links, **not** parent edges. Replaces
  `tentpoles[].placed_page_id` with a scene reference.
- Entities **do not render** (like premise/pillar). They constrain generation and surface as a "bible".

---

## 4. Chapters — a partition, not a container

A chapter does **not** contain scenes; it marks a **boundary** in the scene order. Scenes stay the single
source of truth; a chapter is derived metadata over a contiguous run.

**Representation (chosen):** a chapter boundary lives on the scene that *starts* it —
`scene.content.chapter_start = { title, pov?, epigraph? } | null`. A chapter is the run from one
boundary scene up to (not including) the next. This is partition-pure: no ranges to keep consistent, no
gaps or overlaps possible, reorder/insert updates chapters for free.

- Derived view (for UI/API): `chapters = [{ index, title, pov?, epigraph?, scene_ids:[…], word_count, est_pages }]`
  computed by scanning scenes in reading order. `word_count = Σ scene prose words`; `est_pages =
  word_count / wpp(layout)`. Never stored.
- *Alternative considered:* a separate `chapters[]` with `scene_range:[first,last]` (the author's sketch).
  Richer object, but the range can fall out of sync with the scene list — rejected for the boundary form,
  which yields the same derived object without the consistency burden.

---

## 5. Storage

### `book_nodes` (new — the tree)

```sql
create table public.book_nodes (
  id         text primary key,                                  -- 'n_…' (stable; client or server minted)
  book_id    integer not null references public.books(id) on delete cascade,
  parent_id  text references public.book_nodes(id) on delete cascade,
  level      smallint not null,                                 -- 0..5
  kind       text not null,                                     -- ladder + entity kinds (see check)
  position   integer not null default 0,                        -- order among siblings
  content    jsonb not null default '{}'::jsonb,                -- kind-specific (scene prose under content.prose; entity refs by node id)
  authoring  jsonb not null default '{}'::jsonb,                -- { source, locked, status, src_hash, prose_src_hash }
  proposals  jsonb,                                             -- [{ id, content }]
  chosen     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint book_nodes_kind_chk check (kind in (
    'seed','premise','pillar','movement','beat','scene',        -- ladder
    'character','relationship','tentpole','world_fact'))        -- entities (§3b)
);
create index book_nodes_book_idx   on public.book_nodes (book_id);
create index book_nodes_parent_idx on public.book_nodes (book_id, parent_id, position);
-- RLS mirrors books: author-only CRUD via user_can_edit_book(book_id); readers never see the tree.
```

Why a table, not one `books.dna` jsonb: prose lives in the tree (40 scenes × ~1.5k words ≈ 0.5 MB), per-node
ops (lock/expand/propagate any node) are row-level, and Realtime per-row keeps the studio a live projection.
The whole tree is still ~100 rows + prose — cheap to read with one `book_id` query.

### `pages` (unchanged role) — the render target

Reconcile writes `pages` (section + text). `pages.metadata.node_id` now points at the **chapter** the page
renders (boundary scene id) — same projection contract as `structure-as-render.md`, one level up.

### Retired once at parity (§10)

`books.outline`, and the `brief`/`foundations`/`spine` columns become L0–L5 nodes. `book_threads` may stay
(cross-cutting promise tracking) but anchors move to node ids.

---

## 6. The operations

Everything the author does is one of these. All but `expand` are pure tree edits (cheap; no render).

**`expand(node)` — the ease.** Generate the next rung as *proposals*.
```
inputs   = node.content  +  every LOCKED ancestor (hard constraints)  +  accepted siblings (local coherence)
children = LLM.generate(inputs, n=2..3 per child slot)        // seeded by craft defaults (Save the Cat / Snowflake / Dramatica)
write child rows: status="proposed", proposals=[…], src_hash=hash(node.content)
// author picks → chosen set, status="accepted", source="ai"
```
Reuses the lens/options machinery (`_shared/lens.ts`, `objective-options`, candidate+judge).

**`edit(node)` / `lock(node)` — the control.**
```
edit: content=userValue; source = was-empty ? "user" : "ai_then_user"; bump updated_at
lock: authoring.locked=true     // injected as a hard constraint into every downstream expand(); regen skips it
```

**`propagate` — derived, on read.** No stored sweep. Staleness is computed over a node's full **input
set** (parent + locked ancestors + any **referenced entities**), not just the parent — this is the doc's
own `inputs`, so cross-links dirty correctly (edit a character's lie → its scenes go stale):
```
inputHash(n) = hash(parent.content  +  Σ content of entities n references)   // pov, present, realizes_tentpole, advances
stale(child) = inputHash(child) ≠ child.authoring.src_hash
stale(prose) = hash(scene.plan)  ≠ scene.authoring.prose_src_hash
```
- A **locked** node that is stale → surface "ancestor changed — review?" (kept, never overwritten).
- An **unlocked** stale node → eligible for regenerate.
- **Blast radius** (shown before any regen): `count of unlocked descendants whose src_hash ≠ current parent hash`.

**`regenerate(subtree)` — the lock-safe sweep.**
```
regen(n): if n.locked: return                     // STOP — protected subtree
          if stale(n): expand(n.parent for n's slot); restamp src_hash
          for c in children(n): regen(c)
```

---

## 7. Validation (cheap; catch the worst failures)

- `expand(n)` allowed only if `parent.status == "accepted"` (enforces ladder order / progressive disclosure).
- Every L4 `thread.promise` resolves to a later scene that `advances`/closes it (setup index < payoff index).
- Every L5 scene has a non-empty `value_shift` (no flat "and-then" scenes).
- Every non-first beat in a movement has `connector ∈ {therefore, but}`.
- A regenerate sweep never mutates a `locked` node.
- After any edit, show the newly-stale count **before** regenerating (visible blast radius).

---

## 8. Render — `reconcile(book)` (DNA → pages)

Generalizes the `structure-as-render` reconcile from scene→page to **chapter→pages**. Pure projection,
incremental (only changed rows write), non-destructive (archive, never delete).

```
scenes  = DFS leaf order of the tree (movements→beats→scenes)
chapters = partition scenes by chapter_start boundaries (§4)
for each chapter (in order):
  ensure SECTION page  (node_id = chapter.boundarySceneId)  title = chapter.title
  ensure TEXT page     (node_id = chapter.boundarySceneId + ":body")
        content = concat(scene.prose.text for scene in chapter, flowed with paragraph breaks)
  page_index = running order
archive pages whose chapter no longer exists
est_pages / word_count = derived for display (never stored)
```
v1: one text page per chapter. Length-based pagination (split a long chapter across text pages) is a later
display concern; the contract (chapter is the page-level unit) doesn't change.

`generate-book` (the beats→prose cascade) is replaced by **`expand` down to scene prose**; reconcile then
assembles pages. Reconcile sits downstream of all authoring, exactly as today.

---

## 9. Migration (from the current stack)

Tractable because the backfill already stamped `pages.metadata.node_id`, so page prose maps cleanly to a scene.

| From | To |
|---|---|
| `books.brief` | `seed` (logline) + `premise` (genre/tone/dramatic_question/shape) |
| `books.foundations` | `pillar` (cast→protagonist want/need/wound/lie/truth; world→world_rules; argument→controlling_idea); pins → `authoring.locked`; voice → book-level |
| `books.spine` | `premise.shape` + `movement.turning_point`s |
| `books.outline.nodes` | `section`→`scene.chapter_start`; `scene`→`scene` (objective→goal/summary, `pages.metadata.beat`→a `beat` parent or scene plan) |
| `pages.content` | `scene.content.prose.text` (via `pages.metadata.node_id`) |

Run per book; idempotent; sets `src_hash`es so nothing reads stale on day one. Start with #1169 (the clean
test dupe) end-to-end before touching live books.

---

## 10. Phasing (each phase shippable + verifiable)

1. ✅ **Engine + schema (done).** `book_nodes` table (migration `20260621120000`, pushed; RLS +
   realtime). `lib/novelDna.ts` = node types (the schema contract) + pure ops (editContent/lock/
   chooseProposal), input-set hash staleness (reuses `cyrb53`/`metaHash`, follows references not just
   parents), `scenesInOrder`/`chapters` projections, `blastRadius` (prunes at locks), `validate`,
   `renderBlockers`. 13 unit tests (`novelDna.test.ts`). No UI/LLM yet.
2. ✅ **Render (done).** `lib/novelDnaRender.reconcileDna` (DNA→pages, chapter partition + prose concat),
   incremental + idempotent (keyed on `metadata.node_id="ch:…"`). Pure `renderPages` in `novelDna.ts`,
   tested.
3. ✅ **Migration (done).** `lib/migrateToDna.ts`: pure `buildDnaFromStack` (brief/foundations/spine/
   pages → tree; pins→locks; legacy pov-name→char id; one movement, a beat per chapter, scene per text
   page; prose carried) + `migrateBookToDna` (load+rebuild+save). Tested; data shapes validated against
   real books. Test book #1171 (full copy of #1150 with pages) ready.
4. ✅ **UI (done).** `/books/:slug/dna` → `DnaStudioPage` + `DnaStudio` — one uniform `NodeCard`
   (edit/lock/delete, status+stale chips) for every kind, manual expand (add child slots), Migrate +
   Render actions, render-completeness banner. Live projection of `book_nodes`. (LLM `expand`/proposals
   = Phase 5.)
5. ✅ **`expand` LLM (all rungs).** `dna-expand` edge fn (deployed) + bridge mirror + `lib/dnaExpand.ts`.
   **Default expand = ONE authoritative value, NOT 2–3 proposals** (author edits/regenerates/locks after).
   Target-keyed: seed→premise, premise→pillar, pillar→{cast, world, acts}, movement→beats, beat→scenes,
   scene→prose — so a **blank seed generates the whole book**. Locked ancestors + MANDATE in the prompt.
   UI: per-node "generate" verb(s) (a pillar offers cast/world/acts); single-child targets hide once made.
   Studio primitives. TODO: optional proposals path; full two-pane Navigator/Stage shell.
6. **Retire.** Drop `books.outline` + the `brief`/`foundations`/`spine` columns once parity is proven.

---

## 11. Decisions

**Settled**
- **Beat↔scene fan-out:** a beat is always its own row; a beat with one scene is normal (thin beat → 1:1). (§3)
- **Foundations:** ladder content onto seed/premise/pillar; cast/relationships/tentpoles/world as **entity
  nodes** on the pillar branch, referenced by scenes by id. Same node, same four verbs. (§3b)
- **Staleness** follows references, not just parents (input-set hash). (§6)
- **Voice/narration/canon:** book-level settings, not nodes.

**Still open (don't block Phase 1)**
- **Threads:** declare promises in L4 `content.threads`, keep `book_threads` as the tracked/scanned
  instance anchored by node id? (lean: yes.)
- **One text page per chapter** vs length-split — v1 = one; confirm.
- **Node id minting:** client (`n_…`) vs server default — lean client, for optimistic edits.
