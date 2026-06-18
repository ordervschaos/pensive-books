# Upward editing — cross-layer proposals in the unified reviser

**Status:** v1 spec (single-patch upward). Builds on the unified revision layer
(`docs/beat-sheet-revision.md`, `revise-chat`).

## What

Today each `ReviseChat` layer (foundations / spine / outline / beats) can only propose a change
to **its own** layer; the lens prompts explicitly say the layers above/below are "not your concern."

Upward editing lets an editor reach **up the dependency chain** and propose a change to one of its
*upstream* layers — the causes of the problem it's looking at. Example: while pressure-testing the
**spine**, the editor sees the **argument** (foundations) is muddy and proposes sharpening it.

```
brief → foundations → spine → outline → beats → prose
        └──────────── upstream ────────────┘     (downstream = derived, regenerated)
```

| Chat layer  | May also target (upstream) |
|-------------|----------------------------|
| foundations | — (brief is frozen, never a target) |
| spine       | foundations |
| outline     | foundations, spine |
| beats       | foundations, spine, outline |

**Never downstream** (those regenerate from upstream) and **never the brief** (frozen contract).

## v1 scope: ONE patch per turn, which may target an upstream layer

A turn proposes at most one change, but its `target` may be an upstream layer instead of self.
The cascade case (fix foundations **and** respin the spine in a single proposal) is a multi-patch
**fast-follow** — it's the only part that needs an envelope change, so it's deferred. In v1 the
author does a cascade across two natural turns: apply the upstream fix, then ask to re-derive.

## Why this is mostly server-side

The client is already layer-agnostic:

- `RevisionPatch` (`apps/web/src/lib/revisionChat.ts`) is already a **union of all four layers**.
- `applyProposal` already switches on `patch.layer` and routes each to its existing write path
  (foundations → `writeFoundations` w/ pins; spine → `saveSpine`; beats/outline → `applyBeatPlan`).
- `ReviseChat` already receives `model`, `currentFoundations`, **and** `currentSpine` for every
  planning layer (`StudioEditorRail.tsx`), so an upstream diff already has everything it needs to render.

So an upstream patch rides the **existing** envelope, diff, and apply paths. The real work is the
two edge files plus a small UI badge + correct apply-note.

## Changes

### 1. `supabase/functions/_shared/revision-chat.ts`

- Add the upstream map (self is always allowed; foundations has no upstream):
  ```ts
  export const UPSTREAM: Record<RevisionLayer, RevisionLayer[]> = {
    foundations: [],
    spine: ["foundations"],
    outline: ["foundations", "spine"],
    beats: ["foundations", "spine", "outline"],
  };
  export const targetAllowed = (chat: RevisionLayer, target: RevisionLayer) =>
    target === chat || UPSTREAM[chat].includes(target);
  ```
- **Lens prompts** (spine, outline, beats — NOT foundations): add a 5th capability,
  "PROPOSE AN UPSTREAM CHANGE." Phrasing pattern (adapt per layer):
  > Sometimes the real problem is **upstream** — the spine can't cohere because the *argument*
  > (foundations) is muddy. When the root cause is upstream and the author agrees (or asks), you may
  > propose a change to an upstream layer INSTEAD of this one. Do it sparingly — only when the fix
  > genuinely belongs upstream, not to dodge work at this layer.
  >
  > To target an upstream layer, set `"target": "<layer>"` in the json block and use **that layer's**
  > block shape (foundations: argument/ending/voice/cast/tentpoles; spine: text; outline: pages/deletes).
  > Omit `target` (or set it to your own layer) to propose a change here as usual.

  Each lens lists only the layers it's allowed to target (see table). The upstream context is
  **already in every lens's prompt** (foundations + spine are loaded for all), so no context change.
- Keep each lens's `sanitize` exactly as-is (it's layer-specific). Dispatch moves to the host.

### 2. `supabase/functions/revise-chat/index.ts` — `runTurn`

After `splitReplyAndBlock`, pick the target layer and dispatch:
```ts
const rawTarget = typeof parsed.target === "string" ? parsed.target as RevisionLayer : layer;
const target = LAYERS.includes(rawTarget) && targetAllowed(layer, rawTarget) ? rawTarget : layer;
const patch = LENSES[target].sanitize(parsed, ctx);   // was: lens.sanitize(...)
```
(Pass `layer` into `runTurn`.) If the model names a disallowed/downstream target, fall back to `layer`
— the layer's own sanitizer will reject a mismatched block, so the proposal is dropped safely (talk-only).

### 3. `apps/web/src/lib/revisionChat.ts`

No type changes (the union already covers it). **Optional polish:** in `recordApplied`, the caller
already passes the note; nothing to change here.

### 4. `apps/web/src/components/book/studio/ReviseChat.tsx` — `ProposalReview` + `apply`

- The component knows its own `layer` and the `proposal.patch.layer`. When they differ, the patch is
  **upstream**:
  - Show a small badge above the diff, e.g. `▲ changes FOUNDATIONS (upstream)` using `pv-mono`
    uppercase faint styling (match existing eyebrow chips).
  - Use the **target layer's** apply-note, not the chat layer's. Add a tiny lookup keyed by layer
    (reuse the consequence strings already in `LAYER_UI[*].applyNote`), e.g.
    `const applyNoteFor = (l: RevisionLayer) => LAYER_UI[l].applyNote;` and pass
    `applyNoteFor(proposal.patch.layer)` into `ProposalReview` and into the `recordApplied` note.
- `apply()` already calls `applyProposal(bookId, pending)` which routes by `patch.layer` — leave it.
  Just make the recorded note + toast use the target layer's apply-note.
- The diff renderer already branches on `proposal.patch.layer` and has `currentFoundations` /
  `currentSpine` / `model` in scope — no change needed there.

## Out of scope (fast-follows)

- **Multi-patch cascade** — one proposal carrying ordered upstream→downstream patches, applied in
  order. Needs `RevisionProposal.patches: RevisionPatch[]` (migrate-on-read from `patch`), an apply
  loop (upstream first), and N diff blocks.
- Foundations → brief (brief stays frozen).

## Verify

- Spine chat: "the argument feels muddy — propose a sharper one" → proposal renders a **foundations**
  diff with the upstream badge; Apply writes foundations (pins honored), spine/beats go stale, the
  thread shows the applied note. Reload-safe.
- Spine chat normal spine edit still works (no `target`).
- Beats chat can target outline/spine/foundations; outline can target spine/foundations.
- A downstream/invalid `target` is ignored (falls back to self or drops the proposal). `tsc` + eslint clean.
