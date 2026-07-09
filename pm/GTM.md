# GTM — go-to-market (committed plan v1)

> Status: **committed plan v1.** Owner directive 2026-07-09: **monetize ASAP.** The revenue track
> now runs *parallel* to M1 instead of waiting behind M2. The old gate ("nobody pays to generate
> slop") still applies — but only to **generation** pricing. It never applied to the two surfaces
> that are already good: the mature Writing/publishing pillar and the import→structure pipeline
> (where the prose is the user's own truth). We sell those first.
> Snapshot date: **2026-07-09**.

## The strategy in one line

Sell the tool that already works (publishing + structure), use it to fund and market the tool
we're still proving (generation) — and let every published book be the ad.

## What's sellable today — honest inventory

| Surface | Maturity | M1-gated? | Monetizable now? |
|---|---|---|---|
| Writing pillar (editor, publish→web, EPUB/Kindle) | mature | no | **yes — R1** |
| EPUB import → DNA tree + semantic ascent (Layer A+B) | shipped | no (prose is user's) | **yes — R2** |
| Editor's-read eval (~$0.33 COGS) | shipped | no | **yes — R2 add-on** |
| Studio generation (brief → book) | pre-M1 | **yes** | not yet — R3 |

## The monetization ladder

### R1 — Pensive Pro subscription (target: first paying customer)
The fastest first dollar: a paid tier on the *mature* pillar. Free stays generous (it's the
funnel); Pro gates the power features.

- **Candidate gates:** unlimited books, Kindle delivery, publish-to-web on the marketing site,
  (later) custom domain. Exact split = open decision below.
- **Product build:** Stripe checkout + webhook → `entitlements` (or `profiles.plan`) →
  feature gating at the existing chokepoints. Billing portal for self-serve cancel.
- **Marketing build:** pricing page on the SSG marketing site (keep it static — standing rule).
- **Price hypothesis:** **$8/mo or $80/yr** (writing-tool comparable, not AI-tool comparable).
  Validate against first 10 conversations, not against our own guess.

### R2 — Paid structure: the import wedge (target: first per-unit revenue)
"Bring your messy AI draft, leave with a structured book." Unique, defensible, and COGS-bounded
(decompose cost ≪ generation cost — **measure it**, same `ai_calls` method as below).

- **Unit:** per-book fee or credit pack. Hypothesis: **$5–10/book** import+ascent, with the
  **editor's-read report bundled** ($0.33 COGS → high-margin perceived value: "here's what a
  structural editor sees in your draft").
- **Product build:** credits/one-time checkout on the same Stripe rails; gate `dna-decompose`
  behind it past N free imports.
- **Marketing build:** dedicated import-funnel landing page with a before/after (blob → tree →
  readable plan). This is the shareable artifact.

### R3 — Metered generation (gated on M1, unchanged)
Only after the builder reads a full self-generated book without the edit-reflex. Facts we hold:
~$10/book generation **upper bound** (dev-era, book 1192), input tokens dominate 16:1, errors
are ~24% of calls. Implication: per-book price ≥ **$20–25**, or metered credits, or **BYOK**
(sell the tool, not the tokens). Decision deferred until M1 + a clean cost rerun.

## Build lists (both tracks live in this repo)

**Product track (rails first, they serve all three rungs):**
1. Stripe integration: checkout, webhook → entitlement row, billing portal.
2. Plan/entitlement model + gating helpers at existing chokepoints (Kindle send, publish, import).
3. Metering substrate: `ai_calls` already logs per-book tokens — promote the scratchpad cost
   script to `scripts/gen-cost.mjs` and compute per-book COGS on demand.
4. Free-tier limits (N books, N imports) — the conversion pressure.

**Marketing track:**
1. **Unblock publish revalidation** (set REVALIDATE_SECRET) — precondition for artifact-as-ad;
   promoted from Next.
2. Pricing page (SSG) — R1 launch surface.
3. Import-funnel landing page with before/after — R2 launch surface.
4. Exemplar books published openly with DNA tree visible ("read the book, then look at its
   skeleton") — the SEO + proof loop; each M1-quality book compounds this.
5. Community posts (AI-writing subreddits, NaNo-adjacent) — only with an artifact in hand.

## Positioning (unchanged — the moat sentence)

> Not "AI writes prose" — **AI grows a book from a structure that remembers itself.**
> Continuity, causality, and series-canon are what clipboard workflows can't do.

Two doors, one product: story-first authors (brief → draft; R3) and AI-native authors
(import → spine; R2). R1 underwrites both.

## Pricing anchors (facts we have)

- Editor's-read eval: **~$0.33/book** (7.4k words, premium model).
- **Full-book generation: ~$10 observed upper bound** (book 1192, dev-era, measured 2026-07-08).
  Partial build (foundations + structure + 3 scenes, book 1229): **~$0.75**.
- Import/decompose cost: **not yet measured** — required before pricing R2 (same method below).

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
gap: per-word cost not yet computed. Anthropic bridge calls log zero/unpriced tokens, excluded.

## Sequencing (revised 2026-07-09)

```
                 ┌── R1 Pro sub (mature pillar) ──── first paying customer
monetize track ──┤
                 └── R2 import wedge ─────────────── first per-unit revenue
                                                          │
product track ─── M1 (builder reads own book) ── M2 ──────┴──▶ R3 metered generation
```

The two tracks run in parallel. What survives from the old gate: **no generation pricing before
M1**, and no paid channel spend before the funnel converts organically.

## Success metrics (owner scoreboard)

- Date of **first paying customer** (R1) and **first per-unit sale** (R2).
- MRR + unit sales, weekly.
- Funnel: marketing visit → signup → (import | publish) → pay.
- COGS per paid unit (from `ai_calls`) — margin must be visible per rung.

## Open questions (decide during R1 build, not before)

- Exact free/Pro gate split (which features convert without gutting the funnel?).
- R1 price point ($8/mo hypothesis — test in first 10 user conversations).
- R2 unit shape: per-book fee vs credit pack.
- Does the DNA tree itself become shareable/remixable content (network loop), or stay private?
- Category word ("book generator"? "story studio"? "structured ghostwriter"?) — needed for the
  pricing page copy; decide when writing it.
