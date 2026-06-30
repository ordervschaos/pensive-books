# Agent capabilities — what the DNA agent can and can't do

> Reference for the book's one tool-using agent (the AgentRail thread). Companion to
> `agent-rail.md` (the design), `agent-context-model.md` (anchors-not-fences), and
> `apps/web/src/features/dna/FEATURE.md` (the manifest). This doc is the **capability surface**:
> the tool belt, the hard limits, and why each limit exists.

The edge function is `supabase/functions/book-agent/index.ts` (formerly `revise-agent` — the name is
historical; it was promoted from the eval-revision agent into the omni-rail, see `agent-rail.md §1`).
The client surface is `apps/web/src/features/dna/lib/agentThread.ts`, mounted as `AgentRail`.

---

## What it is

**One durable, tool-using agent thread per book.** Every AI action — generate beats, revise structure,
draft prose, pressure-test — is a message into this single rail. Slash commands (`/generate beats`,
`/revise structure`) are just editable, pre-contextualized text dropped into the composer; the agent
could do the same from plain language.

Mechanically: a **self-chaining durable loop** over a `book_agent_runs` row (`kind='thread'`). One
Claude-shaped call per chain link (to stay under the ~150s Supabase worker cap), persist the
transcript, then chain again or **park**. `ask_author` parks the run in `awaiting_input` until the
author answers; a pg_cron watchdog (`revive_stalled_chains`) revives stalled `running` rows. The row
*is* the conversation — the next message resumes with full transcript context. Status ends a turn in
`idle`, not `done`.

The agent always sees the **whole book** as a digest (handles + causal spine); there is no context
fence (`agent-context-model.md`). It pulls full detail on demand.

---

## The tool belt

From `threadToolsFor()` in `book-agent/index.ts`:

### Read (investigate, on demand)
| Tool | What it does |
|---|---|
| `read_node` | Pull one node's **full** content by id (a beat's whole summary, a character's wound/lie/idiolect, a scene's prose). The tree it's handed is only a digest. |
| `search_nodes` | Full-text **grep** across every field of every node, **including scene prose** (which the digest hides). "Where is the keyring mentioned?" |
| `get_schema` | The exact content field schema for a node kind — required keys, allowed values, id-ref types. Call before writing, or wrong keys silently orphan data. |
| `check_against_contract` | Judge a scene's **prose** against the book's brief mandate (genre, heat, success criteria) — per-axis pass / partial / fail with evidence. |

### Propose (produce a reviewable artifact — always ends the turn)
| Tool | What it produces |
|---|---|
| `propose_node_ops` | Concrete tree changes: `edit` / `add` / `delete` / `replace_children` by real node id. The core write. `replace_children` rebuilds a whole level (all acts, or all beats under an act) without duplicating. |
| `propose_options` | 2–4 **alternative** versions of ONE node to choose among (the options picker). |
| `propose_prose_render` | A **request** to (re)generate full prose for scene(s). The agent does NOT write the prose. |

### Control
| Tool | What it does |
|---|---|
| `ask_author` | Park the run and ask a creative question; resumes when the author answers. |

---

## What it CAN do

- **Read the whole book** at any resolution — digest by default, full node content / prose grep on demand.
- **Generate missing structure** — propose the beats for acts that have none, scenes for beats that
  have none (via `replace_children` / `add`).
- **Revise existing structure** — edit any non-locked node's content; restructure a level.
- **Offer alternatives** — stage 2–4 options on a node for the author to pick.
- **Request prose** — stage a render request; the prose then streams client-side.
- **Judge its own output** — `check_against_contract` verifies a scene's prose against the brief.
- **Ask creative questions** — park on `ask_author` when a fork is the author's to decide.
- **Run autonomously** — with the `auto` ∞ toggle, it commits its own option picks, never parks, and
  the client (`useAutoAccept`) auto-applies each staged proposal, resuming the run one change at a time.

---

## Guided flow — the current objective (the onboarding rail)

The agent doesn't just react; it **leads the author through the DNA one rung at a time**. This is a
*derived* state machine, not a stored checklist:

- The journey (`lib/dnaJourney.ts`) is a **reconciler**: `buildJourney`/`stageSubsteps` derive the *now*
  step from declarative **gate predicates** over the tree (`premise` done = an accepted premise node with
  a central question; `foundations` done = pillar accepted + ≥1 character; …). Desired state = all stages
  done; observed = the tree; the *objective* is the gap.
- `currentObjective(nodes)` turns the now-step into a prompt-ready **anchor**: the active step, what "done"
  looks like, and a per-step recipe (generate options → consult → let it advance). The client computes it
  (the engine lives in the web app) and passes it with every message — the same channel as the story
  analysis — and the edge fn stashes it on `book_agent_runs.context_objective` and injects it into
  `threadSystem`.
- **Nothing to "remove when done."** Because the objective is recomputed from the tree each message, the
  instant a gate is satisfied the next turn already points at the next rung. The tree is the only state.
- It's an **anchor, not a fence**: the whole tree is still visible, and if the author steers elsewhere the
  agent follows. The `AgentRail` also surfaces the now-step as an idle "Next step" nudge.
- **Steps 9–10 (render → pages, publish) are a hand-off, not a write.** Per limits #6/#7 below the agent
  can't cross the render seam, so the final objective tells it to *surface the Render/Publish actions* (and
  the reader URL), never to perform them.

## What it CANNOT do (the hard limits)

1. **Cannot generate prose itself.** Full prose is a long, browser-streamed render that can't run
   inside the ~150s worker. The agent only *requests* it (`propose_prose_render`); the prose streams
   **client-side** via the v2 pipeline (`expandNode` → `/api/stream-prose`). It *can* make small
   wording fixes by editing `content.prose.text` directly via `propose_node_ops`.
2. **Cannot write the tree directly.** Every `propose_*` ends the turn and stages a reviewable
   proposal. The author (or `auto`) applies it. There is no path from the agent straight to `book_nodes`.
3. **Cannot touch a LOCKED node.** Locks are author intent; rejected at both gates.
4. **Cannot write outside the schema.** Wrong field keys silently orphan data, so the boundary is
   **fail-closed** (`proposeNodeOps` rejects malformed ops; the client re-validates via `validateOps`).
5. **Cannot break ancestry in options.** A child elaborates its parent (logline → premise → beats);
   options vary only what the parent leaves open, never reshape an ancestor into a different book.
6. **Cannot publish to the reader.** Applying ops writes `book_nodes` only. The reader sees nothing
   until the **separate, deliberate** `reconcileDna` render (the "Render" button) projects the tree
   into `pages`.
7. **Cannot reach the editor/reader internals.** It owns `book_nodes` and nothing else; the rest of
   the app only reads `pages` across the render seam.

---

## Two gates, two proposal stores

Writes pass **two fail-closed validations**: once server-side in `proposeNodeOps` (locked / scope /
unknown-kind), once client-side in `applyNodeOps` → `validateOps` before it touches `book_nodes`.

Proposals live in **two places**, by natural owner:

| Proposal kind | Tool | Stored on | Why |
|---|---|---|---|
| Node ops, prose-render | `propose_node_ops`, `propose_prose_render` | `book_agent_runs.proposals[]` (the **chat row**) | A multi-node *transaction* — no single home node; the tree overlays it as phantoms. |
| Options | `propose_options` | `book_nodes.proposals` (the **node**) | Alternatives for ONE node — decided at the node, must survive chat archival, rides the table the tree already subscribes to. |

---

## End-to-end (the `/generate beats` path)

```
/generate beats (editable sugar)
   └─▶ sendAgentMessage ──invoke──▶ book-agent (thread branch)
          │   get-or-create book_agent_runs (durable), status=running, waitUntil(reinvoke) → 202
          │   advance() loop: digest tree → Claude → propose_node_ops
          │   proposeNodeOps validates (locked/scope) → push proposals[] → status=idle  [GATE 1]
          ◀── Realtime ──┐
   AgentRail card ───────┘
          │
   Apply (you) / useAutoAccept
          ▼
   applyNodeOps → validateOps → write book_nodes   [GATE 2]   (tree changed; pages UNCHANGED)
          ▼
   [deliberate] Render → reconcileDna → pages   (reader sees it)
```

Two seams: `propose_node_ops`→tree is the **agent** seam; `reconcileDna`→pages is the **render** seam.
Editing structure and publishing prose are deliberately separate gestures.

---

## The ceiling (where it stops)

Per `dna-studio-analysis.md` and `true-agent.md`:

- **Strong:** global beat sheet, causality-as-data (a beat's `therefore` must be *earned* by produced/
  consumed state keys), and the propose→review→apply discipline that keeps the author in the loop.
- **Weak:** today it is largely a **one-shot forward pass** — generate → verify once → done — not a
  tight iterative eval loop. `check_against_contract` is the first move toward closing that; the
  verify-loop-first roadmap (`true-agent.md`) is the path past it.
