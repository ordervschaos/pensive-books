# learning_upward_editing.md — concepts from the upward-editing task

- **Dependency hierarchy** (hierarchy = ranked ordering)
  - A layered system where each layer is derived from those above it; changing an upstream layer invalidates all downstream ones.
  - Showed up as: brief → foundations → spine → outline → beats → prose; the `UPSTREAM` map encodes exactly which directions a proposal may travel.

- **Lens / Strategy pattern** (lens = a view through a specific optic; strategy = swappable algorithm)
  - A per-variant object (system prompt + context builder + sanitizer) that encapsulates all behavior for one parameterization, selected at runtime.
  - Showed up as: `LENSES[layer]` — each of the four planning layers is a `Lens`; the host (`revise-chat/index.ts`) is layer-agnostic and delegates everything to whichever lens is chosen.

- **Single-writer** (the one designated mutator)
  - Architectural rule that exactly one code path writes a given resource; all others read.
  - Showed up as: the edge fn (`revise-chat`) is the sole writer of `revision_chats`; the agent never mutates the book directly, only proposes a change that the client applies through each layer's own write path.

- **Sanitizer** (sanitize = make safe / conformant)
  - A function that accepts raw model output and produces a safe, pin-honoring patch — or null if the output is invalid/empty.
  - Showed up as: `lens.sanitize(parsed, ctx)` per layer; the upward-editing change dispatches to `LENSES[target].sanitize` so the correct layer's rules (pin enforcement, field validation) always apply regardless of which chat issued the proposal.

- **Envelope** (envelope = outer wrapper carrying payload + metadata)
  - A typed wrapper (`RevisionProposal { summary, patch }`) that carries the proposed change plus a human-readable summary through the system without either side needing to inspect the other's internals.
  - Showed up as: `revision_chats.pending_proposal` stores the envelope; the client's `applyProposal` switches on `patch.layer` inside the envelope to route to the correct write path — upstream patches ride the same envelope unchanged.

- **Union type / discriminated union** (union = one of several shapes; discriminated = a shared tag field selects the shape)
  - A TypeScript type that is exactly one of N shapes, distinguished by a literal field (here `layer`); exhaustive switch on the tag gives compile-time safety.
  - Showed up as: `RevisionPatch = { layer: "foundations"; data: ... } | { layer: "spine"; data: ... } | ...` — already covered all four layers before this task, so upward patches needed no type changes.

- **Fall-back / defensive dispatch** (fall-back = safe default when validation fails)
  - Validating a user/model-supplied value against an allowlist and silently substituting the safe default on failure, so invalid input is ignored rather than crashing.
  - Showed up as: `const target = LAYERS.includes(rawTarget) && targetAllowed(layer, rawTarget) ? rawTarget : layer` — a downstream or unrecognised target silently reverts to the chat's own layer.

- **Badge / eyebrow** (eyebrow = small label above main content signalling context)
  - A small typographic label rendered above a UI section to surface metadata without interrupting the main content hierarchy.
  - Showed up as: the upstream badge `▲ changes FOUNDATIONS (upstream)` rendered above the diff in `ProposalReview` using `pv-mono` uppercase faint styling, matching the existing `Eyebrow` convention.

- **Realtime / live projection** (projection = derived read-only view)
  - Subscribing to DB change events so the UI is always a live mirror of server state; no polling or manual refresh.
  - Showed up as: `revision_chats` is watched via `useLatestTaskRow`; after `applyProposal` + `recordApplied`, the Realtime update propagates the cleared pending proposal and new thread message automatically.
