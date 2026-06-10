# Learning: Beat best-of-n (Milestone 2, piece 3)

- **Best-of-n sampling**
  - Literal: generate n candidates, keep the best.
  - What it is: quality scales with n at ~linear cost; trades compute for a better draft without a better prompt.
  - Here: the bulk build samples 3 beats/page in parallel and a judge keeps one. Beats are one paragraph → cents per page.

- **Sampling temperature for spread**
  - What it is: higher temperature widens the distribution so the n samples actually differ (else best-of-n collapses to near-duplicates).
  - Here: candidate beats are sampled at `temperature: 1`; the judge runs at `temperature: 0` for a stable pick.

- **LLM-as-judge (pick, not score)**
  - What it is: a cheap call ranks candidates against criteria and returns just the winner's index — no rubric scoring overhead.
  - Here: `pickBestBeat` weights therefore/but causality > value flip > subtext > concrete image > objective; replies with only a number; `max_tokens: 8`.

- **Graceful degradation**
  - What it is: each optional step fails soft so the pipeline never hard-fails on a quality add-on.
  - Here: a failed candidate sample is filtered out; a judge hiccup falls back to the first sample; n=1 keeps the original single-call behaviour for the attended/sync path.

- **Targeted spend (where the lever pays)**
  - What it is: apply the expensive technique only where it compounds.
  - Here: best-of-3 is on in the bulk build's beat phase (the rung everything below inherits), but the interactive single-beat workshop stays a fast single sample (`candidates` defaults to 1).
