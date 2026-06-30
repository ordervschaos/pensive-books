# Agent context model — anchors, not fences

Status: SHIPPED (2026-06-30) — all three slices landed. Supersedes the aspect-scope filter in `AgentRail`.
Builds on [agent-rail.md](agent-rail.md) (one agent thread per book) and the v2 prose pipeline
([dna-streaming-proxy] / `dnaExpand.expandNode`).

- Slice 1 — scope fence removed. Commit `01383bd` (revise-agent deployed).
- Slice 2 — context tray. Rail side `007970b`; DnaTreePage side rides the author's tree-connector WIP.
- Slice 3 — prose-render delegation (`propose_prose_render` → client `expandNode`). revise-agent deployed.

## Thesis

The agent has **one** context mechanism: **attached nodes (anchors)**. No boundary, no filter.
You attach DNA nodes the way you attach files in Cursor/Claude Code — they bias *where the agent
looks first*, not *what it's allowed to touch*. The agent already holds the whole tree and can read
or edit any node; attachments are seeds, not a fence.

```
BEFORE   context-as-filter  (kind chips fence what's seen + written)   ← DELETE
       + context-as-seed    (anchors)                                  ← BUILD
         two mechanisms, and they collide at the kind-write-fence

AFTER    context-as-seed only
         whole tree always visible · attach nodes to focus · agent edits anything
         the Apply/Discard review gate is the real safety, not scope
```

## Agent capability model

The agent is unfenced on structure; it has exactly one intrinsic limit, on prose **generation**.

| capability | how | status |
|---|---|---|
| read any node (incl. prose) | `read_node`, `read_page` | keep |
| judge prose vs brief | `check_against_contract` | keep |
| edit/add/delete/rebuild any node | `propose_node_ops` → review → apply | keep, now unfenced |
| **small** surgical prose edits | `propose_node_ops` patching `content.prose.text` | keep |
| **full prose (re)generation** | ❌ not in-loop — **delegate to v2** | rewire (slice 3) |

Why prose-gen is delegated and not fenced: it's a **capability boundary** (where an op executes),
not a **scope boundary** (what the agent may touch). v2 prose is browser-orchestrated streaming
(`prepare` edge call → off-worker `/api/stream-prose` → incremental digest); the agent is a
server-side tool loop and physically can't drive it. An in-worker render hits the ~150s ceiling with
no digest — which is exactly what `render_scene_prose` does today (it calls `dna-expand` target=prose
server-to-server, the old path). So the agent *requests* a render; the **client renders** it.

## Build slices

### Slice 1 — delete scope (the simplification)
Rip out context-as-filter. Reversible, no new behavior.

- `AgentRail.tsx`: remove `available` / `custom` / `scope` / `sentScope` / `toggleAspect`, the
  context-chip row, and the `agent-context-*` localStorage. Keep `auto` + `effort` toggles (relocate
  into the header strip). The slash-command `pickCommand` must stop calling `setCustom(c.scope)`.
- `agentThread.ts`: drop the `scope` param from `sendAgentMessage`.
- `revise-agent/index.ts`: remove the tree-filtering by scope and the system-prompt clause *"Only
  touch nodes whose kind is in scope."* **Keep** `never touch a LOCKED node` (a lock, not a fence).
- `agentCommands.ts`: drop `.scope` plumbing (commands may keep an `available`/capability check used
  only to hide irrelevant commands — that's relevance, not a fence; decide during impl).

**Success:** rail shows no context chips; sending a message carries no `scope`; the agent can propose
edits to any kind; locked nodes still untouchable; existing chats still load.

### Slice 2 — the attach tray (the feature)
Multi-node `@`-mention into the live chat.

- **State lifted to `DnaTreePage`**: `attachedIds: string[]` (persist per book; tied to the current
  session). `onAttachNode(id)` adds + opens the rail; `onDetach(id)` removes.
- **Per-node button**: a `＋ context` affordance on the tree row. Default placement *inside the kebab*
  as "＋ add to agent context" (keeps the row simple, fits "make the node simple"); promote to a
  visible chip later if it earns it. Wire through the `h` handler bag (alongside `onContextFocus`).
- **Rail chips**: render removable attachment chips (`kind · title · ✕`) above the composer.
- **On send**: inject the attached nodes (id + kind + title + content) into the message as anchors,
  e.g. a leading `# Focus\n- [N5] beat: …` block. No backend field needed for v1 (anchors ride in the
  message text). Optional fast-follow: a structured `focusIds` on `sendAgentMessage` + a system-prompt
  clause so anchors are first-class.

**Success:** clicking attach on N nodes shows N chips; the message the agent receives lists them; the
agent reads/triages them (its existing TRIAGE→INVESTIGATE loop); detaching removes the chip;
attachments add to the *running* chat, not a new one.

### Slice 3 — prose-render delegation (option B)
Agent initiates full prose regen; the client executes v2.

- `revise-agent/index.ts`: replace `render_scene_prose` (in-worker `dna-expand` call) with a tool that
  **stages a render-request proposal** and ends the turn — no in-worker generation.
- `agentThread.ts`: extend `AgentProposal` to a discriminated union —
  `{ layer: "dna"; ops }` (today) **|** `{ layer: "prose-render"; sceneIds: string[] }`.
- `AgentRail.tsx`: `ProposalCard` + `apply()` branch on `layer`. For `prose-render`, Apply runs
  `expandNode(bookId, scene, "prose")` **on the client** (the v2 streaming path) for each scene, shows
  per-scene progress, then resolves the proposal. `applyAgentProposal` stays for `dna`.

**Success:** asking the agent to "rewrite scene X's prose" produces a render-request proposal (not
inline prose); Apply streams via `/api/stream-prose` with the v2 digest and saves; Discard leaves the
prose untouched; small text-patch edits still go through the normal `dna` op path.

## Sequencing

Slice 1 first (feel the simpler model), then 2, then 3. 1 and 3 touch the edge fn → one deploy each
(standing authorization). 2 is client-only.

## Deferred

- Structured `focusIds` channel (anchors as first-class in the system prompt) — fast-follow on slice 2.
- Node-level *override* of locks (no — locks stay absolute).
- Attaching pages (non-DNA) — out of scope; the tray is DNA nodes only for now.
