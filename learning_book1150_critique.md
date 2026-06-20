# learning — critiquing book 1150 "mastering freedom"

Concepts encountered while reading the manuscript + studio data and diagnosing build quality.

## Scene-craft (showed up in the per-page `beats`)
- **Value charge / turn** — a scene tracks one value (control, freedom, distance) moving +→− or −→+. Lit. "the thing at stake swings sign." Here every beat names the value and its flip explicitly (e.g. Inspection: control +→− on the blink).
- **Said-vs-meant (subtext gap)** — surface line ≠ real meaning. Lit. "what's spoken over what's meant." Beats demand it ("hungry" = *I know this taste*); the engine of the whole book.
- **Therefore / But causality** — scenes linked by "therefore/but," never "and then." Lit. "consequence, not sequence." Each beat opens by chaining off the previous page's cost.
- **Seed-and-payoff (Chekhov's gun)** — plant an object early, fire it late. The locket worked "a fingernail from open" in Part I, paid off unopened at the flame in Part IV.
- **Concrete anchor** — one physical image a page turns on (the coat, the blink, the lamp, the honey). Keeps abstraction grounded.

## Voice / motif
- **Close third person** — narrator sits inside one character's head but uses "she." The book's wry Austen-meets-noir register.
- **Motif / leitmotif** — recurring image carrying theme. Lit. "leading motive." Drawer/ledger, ring-turn, brazier, "price of onions." *Failure mode here:* no budget → saturation.
- **Extended/controlling metaphor** — one metaphor system spanning the work (Mara's "filing people into drawers"). Strongest craft element.
- **Fade-to-black** — cutting away before explicit content. Lit. "screen goes dark." The book's central brief-miss: ecchi mandate → closed door.

## Studio architecture
- **Tentpole** — a pre-written must-hit set-piece. Lit. "the pole holding the tent up." 38 banked, ~15 realized → silent attrition.
- **Spine / route / beat ladder** — resolution levels: spine (whole-book arc) → route (ordered tentpole sequence) → beat (per-page craft directive) → prose.
- **Referential integrity** — every cross-reference must resolve to a live record. Lit. DB term: "no dangling pointers." *Violated:* selected route cites 9 deleted + 1 killed tentpole IDs.
- **Conformance gate** — a check that output matches spec before shipping. Lit. "a door that only opens if the contract is met." Missing: nothing scored prose against `brief.success_criteria` (heat/length/comedy).
- **Word-budget allocator** — distributes length by dramatic weight. Absent → flat pacing, starved climax.
- **LLM-as-judge** — using a model to score output against a rubric (the `evaluate-book` skill). Exists but not wired into the generation loop.
