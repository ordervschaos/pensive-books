# Learning: Foundations Card-Game Redesign

Concepts encountered while working on the Foundations redesign and updating `docs/ai-calls-context-map.md`.

---

- **card-game mental model** (UX pattern): a pick-from-generated-set interaction where options are transient until one is chosen. Showed up as the design contract for the entire Foundations stage — nothing is "approved", just selected from a pool.

- **ephemeral UI state** (UX pattern): UI element that exists only during a specific action, not as a persistent form. Showed up as `SteerField` hidden behind a toggle button, closed when generation fires, never persisted as a visible field at all times.

- **hooks ordering constraint** (React rule): `useState` / `useEffect` must be called unconditionally before any early returns in a component. Showed up as a bug where `[steerOpen, setSteerOpen] = useState(false)` was placed after early `if (generating) return` — caught and moved to the top of the hook list before the first return.

- **proposal vs candidate** (data shape distinction): `candidates` = flat list (N items, pick one); `proposals` = list of complete configurations (pick a whole set). Showed up when cast moved from returning `{ candidates: CastMember[] }` (flat characters) to `{ proposals: CastProposal[] }` (each proposal = full protagonist + majors unit).

- **discriminated early return** (parsing pattern): check which step type before the generic parsing path so different result shapes don't interfere. Showed up in `foundationsOptions`: cast exits early with `{ proposals }` before the shared `parsed.candidates` block runs.

- **controlled delete** (UI safety): only allow deleting non-selected items; selected item requires switching away first. Showed up as X button on collapsed (non-selected) candidate rows only — prevents accidentally discarding the chosen card.

- **accept(apply) callback** (durable run pattern): `run.accept(async (result) => ...)` passes the whole run result to the caller; the caller picks what they need. Showed up in `pickProposal`: caller extracts `proposal.members` from `result.proposals[i]` and calls `onSave`.

- **sequential guard on destructive pick** (UX): "Switch to this →" label when cast already exists; "Choose this cast →" when starting fresh. Small label change prevents confusion about what picking a proposal does to existing work.

---

## Additional concepts from the doc-update pass

- **non-destructive generation** (UX/state pattern): append new AI outputs to an existing list instead of replacing it. Showed up in Foundations/Spine "propose more" — existing cards survive, new arrive below. Prevents loss of a good option the author hasn't acted on yet.

- **ephemeral vs. persistent steer** (two-channel prompt injection): ephemeral steer = local React state, sent once as a call param (`run.start({ prompt })`), never saved; persistent steer = written to `books.steers[step]`, re-read on every future call. Foundations uses ephemeral (`useLocalSteer`); Spine/Beats use persistent (`UseSteer`). Both channels can coexist in one prompt.

- **field-level pinning (`pinned_fields[]`)**: individual properties on a model object marked immutable. Showed up in `CastMember.pinned_fields` — editing `want`/`wound`/`lie` auto-adds the field key; `settledContext()` renders `[PINNED]` beside pinned lines as hard constraints for downstream AI.

- **two-column Pinned/Proposals board** (Kanban reduction): board with exactly two columns — committed (author-owned) and awaiting verdict (AI-owned). Showed up as Tentpoles replacing a 3-column kanban; "keep" → Pinned, "discard" → removed from array.

- **`avoid` parameter for variation** (prompt diversity): pass existing outputs to the model so it generates things that differ. Showed up in `spineRoutes({ avoid: [...existing route summaries] })` — model instructed to vary away, keeping spread across the pool.

- **`useLocalSteer` / interface compatibility** (hook substitution pattern): a local-state hook with the same interface (`value`, `setValue`, `save`, `loaded`) as a DB-backed hook, where `save` is a no-op. Lets `GenRow` accept either transparently.

- **GenRow** (co-location primitive): a UI component that always renders steer textarea + action button together. Removes separate "steer toggle"; steer is always visible above the generate button. Shared across Foundations, Spine, Beats.
