# METRICS — outcomes, not output

> Snapshot date: **2026-07-09**. Append a dated row when a metric is measured; never overwrite —
> the trend is the point. Where WORKLOG/STATE track **output** (what shipped), this tracks
> **outcome** (did it move the needle?). Without this file, the PM three-hats question "is the
> roadmap moving the North Star?" is answered from memory — and memory is exactly what this whole
> system exists to distrust.

## The North Star metric

**Read-through depth on a self-generated book** — how many pages the builder reads before the
edit-reflex fires (stops are dissatisfaction, not boredom). The bar for **M1 (The First Read)**:
a full book, no edit-reflex. (NORTH_STAR §2.)

Secondary signals (directional, measure when cheap): generation ease (steps/time brief→book),
intuitiveness (can a non-builder drive the Studio unaided).

## Read-through log

> One row per measured read. `depth` = pages before the first edit-reflex / total pages. Note the
> book id, the model/pipeline version, and the dominant stop reason — that's what makes a number
> actionable rather than a vibe.

| Date | Book | Pipeline / model | Depth | Dominant stop reason |
|---|---|---|---|---|
| (baseline) | — | pre-digest Studio | **~4 pages** | edit-reflex (repetition; verbatim prev-page context) |

*Next measurement is the ROADMAP "Now" item — the live full-book build re-exercise (§v1/§v4
fixes). Log its read-through depth here when run.*

## Unit economics (COGS)

> The revenue track (GTM.md) needs per-unit cost, not guesses. Measure via the `ai_calls` method;
> log numbers here as they're taken.

| Metric | Value | Source / date | Notes |
|---|---|---|---|
| Editor's-read eval | **~$0.33 / read** | 7,381 words, opus-4-7 | Baseline for R2 add-on pricing |
| EPUB decompose (import) | *unmeasured* | — | R2 precondition — measure before pricing the import wedge |
| Full generation (brief → book) | *unmeasured* | — | Gen-cost method; promote `scripts/gen-cost.mjs`, close per-word denominator |

## How this feeds the review

In every `/pm` three-hats pass, the **PM hat** reads this file: if read-through depth hasn't been
measured since the last shipped read-through work, that's a finding — output moved, outcome
unknown. The **Owner hat** reads the COGS table before any pricing decision lands in GTM.md.
