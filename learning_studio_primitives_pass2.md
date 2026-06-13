# Learning: Studio primitives Pass 2 (RunningInline; FieldRow dropped)

- **RunningInline (component)**
  - A small "machine working" row: spinning label + optional cancel.
  - The lightweight sibling of `RunningCard` (which is the big durable-run card with progress bar).
  - Here: added to `studioUi.tsx`; replaced 6 identical hand-rolled spinner+cancel rows (Spine ×2, Beats ×1, Foundations ×3).

- **YAGNI ("You Aren't Gonna Need It")**
  - Don't build an abstraction until there's real, repeated demand for it.
  - `FieldRow` was planned but had only ONE genuine call site (the cast want/wound/lie row); the ledger renders read-only summary strings, not editable label+field rows.
  - Here: dropped `FieldRow` — a 1-use component is speculative and adds indirection without removing duplication. The cast row already composes `Eyebrow` + `AutoTextarea`.

- **Rule of three**
  - A common heuristic: extract a shared abstraction once you have ~three duplicate instances, not before.
  - `RunningInline` had 6 → extract. `FieldRow` had 1 → don't.
  - Here: the deciding test for what actually got built in Pass 2.

- **Sibling components / API symmetry**
  - Related components that share a naming + shape so the set reads as one family.
  - `RunningCard` (heavy) and `RunningInline` (light) — same domain, parallel names, caller picks by weight of the wait.
  - Here: chose the name to signal the relationship, so future devs reach for the right one.

- **Inventory-before-implement**
  - Grep/count real call sites before committing to an abstraction's shape and scope.
  - Counting `>cancel</button>` and `animate-spin` occurrences proved RunningInline's 6 sites and FieldRow's 1.
  - Here: the count is what turned "build both" into "build one, skip one."
