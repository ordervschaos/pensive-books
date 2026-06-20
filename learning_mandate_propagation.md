# Learning: brief-mandate-propagation (C1 + C2)

## Concepts encountered

- **Prompt framing / label demotion**
  - What: How a header/label on a block of text signals its authority to the model. "BRIEF (the voice contract)" trains the model to treat all contents as style guidance.
  - Task: Renaming to "BRIEF — binding contract (voice AND deliverables)" + adding a separate MANDATE block split authority into two named slots.

- **Context laundering / lossy relay**
  - What: Each compression hop (spine → objectives → beats → prose) can strip specificity from free-text instructions if nothing pins those specifics.
  - Task: The anti-launder sentence added to SYSTEM prompts at the beat and spine stages instructs the model to preserve heat/comedy/set-piece specifics rather than abstracting them.

- **Renderer / render function pattern**
  - What: A function whose job is to serialize a data structure into a formatted prompt string. Centralizing it means every call site uses identical serialization.
  - Task: `briefContext` was the existing renderer; `mandateContext` is the new sibling, both in `_shared/brief.ts` and mirrored in `eval-bridge.mjs`.

- **Defensive read / optional typing**
  - What: Reading a field that doesn't exist in the DB schema yet using `(obj as any).field` or an optional type, so the code compiles and runs without a schema change.
  - Task: `heat?: string | { level?: string; note?: string }` added to `Brief` so `mandateContext` can read it (C3 will add the real schema).

- **Bridge mirror tax**
  - What: `scripts/eval-bridge.mjs` is a standalone JS reimplementation of the whole edge pipeline for dev. Every edge change must land there too or features break in one environment.
  - Task: `mandateContext` added to bridge, all six generation-path call sites updated, anti-launder sentences added to `BEAT_INSTRUCTIONS` and `SCAFFOLD_INSTRUCTIONS`.

- **Staleness hash**
  - What: A hash of the brief's prompt representation used to detect when regeneration is needed. If the renderer changes what it emits, the hash changes and stale flags fire correctly.
  - Task: `briefToPromptContext` in `apps/web/src/lib/brief.ts` updated to include mandate fields so hash reflects deliverable changes, not just voice changes.

- **Generation path vs revise/chat path**
  - What: The pipeline splits into a write path (new content: foundations → spine → objectives → beats → prose) and a revise/chat path (edit existing content). The conformance problem is in the write path only.
  - Task: Only generation-path call sites updated; revise-core, revision-chat, beats-agent, revise-chat left unchanged.

- **System prompt vs user prompt authority**
  - What: Instructions in the SYSTEM turn carry higher baseline authority than instructions in the user turn. The anti-launder sentence was added to SYSTEM constants (`SYSTEM` in beat-core, `SCAFFOLD_INSTRUCTIONS` in spine-to-objectives) for maximum authority.
  - Task: C2 sentence placed in SYSTEM constants, not inline in the user content block.
