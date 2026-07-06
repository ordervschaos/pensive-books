# The Driver — the DNA agent loop

> Companion artifact: https://claude.ai/code/artifact/e8306f59-bc9d-41e3-a87f-89c8ceac49d1
> Pipeline overview it drives: `00-pipeline-overview.md`.
> Code: `supabase/functions/book-agent/index.ts` (edge turn loop) ·
> `features/dna/lib/agentThread.ts` (client thread + apply) ·
> `features/dna/hooks/useAutoAccept.ts` (live apply loop) ·
> `features/dna/lib/agentCommands.ts` (slash commands) ·
> `features/dna/lib/dnaJourney.ts` (`currentObjective`).

## The thesis

The pipeline says what each rung IS. The driver is what MOVES a book through
them: a single durable, tool-using story-editor agent that reads the tree,
proposes exactly ONE reviewable change, and idles — then does it again on the
freshly-updated tree. It never writes to `book_nodes` directly; **every change is
a proposal** the author's existing write path applies.

## The turn loop (one chain link)

Each turn = one Claude call, kept short enough to finish inside the ~150s worker
window (effort `medium`, ~30–60s). It ends by STAGING a change and going idle;
the apply happens outside the model, then the loop resumes.

```
01 sense   → rebuild system prompt from the LIVE tree: <dna_tree> digest
             + freshly recomputed <current_objective> + lints
02 think   → one model call; its visible narration IS the chat reply
03 act     → call a tool; reads run inline & chain; propose_* stages & ends turn
04 stage   → change lands in proposals[]; status → idle. NO path straight to book_nodes
05 apply   → author OR auto-accept applies via applyNodeOps (same path as manual UI)
   ↺ resume → next turn re-senses the UPDATED tree. one change per turn.
```

**Load-bearing invariant — read-only on the tree.** The agent can propose but
cannot commit. Every write crosses a review channel — which is what makes an
autonomous mode safe to arm at all: nothing lands that the author (or the exact
same apply path) didn't run. (`book-agent/index.ts` header + every `propose_*`
ending the turn in `idle`.)

## The tool belt (10 tools, 3 families)

**READ — sense deeper** (the digest shows gists; these open detail)
- `read_node` — full content of one node + children + the kind's field schema
- `search_nodes` — grep the whole book, incl. scene prose the digest drops
- `get_schema` — exact field names for a kind (wrong keys silently orphan data)
- `check_against_contract` — judge a scene's existing prose vs the brief mandate

**PROPOSE — never write directly** (each stages a change, ends the turn)
- `propose_node_ops` — edit · add · delete · replace_children over real ids
- `propose_options` — 2–4 alternatives ON a node; author picks one in the tree
  (lands on `book_nodes.proposals`, not the run's `proposals[]`)
- `propose_expansion` — delegate heavy passes (beat sheet / a beat's scenes) to
  the dna-expand engine; the engine run happens client-side
- `propose_prose_render` — delegate the off-worker prose stream; the agent never
  generates prose itself

**CONTROL — the turn**
- `ask_author` — park on a real creative fork → `awaiting_input`; no chain until
  answered (in auto mode it's auto-answered "decide yourself", never parks)
- `finish` — conclude, but ends `idle` not `done`, so the conversation continues

The agent authors the LIGHT rungs itself (logline, premise, pillar, cast, acts);
it DELEGATES the heavy craft (beat sheet, scenes, prose) — craft one model turn
can't reliably reproduce.

## The two exits

Same engine, same apply path — the difference is WHO applies and whether the loop
resumes itself.

**Manual (default)** — the proposal waits:
1. Turn ends `idle`; proposal sits in `proposals[]` (phantom overlay in the tree).
2. Author reviews the diff → applies or discards.
3. Apply runs `applyNodeOps` → tree updates.
4. The next *message* drives the following turn.

**Auto-accept ∞** — armed with `context_auto`; the loop closes itself:
1. Turn ends `idle` with a staged change (never `ask_author`).
2. `useAutoAccept` applies `proposals[0]` — the SAME path — while the thread is
   quiescent (single-flight ref + skip-set = exactly-once).
3. `continueAgent` flips the run back to `running` (no turns reset).
4. Next turn re-senses the updated tree — repeat until `finish`.

One change is always visible before the next is proposed. Bounded by
`AUTO_MAX_TURNS` (50) vs `MAX_TURNS` (20) for a chat.

## Four load-bearing ideas

- **Sense, don't dead-reckon** — objective + lints recomputed on the CURRENT tree
  each link (`threadSystem` re-runs the pure engine twins), never from the
  author's stale message-time snapshot.
- **Anchor, not fence** — always sees + may touch any unlocked node;
  `<current_objective>` points at the one next rung; attached nodes focus
  attention but never wall off the rest.
- **Delegate the craft** — author light, engine heavy (above).
- **Quiescent, not terminal** — a turn ends `idle`, not `done`, so one persistent
  thread per book carries the whole conversation with full transcript context.

## Durability (surviving the 150s wall)

- **the row** — one `book_agent_runs` row (`kind='thread'`, one per book), watched
  over Realtime — refresh is a no-op.
- **self-chain** — each link makes ONE Claude call under the cap, persists the
  transcript, re-invokes itself (`reinvoke` via `EdgeRuntime.waitUntil`). A long
  build = many short crash-safe hops.
- **ask_author parks** — sets `awaiting_input` and does NOT chain; the run sleeps
  for free until answered, then resumes exactly where it stopped.
- **the watchdog** — a pg_cron job revives only stalled `running` rows — never a
  parked or idle one.
- **turn budget** — counted BEFORE each call, so a crash-loop still burns down.

## The composer (agentCommands / AgentRail)

Slash commands are sugar over a plain message: picking one drops an editable,
context-carrying instruction into the composer (generate beats / revise structure
/ pressure-test / summarize …). `generate` commands offer when an aspect is
absent, `revise` when present. Every AI action passes through the one rail.
