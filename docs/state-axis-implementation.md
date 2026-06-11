# State Axis: Three Ledgers Alongside the Resolution Ladder

**Purpose**: Input document for implementing character state, causality, and promise/payoff tracking alongside the existing generation pipeline. Read this before touching any code.

---

## What exists today

### The ladder (vertical axis — resolution refinement)

```
Brief → Spine → Objectives (per page) → Beats (per page) → Prose (per page)
```

Each rung is an edge function. All functions share a single context-assembly pattern in `_shared/generate-unit-core.ts`.

**Edge functions**:
| Function | Path | What it does |
|---|---|---|
| `brief-to-spine` | `supabase/functions/brief-to-spine/index.ts` | Derives the throughline from the brief. Synchronous. |
| `spine-to-objectives` | `supabase/functions/spine-to-objectives/index.ts` | One-to-many: designs all chapters + pages as objectives. Async task row. Also generates thread plan (setup/payoff page indices). |
| `objective-to-beat` | `supabase/functions/objective-to-beat/index.ts` | Expands one page's objective into a concrete beat plan. Synchronous. |
| `beat-to-prose` | `supabase/functions/beat-to-prose/index.ts` | Renders prose from beat (or objective). Calls `beatToProse()` in shared core. |
| `generate-page` | `supabase/functions/generate-page/index.ts` | Durable wrapper around `beatToProse` / `revisePage`. One page, task row, Realtime. |
| `generate-book` | `supabase/functions/generate-book/index.ts` | Self-chaining orchestrator: writes all empty pages sequentially, one per invocation. |
| `generate-bible` | `supabase/functions/generate-bible/index.ts` | Drafts/extracts the bible (characters, world, style) as static markdown. |

**The shared core** (`supabase/functions/_shared/generate-unit-core.ts`):
- `beatToProse()` — the write path: reads beat from `pages.metadata.beat`, builds context, calls Claude
- `revisePage()` — the revise path: reads existing prose, builds context, calls Claude
- `buildUnitContext()` — **THE context assembler** — called by both. This is where state injection must happen.
- `renderProse()` — actual Claude call
- `maybeSummarize()` — after writing, runs a cheap Haiku call to produce a 1-2 sentence summary stored in `pages.metadata.summary`

### Context passed into every prose render today

Built in `buildUnitContext()` + assembled in `stablePrefix()` / `variablePart()`:

```
BOOK name
BRIEF (genre, audience, premise, tone, success criteria)
BOOK BIBLE (books.bible.text — static markdown: characters, world, style, names)
OUTLINE (all pages + their objectives, current page marked)
STORY SO FAR (summaries from pages.metadata.summary for pages before the -2 window)
PRECEDING PROSE (full text of the last 2 prior text pages)
THIS PAGE'S OBJECTIVE
THIS PAGE'S BEAT (if one exists — pages.metadata.beat)
```

### What the bible already has

`generate-bible` produces markdown with these sections:
```
## Premise
## Characters        (name — role; their want, their wound/flaw; voice in one line)
## World & Setting
## Style & Voice     (POV, tense, tone, diction notes)
## Names & Terms
```

The character section already names want and wound — but it's **static text**, not a structured object, and never updated as the story progresses.

### Threads (already partially built)

`spine-to-objectives` outputs a `threads` array in its scaffold JSON:
```typescript
interface ScaffoldThread {
  name: string;
  description: string;           // what it promises / how it pays off
  setupPageIndex: number | null;
  payoffPageIndex: number | null;
  targetDistance: number | null; // estimated words setup→payoff
}
```
`scan-threads` is a separate edge function that scans existing prose for threads. The DB table `book_threads` (or similar) exists. But threads are **not passed into prose renders today** — they're a planning artifact, not a live input.

### Data storage locations

```
books table:
  brief     JSONB  — genre/audience/premise/tone/scope
  spine     JSONB  — { text, brief_hash }
  bible     JSONB  — { text } (the static markdown)

pages table:
  metadata  JSONB  — { objective, beat, summary, prose_src_hash, ... }
  content   JSONB  — Tiptap doc (the prose)

book_generations table:
  kind      TEXT   — 'scaffold'|'write_all'|'page_write'|'page_revise'|'bible'|...
  result    JSONB  — the artifact (scaffold JSON, generated text, etc.)
  progress  JSONB  — for self-chaining orchestrators
```

---

## What's missing: the state axis (horizontal — flows through time)

The ladder refines resolution top-down. Stories need three things flowing *left to right* through the sequence:

```
Brief → Spine → Chapters → Beats → Pages
  │       │        │         │       ↑
  └──── Character ledger ────┼───────┤
  └──── Promise ledger ──────┼───────┤
        Causality check ─────┘  Style guide
                              + prev-page tail
```

### Ledger 1: Character state

**What**: Each character carries a state object that must be updated at every beat. The state tracks what they currently know, feel, have, and believe. The arc of the story is the diff between their initial state and final state.

**Structural shape** (proposed):
```typescript
interface CharacterState {
  name: string;
  want: string;       // external goal (stable across whole book)
  wound: string;      // internal flaw/belief (stable — the thing the arc resolves)
  believes: string;   // their current worldview/conviction (changes)
  knows: string[];    // facts they currently hold (changes)
  feels: string;      // emotional state right now (changes per beat)
  has: string[];      // objects/resources/relationships (changes)
}
```

**Where it lives**: `pages.metadata.character_states: CharacterState[]` — each beat render emits the updated states, stored on the page that triggered them. The NEXT page's beat generator reads the prior page's states as input.

**Where it gets seeded**: `spine-to-objectives` already designs the whole book. Add a character scaffold pass here — or add it to `generate-bible` (which already has the want/wound section). Better: make `spine-to-objectives` emit `characterLedger: CharacterState[]` (initial states) alongside `pages[]` and `threads[]`. Store in `books.metadata.character_states_initial` or `books.bible` (extended).

**Where it gets updated**: In `objective-to-beat` — the beat generator must take `currentCharacterStates` as input and emit `updatedCharacterStates`. Save the updated states to `pages.metadata.character_states` on the beat's page. The `generate-book` orchestrator must pass prior page's states forward when chaining pages.

**Where it flows into prose**: In `buildUnitContext()` (the context assembler in `generate-unit-core.ts`) — load the character states from the most recent preceding page and add them to the prompt.

### Ledger 2: Causality

**What**: Each beat must connect to the previous one via "therefore" or "but" — never "and then." This is a constraint, not context. It kills episodic drift.

**Where to enforce**: In `objective-to-beat` — the beat prompt must:
1. Receive the PREVIOUS page's beat text
2. Be instructed to begin from a "therefore" or "but" relationship with it
3. Explicitly reject "and then" connections

**Current gap**: `objective-to-beat` already receives the outline (all objectives) but does NOT receive the adjacent beats. It sees the skeleton, not the connective tissue.

**Implementation**: In `objective-to-beat`, after loading the outline, also load `pages.metadata.beat` for the immediately prior text page. Pass it as `PRECEDING BEAT` in the prompt with the instruction: *"Your beat must connect to the preceding beat with 'therefore' (your page follows because of it) or 'but' (your page collides with or complicates it). Never 'and then.'"*

**Scene value flip**: Also add to the beat prompt: *"Identify the value at stake on this page (e.g. safe/endangered, ignorant/aware, connected/isolated). The beat must end with that value in a different position than it started."* This is McKee's scene/sequel rule.

### Ledger 3: Promise/payoff (open loops)

**What**: Track every promise made (question raised, setup planted, secret hinted) with its planned payoff location. The beat generator must end chapters with at least one open loop.

**What already exists**: The `threads` array from `spine-to-objectives` is exactly this — but it's never injected into renders. It's a planning artifact that sits unused after scaffold time.

**What needs to change**:

1. **At beat generation** (`objective-to-beat`): Load the thread list for the book. Tell the model which threads are "open" (setup has been written, payoff hasn't yet), which threads are seeded on THIS page (setupPageIndex matches), and which pay off on THIS page. The beat must honor these.

2. **At prose render** (`generate-unit-core.ts` / `buildUnitContext`): Pass an `OPEN LOOPS` block listing threads that are currently open — with a `reveal` or `withhold` flag based on whether this page is the payoff page. The prose renderer should neither accidentally resolve nor ignore them.

3. **Thread state tracking**: The scaffold has `setupPageIndex` and `payoffPageIndex` (0-based indices into the initial page array). After pages are created, these become page IDs. Need to track: has the setup been written? has the payoff been written? Could store as `book_threads` rows with a `status: 'planned'|'setup_written'|'paid_off'` field, or in `books.metadata.thread_status`.

---

## The four problems this fixes

1. **Characters reset each chapter** → fixed by character state flowing forward page-by-page
2. **"And then... and then..." plot** → fixed by the causality constraint in beat generation
3. **No page-turners** → fixed by open-loop tracking: beat generator required to leave one open per chapter
4. **Prose coherence across pages** → partially already fixed (precedingProse + storySoFar). Remaining gap: character states and open loops not in context.

---

## Implementation insertion points (in priority order)

### P1: Causality in beat generation
**File**: `supabase/functions/objective-to-beat/index.ts`

Add to the DB query: load the beat from the immediately preceding text page.
```typescript
// After loading pages[], find the preceding text page:
const currentIdx = pages.findIndex(p => p.id === pageId);
const precedingTextPage = pages.slice(0, currentIdx).filter(p => p.page_type === 'text').at(-1);
const precedingBeat = precedingTextPage?.metadata?.beat?.trim() || null;
```
Add to the prompt (in `variablePart`):
```
PRECEDING PAGE'S BEAT (connect to this — "therefore" or "but", never "and then"):
<beat text>

VALUE AT STAKE: identify one value this page holds (e.g. safe/endangered). 
The beat must move that value to a different position by its end.
```

**Impact**: Immediate improvement on sequential coherence. No schema change needed. 30-line change.

### P2: Inject open loops into prose render
**File**: `supabase/functions/_shared/generate-unit-core.ts` → `buildUnitContext()`

Load the book's threads (from `books.metadata` or `book_threads` table). Determine which are open (planned but not yet paid off). Add to context:
```
OPEN LOOPS (promises made to the reader — honor these; do not accidentally resolve or ignore):
- "The scar": reader knows it means something; DO NOT REVEAL yet
- "The letter": planted on page 3; THIS PAGE is where it pays off — RESOLVE it
```

**Impact**: Fixes accidental resolution of open loops and forgotten setups. Requires knowing thread status per page.

### P3: Character state in beat generation
**File**: `supabase/functions/objective-to-beat/index.ts`

Load `pages.metadata.character_states` from the most recent prior page. Add to the prompt:
```
CURRENT CHARACTER STATES (update these in your beat — each character must be affected):
- Elara: knows [X, Y], feels desperate, has the key, believes trust is weakness
- Marcus: knows [X], feels hopeful, has nothing, believes she's the enemy
```

The beat response should include updated states (structured output or a separate pass). Store in the page's metadata after the beat is saved.

**Schema change**: Add `character_states: CharacterState[]` to `pages.metadata`. Add `character_states_initial: CharacterState[]` to `books.metadata` (seeded at `spine-to-objectives` time or manually in the bible).

**Impact**: Characters accrete history through the story rather than resetting.

### P4: Style guide in prose render
**File**: `supabase/functions/_shared/generate-unit-core.ts` → `stablePrefix()`

Extract from the bible's `## Style & Voice` section (it's already there as text) and promote it to a top-level cacheable block. No new schema needed — parse `bible.text` for the `## Style & Voice` heading.

Also: add "last ~200 words of the preceding page" as a dedicated field (`voiceTail`) separate from `precedingProse`. The current system passes entire prior pages (up to 2); for voice continuity specifically, only the last 200 words of the immediately previous page matter. Less token usage, more focused.

---

## Key design decisions for the implementer

**Q: Where do character states live — in `pages.metadata` or a separate table?**
A: `pages.metadata` is correct for now. Each page's beat render produces a snapshot of all character states at that moment. Reading "current state before page N" = query the last page before N that has `metadata.character_states`. No new table needed.

**Q: Should beat generation return structured JSON (beat + character states) or two passes?**
A: Two passes is simpler: first call returns the beat text (unchanged interface). Second cheap call (`claude-haiku`) extracts the updated character states from the beat text. This avoids breaking the current `{ beat: string }` response shape.

**Q: The `generate-book` orchestrator writes pages sequentially — does character state flow correctly?**
A: Yes, because `generate-book` writes one page at a time sequentially. If character states are stored on each page's metadata, the next invocation naturally reads the freshest state from the database. No orchestrator changes needed for reads — only the beat + prose generators need to query for it.

**Q: Threads — `book_threads` table or `books.metadata`?**
A: A `book_threads` table already exists (from `scan-threads`). Add a `status` column (`planned|setup_written|paid_off`) and a `setup_page_id` / `payoff_page_id` FK (complementing the existing index-based plan). The `generate-book` orchestrator updates thread status as pages are written.

---

## Files to read before implementing

1. `supabase/functions/_shared/generate-unit-core.ts` — the context assembler and prose renderer. Every change to what Claude sees happens here.
2. `supabase/functions/objective-to-beat/index.ts` — beat generator. Causality + character state inputs go here.
3. `supabase/functions/spine-to-objectives/index.ts` — the scaffold. Character ledger initial state gets seeded here.
4. `supabase/functions/generate-book/index.ts` — the self-chaining orchestrator. Understand the `advance()` function — this is where character state would be forwarded between pages.
5. `apps/web/src/lib/ladder.ts` — the client-side entry point for all transforms. Any new structured output from `objective-to-beat` needs a new response field here.
6. `supabase/functions/scan-threads/index.ts` — existing thread infrastructure to reuse.

---

## What NOT to change (load-bearing, do not touch)

- The `{ beat: string }` response shape of `objective-to-beat` — clients depend on it
- The `{ text: string }` response shape of `beat-to-prose` / `generate-unit-core`
- The `stablePrefix` / `variablePart` caching split — stable prefix is cached with `cache_control: ephemeral`; only the variable part changes per page. Injecting character states into the variable part preserves this.
- `supabase/functions/_shared/task.ts` / `self-chain.ts` / `plan-provenance.ts` — the durable task infrastructure. Don't restructure these.
