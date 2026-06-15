# Learning: Tentpole Kanban Redesign

## Concepts encountered

- **Kanban board**
  - *Kanban* = Japanese for "visual card/signal"
  - A columnar UI where cards move between lanes by status
  - Showed up as the replacement for the 2-col tentpoles layout; three lanes (Pinned / Proposals / Avoid) each own a slice of `Tentpole[]` by `status` + `source`

- **Status-driven partitioning**
  - Filtering one flat array into multiple views by a `status` field, rather than storing separate arrays
  - Each Kanban column is a derived `filter()` of `tentpoles[]`; mutations are always `map()` over the single source array

- **Soft delete vs. hard delete**
  - *Soft*: mark a record as inactive (here `status: "killed"`); it stays in the array and carries signal ("not this direction" to AI)
  - *Hard*: splice it out permanently (`filter(t => t.id !== id)`)
  - The Avoid column offers both: restore (un-soft-delete) and delete (hard remove)

- **Optional prompt steering**
  - An author-written free-text field threaded from the UI (`aiPrompt`) → `run.start({ prompt })` → edge function params → appended to Claude's user message for the tentpoles step
  - Pattern: pass optional context as a nullable string; ignore if empty on both client and server

- **Edge function param threading**
  - `ai-run/index.ts` is the dispatcher; it reads raw `params` and forwards typed fields to each worker
  - Adding a new param (`prompt`) requires updating both the dispatcher pass-through and the worker's `FoundationsOptionsParams` interface

- **`source` + `status` compound semantics**
  - `source: "author"` → always starts in Pinned
  - `source: "ai" + status: "fluid"` → Proposals lane
  - `source: "ai" + status: "pinned"` → Pinned lane (author kept it)
  - Any `status: "killed"` → Avoid lane (regardless of source)

- **Responsive grid breakpoint**
  - `grid-cols-1 lg:grid-cols-3` — single column on mobile, 3-column Kanban on large screens
  - Previous layout was `md:grid-cols-2`; 3 columns need a wider breakpoint to avoid cramping
