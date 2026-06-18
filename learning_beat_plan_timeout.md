# Learning: Beat Plan Timeout Fix

## Concepts Encountered

- **Wall-clock timeout (subprocess)**
  - A process spawned by another has a fixed kill deadline imposed by the parent (`CLAUDE_TIMEOUT_MS`).
  - Showed up: `claude -p --tools ""` was killed at 360s when asked to plan beats for all pages in one call.

- **Bulk vs. per-unit operation**
  - "Plan all beats" is a bulk operation masquerading as a chat message — one model call must output beats for every page at once, making the response quadratic in book size.
  - Fixed by routing the known prompt through `planAllBeatsLocal` which calls `runObjectiveToBeat` per page (already used in `generate-book`), then assembles a `RevisionPlan` locally.

- **Prompt-prefix intercept (detect-and-shortcircuit)**
  - Exact-prefix match on `msg.startsWith(...)` inside the request handler to route one well-known high-cost message to a different code path, leaving all other messages on the original path.
  - Showed up: only the `GENERATE_PROMPTS.beats` chip message is intercepted; evaluate/talk/propose messages still go through `runClaude`.

- **RevisionPlan (beats layer)**
  - The output format expected by `build-revision`: `{ summary, pages: [{ ref, op, pageType, title, objective, beat, why }], deletes: [], planOnly: true }`.
  - Showed up: `planAllBeatsLocal` constructs this directly (op `keep` for all pages, `beat` field set on newly-planned pages).

- **Sequential vs. parallel for continuity**
  - `runObjectiveToBeat` reads the full outline for each page to maintain narrative continuity. Running pages in order (not parallel) means each call sees stable preceding context.
  - Showed up: the `for...of toBeat` loop is sequential, same as the `generate-book` beats stage.
