# The context trap, and a budgeted way out

> Design note for the manuscript agent (and, by extension, any agent here). Prompted by the book-727
> run: 74 pages read in ten batches, no notes banked, pages re-read after pruning, then a final call
> that spent 6000 output tokens thinking and returned nothing.

## The trap, named

An agent whose only memory is one growing transcript has three budgets that collide:

- **input** — what the model can hold (and what it costs to re-send every turn),
- **output** — what it can say; on reasoning tiers the thinking is billed *inside* this budget,
- **wall clock** — ~140 s per call on a Supabase worker, fixed.

Raising the first two buys a little. It does not touch the third, and reasoning time scales with
input, so a bigger window makes the last call *slower*, not safer. The 727 run is the shape exactly:
input climbed 3k → 38k → 44k → 61k tokens, and the final think outgrew the budget.

**The invariant we want:** at no point is a single call's context larger than a fixed budget, and no
piece of knowledge lives *only* in the transcript. Everything else follows from enforcing that in code
rather than hoping the model behaves.

## Five mechanisms, applied by shape of the work

### 1. Hard input budget with automatic fold (the invariant)
Before every call, measure the assembled prompt (we already log input tokens). If it exceeds
`CONTEXT_BUDGET` (~40k tokens to start), compact in order: stub raw tool results older than the newest
batch → if still over, summarise the oldest conversation turns into one `<conversation_summary>` block
with the cheap model → if still over, fail the turn loudly ("ask narrower") instead of sending it.
A raw `read_pages` result is **ephemeral by construction**: it lives in the transcript for one turn, and
the fold is what survives. This turns fold-on-read from a nudge into a rule.

### 2. Per-page digests, cached on the page (the map)
Compute once per page, by content hash, with the cheap tier: a one-line **gist** (~15 words) and a
~120-word **digest** (summary, entities present, open questions). Store on `pages.metadata.digest`
(same idea as the DNA tree's `prose_digest`, which the prose-context experiment showed reaches ~B-grade
continuity at a third of the tokens). Then `<book>` carries every page's gist (74 × 15 words ≈ 1.5k
tokens) and a `read_digests(ids)` tool returns the paragraph-level ones. Most "whole book" questions
become digest-reads plus a few targeted page-reads — the full sweep stops being the default move.

### 3. `scan_book` — map-reduce for genuinely whole-book questions (the split)
When the ask really needs every page (coherence, continuity of a thread, a character's timeline), the
agent should not hold the book at all. `scan_book({ question, pageIds? })` runs server-side: one small
cheap call per chunk of ~5 pages answering the question for that chunk (parallel, each ~10 s), then one
reduce call merging the chunk answers into a compact report with page refs. The transcript receives
only the report (~1–2k tokens). Each call is bounded, parallel, and fits the wall clock; the whole scan
costs about one full read of the book on the cheap tier. Result is also banked as notes automatically.

### 4. Output-side controls (the reply)
- Reasoning **effort by turn shape**: low for read/scan turns, medium for proposal turns.
- **Continuation**: a reply that stops at `max_tokens` with partial text gets one "continue from where
  you stopped" turn (the text is kept), rather than being treated as complete.
- An **empty** completion is prodded once at low effort, then ends with an honest note (shipped today).
- Big changesets split across turns by design (already in the prompt); `edits` over full `after`.

### 5. A router, so the right tool is picked "when needed"
The model chooses tools, but `<book>` should tell it the shape of the job: total tokens in the book,
what `read_pages` returns at most per call, and the rule of thumb — small book (< ~15k tokens): read it
all; targeted ask: search + read; whole-book ask on a big book: digests first, `scan_book` if the
question needs every page. The policy lives in one place in the prompt and is backed by the budget in
mechanism 1, so a wrong pick degrades to a compaction, never to a silent empty turn.

## What "increase the limits" actually buys
`max_tokens` 8000 (done) and a 1M-context tier are worth having, but they move the cliff, they do not
remove it. Keep them; do not count on them.

## Success criteria (book 727, 74 pages, ~60k tokens)
1. "Look for story coherence" returns a substantive, page-referenced answer.
2. No single call above `CONTEXT_BUDGET`; no empty completion; no page read twice in a run.
3. ≤ 6 model turns in the agent loop (scan calls counted separately, in parallel).
4. Cost per run attributable from `ai_calls` and lower than the sweep it replaces.

## Order of build
1 (budget + ephemeral reads) → 2 (digests, gist in `<book>`) → 3 (`scan_book`) → 4 (continuation,
effort-by-shape) → 5 (router text). Each step is useful on its own; 1 alone removes the failure class.
