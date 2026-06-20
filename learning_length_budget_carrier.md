# Learning: Length Budget Carrier (C4)

## Concepts encountered

- **Flat allocation** (divide-equally): distribute a total budget uniformly across N units by dividing total / N.
  - Showed up as `perPageTarget = round(word_target / contentPageCount)` — the simplest length-budget decomposition.

- **Content-page filter** (structural exclusion): separating "prose" pages from structural dividers before counting.
  - Showed up as `page_type !== "section"` filter — section pages are headings, not prose, so excluding them keeps the per-page target honest.

- **Prompt injection** (prompt engineering): inserting a structured instruction line into an LLM prompt at a specific position to enforce a constraint.
  - Showed up twice: once in the beat prompt ("plan enough moments to fill ~N words"), once in the prose prompt ("do not stop short; write the full scene").

- **Mirror tax** (bridge parity): the requirement that every edge-function change must also land in the dev bridge (`scripts/eval-bridge.mjs`) so both environments behave identically.
  - Showed up as the mandate to mirror beat + prose injections into `runObjectiveToBeat` and `runUnit` in eval-bridge.mjs.

- **Optional PromptArgs field** (interface extension): adding a nullable/optional typed field to a shared args interface to thread a new value from caller to renderer without invasive signature changes.
  - Showed up as `perPageWordTarget?: number` added to `PromptArgs` in generate-unit-core.ts.

- **objectiveMap line-count heuristic**: deriving content-page count from an already-built string (lines starting with `- "`) rather than re-querying the DB or threading raw page arrays.
  - Showed up in `beatToProse` — avoids a new DB query and keeps the change minimal.

- **Guard clause on missing budget** (zero-guard): skip injection entirely when the prerequisite value is absent or zero.
  - Showed up as `if (_perPageTarget > 0)` / `if ((args.perPageWordTarget ?? 0) > 0)` — no target line emitted when `word_target` is unset.
