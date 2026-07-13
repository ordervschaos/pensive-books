# Agent turn grounding — eager status steps before the model answers

Status: SHIPPED (2026-07-13, revised same day). Builds on
[agent-context-model.md](agent-context-model.md) (anchors, not fences) and
[agent-rail.md](agent-rail.md) (the one-thread-per-book chat).

## Problem

`threadSystem()` (`supabase/functions/book-agent/index.ts`) assembles the turn's context server-side —
tree read, live objective/analysis re-derivation, `<focus>`/`<mentioned>` hydration, skill-brief
matching — entirely before the LLM call. That call can then take anywhere from a couple seconds to
~100s. The author saw nothing during that window except the rail's generic "thinking…" spinner: no
signal that the turn was actually grounded on the right nodes, or which craft brief loaded.

The explicit `read_node`/`read_skill` **tools** already log a step when the model chooses to call them
(`execTool`: `"Read {kind} "{label}" in full."`, `"Loaded the {name} playbook."`). But the *pre-injected*
context — the `<focus>`/`<mentioned>` node hydration and `<skill_briefs>` matching that `threadSystem`
does automatically, before the model ever gets a turn — happened silently. Nothing was logged for it.

### First attempt, and why it was wrong

The first version added one combined line (`"2 in focus · ▸ Write scene 14 of 80 · brief: scene-craft"`)
and always emitted it, every turn, no dedup. In practice most turns of an auto/multi-turn action (e.g.
drafting one scene across several tool-use turns) have empty focus/mentioned and an unchanged objective —
so the line collapsed to just the objective headline, repeated identically turn after turn. Live it
looked like 10 copies of `"Step 5/5 · Prose — Scenes — Scene 8 of 10 (...)"` stacked in the feed: noise,
not signal.

## Fix

Two changes from the first attempt:

1. **Report actions, not status.** Drop the objective headline (it's already shown elsewhere — the
   "next step" card, the `<objective>` reasoning — repeating it isn't new information). Instead emit one
   entry per concrete thing that got silently pre-loaded, phrased exactly like the existing tool-step
   labels so eager and chosen context read the same way:

   ```ts
   const groundingLabels: string[] = [];
   for (const s of (askSkills.length ? askSkills : matchSkills(liveObjective ?? "")))
     groundingLabels.push(`Loaded the ${s.name} playbook.`);
   for (const n of [...focusNodes, ...mentioned])
     groundingLabels.push(`Loaded ${n.kind} “${nodeHandle(n.content)}” in full.`);
   ```

2. **Dedup against the current turn-cluster.** At the call site, before appending, skip any label that
   already appears among the steps since the last `user`/`answer` step — i.e. this same author ask,
   possibly spanning several auto-continue turns:

   ```ts
   const sinceUser = new Set<string>();
   for (let i = baseSteps.length - 1; i >= 0 && baseSteps[i].t !== "user" && baseSteps[i].t !== "answer"; i--)
     sinceUser.add(baseSteps[i].label);
   const freshGrounding = groundingLabels.filter((label) => !sinceUser.has(label));
   if (freshGrounding.length) baseSteps = [...baseSteps, ...freshGrounding.map((label) => ({ t: "read", label }))];
   ```

   A fresh user message resets the window, so the same skill/node re-announces once per ask — only
   *consecutive* turns of one ask that re-inject identical context stay silent on the repeat.

Both steps are folded into the write that was already happening right before the LLM call (the `turns`
tick at the top of the turn) — no extra DB round-trip, no added latency.

## Client

No new UI. `StepBubble` (`apps/web/src/features/dna/components/agentRail/StepBubble.tsx`) already
renders `t: "read"` steps as a muted italic activity line with a `BookOpen` icon — this reuses that path,
same as the existing `read_node`/`read_skill` tool steps, rather than adding a new step type or component.

Example rendered lines (one entry per action, only when new this turn-cluster):

```
📖 Loaded the scene-craft playbook.
📖 Loaded scene “Bram's door” in full.
```

## Decisions

- **Actions, not status.** The grounding steps announce *what got loaded*, not *where the journey is* —
  the latter is redundant with UI already visible elsewhere and was the source of the repeated-line bug.
- **Turn-cluster dedup, not blanket always-show.** Silence on an exact repeat within one ask; a fresh
  user message always re-announces. Keeps a long auto run from spamming identical lines while still
  showing real activity as it happens.
- **Piggybacked, not a separate write.** Folding onto the existing pre-call `turns` update keeps this at
  zero added latency and zero added DB calls.
- **Same phrasing as the tool-step precedent.** Reuses `execTool`'s existing label format for
  `read_node`/`read_skill` so eager (auto-injected) and chosen (model-called) context reads read
  identically to the author — one vocabulary for "the agent has this content," regardless of how it
  arrived.
