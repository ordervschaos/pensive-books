# Learning: revise-node Unification

Concepts encountered while extending the revision system to cover all node layers under one chokepoint.

---

- **layer dispatch** (type-driven routing): a single function selects context assembly logic based on a string enum discriminant. Showed up as `ReviseLayer` driving a `switch` in `reviseNode()` — same function, 8 different context shapes.

- **context ladder** (prompt engineering): each AI revision call is grounded in the minimal set of ancestor nodes needed to stay consistent. Showed up as the layer-to-context mapping: `argument` needs only brief; `ending` needs brief+argument; `tentpole/voice` need all foundations; `prose` needs brief+spine+objective+beat.

- **chokepoint extraction** (refactor pattern): moving duplicated logic into a shared module so multiple callers stay in sync. Showed up as pulling `reviseTentpole` (in `foundations-core.ts`) and the bespoke `TentpoleRevisePanel` into `revise-core.ts` + `DurableReviser`.

- **durable vs synchronous path**: same AI work, two delivery modes. Sync (`revise-node` edge fn) returns `{ text }` in <5s; durable (`ai-run → node_revise`) runs in background, survives navigation. Showed up as prose needing `max_tokens: 4096` and `pageId` for context — both fit the durable path without timeout risk.

- **type widening** (TypeScript): loosening a prop type from a narrow union (`NodeLayer = spine|objective|beat`) to `string` so callers outside the original scope can pass new values. Showed up in `DurableReviser.tsx` where `layer: NodeLayer` became `layer: string`.

- **dead kind cleanup**: removing a `case "tentpole_revise"` from `ai-run` once it's folded into `node_revise`. Old DB rows with that kind become inert no-ops in the switch — safe since the switch `throw`s on unknown only. Showed up in `ai-run/index.ts`.

- **compound propose pattern**: `DurableReviser.onApply` is `async (text) => void` — the caller owns the write (DB update, stamp, toast) while the component owns accept/reject UX. Showed up in `ProseNodePanel` where `onApply` writes `pages.content` + calls `stampProse`.

- **context assembly per layer** (prompt architecture): fetching exactly the DB columns needed for each layer's context block, not the full book row every time. Showed up as `select("id, name, brief, foundations")` for foundation layers vs `select("id, name, brief, spine")` for plan layers — avoids pulling unused jsonb columns.
