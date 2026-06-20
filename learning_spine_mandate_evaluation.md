# learning — spine evaluation (book 1150), MANDATE-blind compression

Concepts encountered while evaluating 1150's spine and localizing why it under-delivers heat.

- **Resolution ladder** — "ladder" = the staged compress→expand pipeline BRIEF→FOUNDATIONS→SPINE→OBJECTIVES→BEATS→PROSE. Each arrow is a model call where intent can leak. Here: the leak is at the SPINE→text arrow specifically.
- **Laundering** — a stage softens a mandated property without dropping it outright ("passionate sex" → "fall into each other"). Showed up as the consummation euphemized in `spine.text` while the source route kept "passionate sex / rougher sex."
- **MANDATE vs VOICE split (brief-mandate-propagation)** — the brief is injected two ways: `briefContext` (voice-flavored, soft) and `mandateContext` (binding "the book FAILED if undelivered"). The whole bug: `spineRoutes` injects both; the `revision-chat.ts` spine lens injects only `briefContext` → MANDATE-blind text stage.
- **Layer-localization trace** — read the SAME moment at each rung to find the first rung that softens. Used route summary vs `spine.text`: route = explicit, text = euphemism ⇒ loss is at route→text, not upstream.
- **Referential rot** — a reference (here `tentpole_order`) cites ids that no longer exist (`389e6545`, `992c1da5` deleted). The "phantom beat": present in route prose, no tentpole to expand, so it vanishes downstream.
- **Tentpole bank** — "tentpole" = a load-bearing set-piece the story must hit (38 on 1150; fluid/pinned/killed). The source of heat DNA; a stage can only render heat as explicit as its source tentpole (`47eb9993` was itself abstract).
- **Steer** — per-layer free-text nudge injected at a stage (`readSteer(steers, "spine")`). Wired into `spineRoutes` but NOT the revision-chat spine lens — a second gap at the same stage. `null` on 1150.
- **Craft notes (tier-1/tier-2)** — tier-1 = immutable system KB (story-shapes/Vonnegut shapes for spine); tier-2 = editable `books.craft_notes[layer]`. Spine lens reads both via `craftContext`; empty on 1150.
- **Climax starvation (length weighting)** — flat per-page budget over a throughline that compresses Act III into one clause ⇒ the climax gets one sentence of allocation. The structural seed of the 49% length undershoot, visible at the spine before any prose exists.
- **Chat-first studio** — the center spine textarea (`SpineStep.tsx`) is manual; generation/options live in the ReviseChat rail (`revision-chat.ts` spine lens). So "regenerate the spine" = the MANDATE-blind lens, which is why a fresh draft still launders.

**Key finding:** open-problem #1 ("spine launders") localized to a code site — `revision-chat.ts:14` imports only `briefContext`; the spine lens (`:374-394`) never injects `mandateContext` or the spine steer, unlike `foundations-core.ts:365-372` (`spineRoutes`). Fix = add both to the spine lens; routes already carry the heat.
