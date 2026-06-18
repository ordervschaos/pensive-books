# Learning — wiring the knowledge base into the spine reviser

Task: turn a dead reference doc (`shapes-of-stories`) into live craft knowledge the spine
reviser reasons against. Implemented as the **template** for wiring any KB doc into any lens.

## Named concepts encountered

- **Knowledge base (KB)** — a curated reference library (here `knowledgebase/*.md`). In this task: 25k words on disk, but **the deployed edge fn can't read files** (not bundled), so most of it was inert until distilled.

- **Distillation bridge** — the pattern of hand-copying the load-bearing slice of a `.md` doc into a `_shared/*.ts` string constant so a deployed function can see it. Precedents: `lens.ts` (structures), `beat-criteria.ts` (eval rubric). This task added `story-shapes.ts` as the third instance.

- **Lens (as architecture)** — in `revision-chat.ts`, each revision *layer* (foundations/spine/outline/beats) is a `Lens` object = `system` prompt + `context()` + `sanitize()`. "Lens" literally = a frame you look *through*. The `context()` method is the ONLY channel craft knowledge reaches the model per turn.

- **Diagnostic frame vs. template** — the load-bearing framing rule: injected craft knowledge is a frame to find what's *missing/sagging*, NEVER a mold to force the book into. Enforced in the `system` prompt ("the brief/argument/ending win every time"). Copied verbatim from `lens.ts`'s self-description.

- **Shapes of stories (Vonnegut)** — a story's emotional trajectory as one line: good↔ill fortune (y) over beginning→end (x). Six recurring shapes (Man in Hole, Boy Gets Girl, Cinderella, From Bad to Worse, Which Way Is Up?, Creation). Here: distilled into a spine-diagnostic — "which line is this book drawing, and where does the spine break it?"

- **Single-writer / bridge duality** — the reviser runs through `revise-chat` edge fn (prod) OR a local `bridgeFetch` (dev). Both import the same `_shared/revision-chat.ts`, so the change goes live in dev immediately; prod needs a `functions deploy`.

- **Wire contract vs. server-only context** — `revisionChat.ts` (client) and `revision-chat.ts` (edge) mirror *types* that cross the wire. `STORY_SHAPES` is prompt context, not a wire type → only the edge copy changed; no client edit needed.

## The template (replicate for other lens ← doc pairs)

1. Write/refresh the canonical `knowledgebase/.../<doc>.md` (human source of truth).
2. Create `_shared/<doc>.ts`: distill the load-bearing slice into a `Record`/array → render one
   exported prompt-block string. Keep it small (item + the 1–2 failure modes it catches).
3. In `revision-chat.ts`: `import` it, append to the target lens's `context()`, and add ONE line
   to that lens's `system` telling it to use the block as a diagnostic frame.
4. `deno check` the new module in isolation; the lens edits are string-concat (typecheck-safe).

Next candidates: `character-engine.md → foundations` lens (zero craft today),
`outlining.md → outline` lens.

## Tier 2 — per-book editable craft (added after the template landed)

The full vision: each step has craft knowledge so generation isn't "random and noob" —
a **two-tier** layer, mirroring the foundations pin model (system baseline + author edits).

- **Two-tier craft** — TIER 1 = immutable *system craft* (distilled KB const, e.g. `STORY_SHAPES`); TIER 2 = editable *book craft* (`books.craft_notes[layer]`). The lens stacks them: system = floor, author's note = taste that wins on style. Generalized in `revision-chat.ts` via a `SYSTEM_CRAFT` map + `craftContext(layer, note)` helper that every lens appends — so the editable tier works for all four layers even before they have a system default.
- **jsonb-on-row (vs. new table)** — chose `books.craft_notes jsonb` keyed by layer over a `craft_notes` table. Mirrors `books.foundations` / `books.canon`; no joins; rides the existing books Realtime stream (refresh = no-op). Per-book scope was the user's call.
- **Scope decision** — global-per-user vs per-book vs both. Picked **per-book**: a thriller and a memoir carry different house style. Empty by default → falls back to system tier only.
- **Merge-don't-clobber write** — `saveCraftNote` reads the jsonb, spreads, sets/deletes one layer's key, writes back — never drops the other layers (same shape as `writeSpinePatch`).
- **Loose-typed supabase client** — `books.foundations`/`spine`/`craft_notes` aren't in the generated `types.ts`, yet select/update compile via `as` casts. Mirrored that instead of regenerating types.
- **Disclosure (progressive disclosure)** — the `CraftNote` editor is a collapsed `▸` toggle under the step content; absent until opened, a `·` marks it has content. Keeps the calm chat-first surface uncluttered.

### Data flow (tier 2)
`CraftNote` (per step) → `saveCraftNote` → `books.craft_notes[layer]` → edge `revise-chat`
selects `craft_notes` → `ctx.craftNote = craft_notes[layer]` → `craftContext()` appends it
under the system craft in that layer's lens prompt.

## Status
- Tier 1 spine template: shipped (`story-shapes.ts` wired into spine lens).
- Tier 2 editable craft: shipped end-to-end (migration pushed, `revise-chat` deployed, spine UI mounted).
- Replicate next: distill tier-1 system craft for foundations (`character-engine.md`), outline (`outlining.md`), beats (already has `lens.ts`); mount `<CraftNote>` in those three steps (one line each).
