# Learning — the Causality Axis (Novel DNA's 4th analytic axis)

Concepts encountered building "make causality computable" for book 1171.

## Story / craft

- **Causal spine** — "spine" = the load-bearing through-line of a plot. The chain of beats where each one *causes* the next. We made it a computable object, not a vibe.
- **"And then" vs "therefore / but"** (Trey Parker / Matt Stone rule) — if you can join two beats with "and then" the story is episodic; good stories join with "therefore" (consequence) or "but" (reversal). The `connector` field already labeled this; we made the label *checkable*.
- **Promise / payoff vs precondition** — promises (threads) are reader-facing ("this will matter later"); preconditions (`needs`) are plot-facing ("this beat can't happen unless X already happened"). Different ledgers, same setup→payoff shape.
- **Deus ex machina / Lester Dent's law** — a win must fire a rule the reader already knows. The pre-existing grounding lint; causality is the same idea applied to *every* turn, not just the climax.

## Architecture / patterns

- **Semantic→structural decomposition** — the recurring trick of this whole system: turn a fuzzy quality claim into a named slot you can check. Dangling promise → thread with no payoff scene. Deus-ex → win with no `grounds_in`. *Hollow causality → a `therefore` whose `needs` no earlier beat `establishes`.* Each capability is the same move on a new axis.
- **Producer / consumer (state) graph** — each beat `establishes` (produces) state keys and `needs` (consumes) them. Walk in reading order accumulating produced keys; a need not yet produced = unmet. This is a **DAG** (directed acyclic graph) — acyclic because needs can only point *backward* in reading order.
- **Generalization over duplication** — instead of new `produces` field, reused the experiment's existing `establishes` as the producer set; added only `needs`. The removable preconditions experiment shrank to just `game.win_requires` + `illegal_resolution` (a special case of the general axis).
- **Open vs closed vocabulary** — the experiment filtered `establishes` to a *closed* set (the game-win precondition keys). Causality needs an *open* snake_case vocabulary the generator coins per beat, so the filter was dropped.
- **Four-mirror propagation** — every generation change lands in 4 places: engine (`novelDna.ts`), edge fn (`dna-expand`), bridge (`eval-bridge.mjs`), client (`dnaExpand.ts`) — plus the flow driver. Drift in any one = "works in dev, breaks in prod" (or vice-versa).
- **Non-destructive probe / dry-run** — `runDnaExpand` *returns* the beat sheet; persistence is the client's job. So regenerating 1171's beat sheet through the bridge inspects generation output without touching its 41 live scenes.
- **False positive on the boundary** — `empty_but` fired on beat 0 (the opener has no prior beat to reverse). Both causal lints are *antecedent-relative*, so the first beat in reading order is exempt — same `idx === 0` guard the older `beat_connector` lint already uses.

## The headline finding

The causality layer **auto-produced the fix we'd hand-patched before.** The `redemption_fund` (Mara's money — earlier a "she had enough all along" deus-ex) is now structurally `established` at beat 9 (she counts her peculium) *before* it's spent at beat 11, with `peculium_started` seeded back at beat 1. The generator, told every `therefore` must depend on an upstream `establishes`, closed the whole 15-beat DAG with **zero unmet needs** — the unearned-resource bug becomes structurally impossible, not just caught after the fact.
