# GTM — go-to-market (working draft)

> Status: **thinking surface, not a committed plan.** The hypothesis (NORTH_STAR §1) must clear
> first — GTM before a readable book is premature scaling. But we sketch now so the product
> decisions (pricing chokepoints, onboarding wedges) are made with distribution in mind.
> Snapshot date: 2026-07-08.

## The wedge (what we already have)

Pensive is not starting from zero: it has authors, a book editor, and a **publishing path**
(book → statically-generated marketing site → EPUB/Kindle). The Studio is the generation engine
that fills that existing pipe. GTM is therefore *"add generation to a publishing tool,"* not
*"launch an AI writing app into a crowded market."*

## ICP (ideal customer profile) — two entry doors, one product

| | AI-native authors | Story-first authors |
|---|---|---|
| Arrive with | Generated prose blobs (paste workflow) | A story idea and a blank page |
| Door | **EPUB/text import → DNA tree** (Layer A shipped, Layer B = the magic) | **Brief → generated draft** (the ladder) |
| Promise | "Your prose, with a spine — continuity handled" | "Answer a few small questions, get a readable draft" |

## Positioning (the moat sentence)

> Not "AI writes prose" — **AI grows a book from a structure that remembers itself.**
> Continuity, causality, and series-canon are what clipboard workflows can't do.

## Channels (candidates, unvalidated)

1. **SEO via the marketing site** — already statically generated for this reason; published
   generated books are themselves indexable proof-of-work. (Standing rule: keep it SSG.)
2. **The artifact as ad** — a genuinely readable generated book, published openly with its DNA
   tree visible, is the demo. "Read the book, then look at its skeleton."
3. **Import funnel** — "bring your messy AI draft, leave with a structured book" is a shareable
   before/after.
4. Author communities (NaNoWriMo-adjacent, AI-writing subreddits) — only with the artifact in hand.

## Pricing anchors (facts we have)

- Editor's-read eval: **~$0.33/book** (7.4k words, premium model) — the eval-cost baseline.
- **Full-book generation: ~$10 observed** (book 1192, measured 2026-07-08 — see spec below).
  Partial build (foundations + structure + 3 scenes, book 1229): **~$0.75**.
- Directional shape: free Writing pillar (existing), paid Studio generation (metered or
  per-book), *after* M1/M2.

### Generation-cost measurement (spec — rerun per finished book)

**Method.** Aggregate `ai_calls` for a `book_id` (sum `input_tokens`/`output_tokens` grouped by
`fn` × `model`), price each model via OpenRouter's live pricing API
(`GET https://openrouter.ai/api/v1/models` → `pricing.prompt`/`pricing.completion` are $/token).
A working script exists from the 2026-07-08 session (scratchpad `gen-cost.mjs`); promote to
`scripts/` when we rerun.

**Measured (2026-07-08).** Book 1192 ("Mastering Freedom v2", 120 pages, agent-pipeline era,
window 06-24 → 07-02): **$10.27**, 1,213 calls (292 errored), 21.5M input / 1.36M output tokens.

**What the money actually buys — three findings that matter:**
1. **Input tokens dominate 16:1.** The agent loop (`book-agent` on qwen3.7-plus) alone re-read
   16.7M input tokens to emit 0.3M output = $5.73 of the $10.27. The cost lever is *context
   re-send per agent turn* (prompt caching / trimming), not cheaper prose models.
2. **Errors are ~24% of calls** and their tokens are billed (e.g. 51 failed `revise-agent`
   retries still cost real money). Reliability work is also cost work.
3. **Premium-model cameos are visible:** 50 gpt-5 `revise-agent` calls = $1.85 (18% of total
   from 4% of calls). Model routing policy is a pricing decision.

**Caveats.** 1192 spans dev iteration (experiments, retries), so ~$10 is an *upper bound* for
"one book"; a clean rerun on the next finished book gives the honest unit cost. Denominator
gap: per-word cost not yet computed (prose lives in rendered pages; 1192's page rows carry
content in a format the old fetch script doesn't parse — resolve when rerunning). Anthropic
bridge calls (`claude-code-local` etc.) log zero/unpriced tokens and are excluded.

## Sequencing gate

```
M1 (builder reads own book) ──▶ M2 (someone else reads one) ──▶ publish exemplars ──▶ open funnel ──▶ paid tier
```

No channel spend, no launch, no pricing page before M2. Until then GTM work = keep the publishing
pipe healthy (revalidation unblock), measure per-book cost, and collect exemplar books.

## Open questions (for review sessions)

- What's the *category* word? ("Book generator"? "Story studio"? "Structured ghostwriter"?)
- Is the first paid unit a subscription, a per-book fee, or bring-your-own-key?
- Does the DNA tree itself become shareable/remixable content (a network loop), or stay private?
