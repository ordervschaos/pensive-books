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

## Remaining
- `supabase functions deploy revise-chat` to ship to prod (dev already live via bridge).
