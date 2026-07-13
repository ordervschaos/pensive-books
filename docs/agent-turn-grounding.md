# Agent turn grounding — a status line before the model answers

Status: SHIPPED (2026-07-13). Builds on [agent-context-model.md](agent-context-model.md) (anchors,
not fences) and [agent-rail.md](agent-rail.md) (the one-thread-per-book chat).

## Problem

`threadSystem()` (`supabase/functions/book-agent/index.ts`) assembles the turn's context server-side —
tree read, live objective/analysis re-derivation, `<focus>`/`<mentioned>` hydration, skill-brief
matching — entirely before the LLM call. That call can then take anywhere from a couple seconds to
~100s. The author saw nothing during that window except the rail's generic "thinking…" spinner: no
signal that the turn was actually grounded on the right nodes, or which craft brief loaded.

## Fix

`threadSystem` already computes everything needed for a one-line summary — it's a byproduct of context
assembly, not new work. It now also returns `grounding: string`, built from values already in scope:

```ts
const headline = liveObjective?.split("\n").find((l) => l.startsWith("▸"))?.replace(/^▸\s*/, "").trim();
const grounding = [
  focusNodes.length ? `${focusNodes.length} in focus` : "",
  mentioned.length ? `${mentioned.length} mentioned` : "",
  headline ? `▸ ${headline}` : "",
  askSkills.length ? `brief: ${askSkills.map((s) => s.name).join(", ")}` : "",
].filter(Boolean).join(" · ");
```

The call site appends it to `baseSteps` as a `{ t: "read", label: grounding }` step, folded into the
write that was already happening right before the LLM call (the `turns` tick at the top of the turn) —
no extra DB round-trip. Realtime pushes the updated row to the client immediately, so the line renders
while the model is still generating.

## Client

No new UI. `StepBubble` (`apps/web/src/features/dna/components/agentRail/StepBubble.tsx`) already
renders `t: "read"` steps as a muted italic activity line with a `BookOpen` icon — this reuses that path
rather than adding a new step type or component.

Example rendered line:

```
📖 2 in focus · ▸ Write scene 14 of 80 · brief: scene-craft
```

## Decisions

- **Always emitted, no dedup.** A repeated line across consecutive turns in a long auto run is itself a
  "still on track" signal, not noise worth suppressing.
- **Piggybacked, not a separate write.** Folding onto the existing pre-call `turns` update keeps this at
  zero added latency and zero added DB calls.
- **Built from already-computed values only.** The grounding line doesn't run any new query or
  derivation — it summarizes `threadSystem`'s own locals (`focusNodes`, `mentioned`, `liveObjective`,
  `askSkills`), so it can never disagree with what the turn actually saw.
