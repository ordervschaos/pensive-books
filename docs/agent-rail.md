# Agent Rail — one omni-thread for every AI action

> **SUBSTRATE PIVOT (2026-06-25).** This was first prototyped in the **Build Studio** (page-native:
> `ReviseChat`, `RevisionPlan`→`build-revision`). It now lives in the **DNA flow** — **DNA is the one
> flow; the Build Studio is deprecated.** The agent operates on `book_nodes`: tools are `read_node` +
> `propose_node_ops` (`NodeOp[]`), apply = `applyNodeOps` (lib/dnaChat.ts), proposals render via
> `describeOps`, and `AgentRail` mounts in `DnaStudio`, subsuming the per-stage `DnaChatRail`. The
> durable thread, the context filter (§6b), the slash commands, and the rail UI carried over unchanged;
> only the tools + mount point changed. The §5 "layers" below now read as DNA node kinds, grouped into
> the §6b aspects (promise / characters / beats / scenes / prose).

> **Relationship to `docs/chat-first-studio.md`.** That plan unified the studio onto a chat-first
> model but kept **one chat per layer** (foundations / spine / beats / outline each own a
> `revision_chats` thread; DNA owns `dna_chats`; scenes owned an ephemeral in-component chat). This
> plan goes one step further — option **B**: collapse those six surfaces into **one durable,
> tool-using AGENT thread per book**. Every AI action (generate, revise, edit DNA, generate scenes,
> draft prose) is a command into that single rail. The per-layer **diff/proposal renderers** built for
> chat-first survive; the per-layer **chats** do not.

## 1. The insight: promote the editor agent, don't build a new one

The editor agent already exists and is 90% of the machinery:

- `supabase/functions/revise-agent/index.ts` — a durable, self-chaining, tool-using loop. One Claude
  call per chain link (under the ~150s worker cap), persists the transcript, chains or parks.
- `book_agent_runs` — the durable row: `transcript`, `steps`, `pending`, `turns`, `status`
  (`running` / `awaiting_input` / `done` / `error` / `cancelled`), `cancel_requested`, `revision_id`.
- `ask_author` parks the run in `awaiting_input` until the author answers; the pg_cron watchdog only
  revives stalled `running` rows. `stopRun("book_agent_runs", id, status)` already stops it.
- `EditorAgent.tsx` — the rail UI: launch row → narrated step feed → question card → closing report.

Today its tool belt is tiny (`read_page`, `ask_author`, `propose_revision_plan`, `finish`) and its
only write is a `book_revisions` plan (prose/outline). **B = give it the full tool belt and make it
THE rail.** The trusted write paths are untouched; we unify the *entry* (one thread) and the
*envelope* (one tagged proposal type), and reuse every existing layer writer as an apply dispatcher.

## 2. The model

```
┌─────────────┬───────────────────────────┬───────────────────────────────┐
│ Navigator   │  STAGE = manual editor    │  RAIL = the agent (ONE thread) │
│ (steps+map) │  edit whatever step       │  every command lands here:     │
│             │  you're on, by hand       │  /generate scenes  /revise     │
│             │                           │  beats  /edit dna  /draft …    │
│             │                           │                                │
│             │                           │  agent investigates (read_*),  │
│             │                           │  asks creative forks,           │
│             │                           │  emits PROPOSALS inline →       │
│             │  active step ─────────────▶  each Apply/Discard, routed to │
│             │  biases default target    │  that layer's existing writer  │
└─────────────┴───────────────────────────┴───────────────────────────────┘
```

- **One thread per book.** You keep talking to it. The active studio step only sets the agent's
  **default target/context** (so `/generate` while on Beats means beats).
- **Commands are sugar.** A `/command` drops editable, context-carrying text into the composer; you
  add steering, then send. The agent could do the same from plain language — commands just make the
  intent + context explicit and steerable (the visible successor to today's silent `onGenerate` bus +
  `GENERATE_PROMPTS`). Center buttons fire the same commands.
- **One control surface.** Stop = `stopRun`. Discard = drop a proposal. Continue = send another
  message. All on the one thread.

## 3. Thread model — persistent conversation + ephemeral agentic turns

Today `book_agent_runs` is **per-run** (one row per evaluation/instruction, terminal `done`). An
omni-chat needs continuity. **Decision: one long-lived row per book** (mirrors `revision_chats` /
`dna_chats`, which already persist one row per book+layer), not a parent/child thread+runs split.

- The row IS the conversation: growing `transcript` + `steps`, plus `proposals[]`.
- A user message starts an **agentic turn** — the existing self-chain loop drives it to completion
  (reads, asks, proposes), then sets `status: "idle"` instead of `done`. The next message resumes
  with full transcript context.
- `MAX_TURNS` becomes a **per-turn** guard (reset when a new user message arrives), not per-row.
- `awaiting_input` / `cancel_requested` / watchdog semantics carry over unchanged.

> Migration note: this is an additive evolution of `book_agent_runs`, not a rewrite. The current
> per-run callers (evaluate-book's "act on this read", the prose chat) become *messages* on the
> book's thread. `revision_id` (single) generalizes into `proposals[]` (below).

## 4. Proposals — a list, tagged by layer

`pending_proposal` (singleton, per-layer) → **`proposals[]` inline in the transcript**, each tagged by
layer, each Apply/Discard independent. One conversation can carry a beats change *and* a scene at once.

**One tagged-union envelope** over the existing per-layer patch types:

```ts
type AgentProposal =
  | { layer: "foundations" | "spine" | "outline" | "beats"; data: RevisionPatch["data"] } // lib/revisionChat
  | { layer: "prose";  data: RevisionPlan }        // book_revisions plan (existing)
  | { layer: "dna";    data: NodeOp[] }            // lib/dnaChat
  | { layer: "scene";  data: { pageId: number; spec: SceneSpec } }; // render = Apply (§6)
```

**Apply dispatcher (client) — reuse every existing writer, keyed by `layer`:**

| layer | apply path (unchanged) |
|---|---|
| foundations/spine/outline/beats | `applyProposal` (`lib/revisionChat.ts`) |
| prose | the `book_revisions` build flow (`build-revision`) |
| dna | `applyDnaProposal` (`lib/dnaChat.ts`) |
| scene | `renderSceneImage` (`lib/sceneImages.ts`) — see §6 |

**Proposal renderers (the verify step) survive as-is:** `SpineDiff`, `FoundationsDiff`, `BeatDiff`,
`describeOps` (DNA), and a scene-spec card. They render a proposal of the matching `layer`.

## 5. The tool belt — union of every layer's read + propose

| Read (investigate, on demand) | Propose (produce a reviewable artifact) |
|---|---|
| `read_page` (exists) | `propose_revision_plan` (exists — prose/outline) |
| `read_foundations` | `propose_foundations` → `RevisionPatch` |
| `read_spine` | `propose_spine` |
| `read_beats` | `propose_beats` |
| `read_dna` | `propose_dna` → `NodeOp[]` |
| `read_scene` (page's spec) | `propose_scene` → `{ pageId, spec }` |
| `ask_author` (exists), `finish` (exists) | |

Each `propose_*` validates against **current** state (fresh fetch — the author may have hand-edited)
and appends an `AgentProposal` to `proposals[]`. A proposal does **not** end the thread (unlike today's
terminal `propose_revision_plan`) — the agent may propose, then keep working or ask. `finish` ends the
*turn*.

## 6. Scenes — spec is the proposal, render is the Apply  *(decided)*

Scenes produce an image, not a text diff, so the gate is:

- `propose_scene` emits the **structured spec** (subjects / setting / lighting / mood / …) as a
  reviewable card — the same fields `SceneTab` edits today.
- **Apply → `renderSceneImage`** kicks the durable render; the image lands in the gallery over
  Realtime (exactly today's render path).
- This makes scenes **uniform** with every other layer: propose → verify → apply. `SceneTab`'s
  live-mutating chat is retired; its spec card becomes the scene proposal renderer, its
  cast/reference-portrait picker stays as manual editing in the center.

## 6b. Context filter — scoping the thread to aspects  *(added; shipped)*

The author can edit parts of the book separately — "just the promise", "just the beats", "just the
characters". The rail carries a **context filter**: a subset of book **aspects** the agent sees AND can
touch. Aspects are **DNA-aligned** so the same scope drives which `book_nodes` kinds load once the rail
re-homes into the DNA flow:

| Aspect | Context it carries | Tools it unlocks |
|---|---|---|
| `promise` | brief + argument + ending + voice + tentpoles + spine | (foundations/spine tools later) |
| `characters` | cast (want/wound/lie) | (cast tools later) |
| `beats` | the beat sheet (`read_beats`) | `read_beats`, `propose_beats` |
| `scenes` | scene specs | (scene tools later) |
| `prose` | page prose (`read_page`) | `read_page` |

- **Default = every aspect that is *created*.** On a foundations-only book the default is
  `{promise, characters}` (beats/scenes/prose excluded because they don't exist). On a full book it's
  all → the whole book is in context. If the chat doesn't narrow it, the agent gets everything created.
- **The filter gates BOTH the system context and the tool belt** (`threadSystem` / `threadToolsFor`):
  "just beats" literally cannot read prose or touch foundations — it's an enforced firewall, not a hint.
- The outline frame (page list + ids) is always included when pages exist, so pages are referenceable.
- Stored per-thread (`book_agent_runs.context_scope`, NULL = all) and sent per-message.

## 7. Why this answers (not worsens) the context-cost worry

One thread that can touch everything sounds expensive; the agent/tool model is precisely the fix:

- **Always-on context is cheap**: system prompt + outline summary + brief, already cache-broken via
  `withCacheBreakpoints` (one breakpoint on the big first message, one on the latest).
- **Read on demand**: the agent pulls only what a command needs via `read_*`; we never dump the whole
  book per turn.
- Existing discipline holds: medium effort, 140s per link, per-turn `MAX_TURNS`, turn counted *before*
  the call so a crash-loop dies instead of being revived forever.

## 8. What collapses

`ReviseChat` (×4 layers), `DnaChatRail`, and `SceneTab`'s chat → **commands + proposal renderers in the
one rail**. `StudioEditorRail` stops routing to N chats and mounts the one agent rail; the active step
biases the agent's default target. The rich diff renderers are kept (they're the verify UI).

## 9. Phases

The proving slice is a **full beats vertical** (decided) — thread-ify the agent AND fold beats in
end-to-end, so the whole convergence is validated on a real second layer before scaling.

1. ✅ **Thread-ify the agent.** `book_agent_runs` → persistent per-book conversation (`kind='thread'`,
   one-per-book unique index): free-text message in → agentic turn → `idle`; per-turn `turns` reset;
   `proposals[]` added. Reuses stop / chain / watchdog wholesale. Rail = `studio/AgentRail.tsx`
   (compose, step feed, stop), `lib/agentThread.ts`. Mounted behind `?rail=agent` (non-destructive).
2. ✅ **Generalized envelope + apply dispatcher.** `AgentProposal { id, layer, summary, data }` in
   `proposals[]`; `applyAgentProposal` routes to existing writers; rail renders by `layer`.
3. ✅ **Command registry** (`lib/agentCommands.ts`). Typing `/` in the rail composer opens a filtered
   menu; picking a command drops its editable prompt in AND focuses the context filter to the
   command's aspects (∩ created). `availableCommands` shows generate-vs-revise by whether the aspect
   exists. Beats commands act (`/generate beats`, `/revise beats`); `/summarize` + `/pressure-test`
   work in any scope; the rest fold in with their layers. *Not yet:* center buttons firing the same
   commands (waits on retiring the per-layer chats — the `onGenerate` bus still drives those centers).
4. ✅ **Beats vertical (the proof):** `read_beats`, `propose_beats` (validated via `sanitizePlan`
   planOnly), `BeatDiff` extracted to a shared component, Apply through the existing beats writer
   (`applyProposal`→`applyBeatPlan`). *Not yet:* retire `ReviseChat(beats)` (both coexist until the
   rail is the default) and the slash-command for it (phase 3).
4b. ✅ **Context filter** (§6b) — scope gates system context + tool belt; default = created aspects.
5. ⬜ **Roll the rest in** (each = read tool + propose tool + keep its renderer + retire its chat):
   foundations, spine, outline, dna, scenes (§6), prose (already there). Then delete the six chats and
   point `StudioEditorRail` at the one rail (drop the `?rail=agent` gate).

Run `cd apps/web && pnpm run typecheck` after each step; keep it green. Don't commit/push unless asked.

## 10. Success criteria

1. One rail per book: every AI action (generate / revise / edit dna / scene / draft) is a command into
   it; the active step only sets the default target.
2. Commands are visible, steerable composer text — not a hidden bus.
3. The agent investigates on demand, asks creative forks, and emits **per-layer proposals** you verify
   inline; Apply routes through the **existing** layer writers (staleness / journey / version-on-apply
   unchanged).
4. Scenes: propose spec → Apply renders → image in gallery.
5. One control surface: stop / discard a proposal / continue, all on the thread.
6. The six per-layer chats are gone; their diff renderers live on as proposal views. Typecheck + lint
   clean; the ladder, approve gates, lints, and the map still work.

## 11. Open decisions

1. **Thread row vs thread+runs.** Recommended: one growing `book_agent_runs`-derived row per book
   (§3). Revisit only if per-turn isolation or history pruning forces a parent/child split.
2. **History / "new chat".** `revision_chats` archives sessions; the agent thread will want the same
   (archive + resume). Reuse that shape on the agent row.
3. **Cross-layer proposals in one turn** are allowed by the envelope (§4) but the v1 UX may cap to one
   pending proposal at a time for legibility — confirm during the beats vertical.
4. **Default-target leakage.** Decide how strongly the active step constrains the agent (hard scope vs
   soft hint). Soft hint recommended — a command names its own layer.
