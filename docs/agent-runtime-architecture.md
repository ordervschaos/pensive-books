# Agent Runtime Architecture (pure plumbing)

How the book agent stays alive, continues its own work, and stays mirrored on screen — the
runtime substrate only. Nothing here is about *what* the agent writes (story/DNA); everything
here would be the same if it were a customer-support bot. If you understand this file you can
build another durable agent on the same rails.

The four questions this doc answers:

1. **How is a thread kept alive?** — across a 150s worker cap, a closed tab, and a dropped network call.
2. **How is the next task continued?** — the self-chain loop and the auto-accept live loop.
3. **How is the display refreshed?** — Realtime signal → authoritative re-read.
4. **How is DB-changed information handled?** — the UI triggers/handlers and the row-merge rules.

---

## 0. The one idea everything hangs off: the row IS the process

The agent is not an object living in a server's memory. **The single source of truth is one
database row** (`book_agent_runs`, `kind='thread'`, one per book). The row holds the entire
process state:

| column | what it is |
|---|---|
| `status` | the state-machine cursor: `running` / `awaiting_input` / `idle` / `error` / `cancelled` |
| `transcript` | the raw LLM message array (system/user/assistant/tool_result) — the agent's *real* memory |
| `steps` | the human-readable feed the chat renders (`user`/`note`/`read`/`ask`/`plan`/`applied`…) |
| `proposals` | staged, reviewable changes awaiting apply/discard |
| `pending` | the parked question when `status='awaiting_input'` |
| `turns` | per-turn budget counter (runaway guard) |
| `cancel_requested` | cooperative stop flag |
| `context_auto` / `context_effort` / … | mode flags carried so every worker sees them |

Architectural term: **externalized / durable state** (a.k.a. *stateless compute over stateful
storage*). The compute (an edge function invocation) is disposable and short-lived; it reads the
row, does one unit of work, writes the row back, and dies. Any worker — or the recovery cron, or a
second browser tab — can pick up exactly where the last one left off because *there is nothing to
pick up except the row*.

This is why the app's standing rule "**refresh = no-op**" holds: the UI is a **projection** of the
row, not a holder of state. Reloading the page just re-subscribes to the same row.

```
        ┌──────────────────────────────────────────────┐
        │   book_agent_runs row  (THE process)          │
        │   status · transcript · steps · proposals …   │
        └──────────────────────────────────────────────┘
              ▲                    │
     writes   │                    │  Realtime push (signal)
     one unit │                    ▼
        ┌───────────┐        ┌───────────────┐
        │ edge fn    │        │ browser (rail) │  ← pure projection
        │ (compute)  │        │  refresh=no-op │
        └───────────┘        └───────────────┘
```

---

## 1. How a thread is kept alive

Three different threats to "alive", three different mechanisms. Don't conflate them.

### 1a. Surviving the 150s worker wall-clock — the **self-chain**

Supabase edge workers on the free plan die at ~150s. An agent turn can be many LLM calls. The
primitive that escapes this ceiling is **self-chaining continuation** (`_shared/self-chain.ts`):

> do ONE unit of work → persist the row → `EdgeRuntime.waitUntil(reinvoke(self, { runId, chain:true }))` → return

`reinvoke` fires a fresh HTTP POST *to the same function* and resolves as soon as the request is
**dispatched** (not when it completes) — that's the whole trick. `waitUntil` keeps the dying worker
alive just long enough to hand the baton off. The next unit runs in a **fresh worker with a fresh
150s budget**. One Claude call per link, each comfortably under the cap.

Architectural terms: **continuation-passing** (each step names its successor), **fire-and-forget
dispatch**, **baton-passing / relay**. It's a trampoline where each bounce is a new process.

Trust boundary: a chain call carries the service-role bearer **plus** an `x-chain: <CHAIN_SECRET>`
header. `isChainCall()` gates on it, so a chain link skips user-auth and operates on the row id
directly. A logged-out client can't forge it (never has the secret). No secret set → chaining is
simply disabled (fail-closed).

The loop body is `advance()` in `book-agent/index.ts`:

```
advance(runId):
  row = SELECT ... WHERE id = runId
  if row.status != 'running': return          # not ours to drive (parked/done/gone)
  if row.cancel_requested:  status='cancelled'; return
  if row.turns >= maxTurns: status='error';    return   # runaway guard
  turns++ ; persist                            # count BEFORE the call (a crash still burns budget)
  resp = callLLM(transcript, tools)            # the ONE call this link makes
  for each tool_use in resp:
     terminal tool (finish / propose_*)  → write result, set status idle/done/awaiting_input, RETURN
     read tool (read_node/search/…)      → execute, append tool_result, chain again
```

Every non-terminal branch ends with `reinvoke(...)`; every terminal branch just writes the row and
returns *without* chaining. That asymmetry is the state machine.

### 1b. Surviving a dropped chain link — the **watchdog** (liveness backstop)

If a worker dies *between* persisting progress and dispatching the next link (crash, network blip),
the chain is broken and the row would sit in `running` forever. The safety net is a **pg_cron +
pg_net watchdog** (`revive_stalled_chains`, runs every minute):

> find any row `status='running' AND updated_at < now() - 5min AND NOT cancel_requested` → POST the
> same `{ runId, chain:true }` continue call the worker would have.

Architectural terms: **watchdog timer / lease expiry / reaper**, and **idempotent recovery**. The
5-minute threshold is deliberately generous — longer than any live unit — so it only ever fires on a
genuinely dead chain, never races live work. `book_agent_runs` rows in `running` are covered
alongside `generate-book` and `build-revision`.

**Crucial nuance:** only `running` is revived. `awaiting_input` and `idle` are **quiescent**
statuses — the agent is *correctly* waiting on the human, not dead. Reviving them would be a bug.
So the state machine's "waiting" states are invisible to the watchdog by design.

### 1c. Surviving a closed tab / keeping the *conversation* alive — `idle`, not `done`

An eval-style agent run ends `done` (terminal). The **thread** ends a turn in **`idle`** instead —
a quiescent-but-resumable status. The transcript is retained, so the next message the author sends
appends to it and the agent has full history. That single status choice (`idle` vs `done`) is what
turns a one-shot task into a persistent conversation. Closing the tab changes nothing: the row is
idle on the server, and reopening re-projects it.

---

## 2. How the next task is continued

There are **two** continuation loops. Keep them separate in your head.

### 2a. Within one turn — the internal tool loop (server-owned)

Described above: read → append `tool_result` → `reinvoke` → next Claude call. This is the agent
"thinking" and using tools. The turn ends when the model calls a **terminal tool** (`finish`,
`propose_node_ops`, `propose_prose_render`, `propose_options`) or replies with plain text.
Terminal → set `idle`/`awaiting_input`, stop chaining.

### 2b. Across turns — how a new task starts

Three entry points, all authenticated client POSTs to `book-agent`, all ending in "write row →
`reinvoke` → return `202`":

| trigger | client fn | server effect |
|---|---|---|
| author sends a message | `sendAgentMessage` | get-or-create thread row; append `user` step + transcript msg; `status='running'`, `turns=0`; chain |
| author answers a parked question | `answerAgent` | append `tool_result` for `pending.tool_use_id`; `status='running'`; chain |
| auto-accept resumes the run | `continueAgent` | pure `status: idle→running` flip (no transcript edit); chain |

Notice the client **never waits for the answer**. It fires the POST, gets a `202 Accepted`, and the
real result arrives later over Realtime (§3). This is **asynchronous request/acknowledge**, not
request/response. The `202` means "accepted, work started", not "here's your answer".

### 2c. The auto-accept LIVE loop — the one place continuation crosses the client

Normally the agent stages a `proposal` and *stops* (`idle`), waiting for a human to click Apply.
**Auto-accept mode** (`context_auto`) automates the human. This is a **distributed loop** split
across server and client — worth understanding because it's the trickiest part:

```
   SERVER turn                         CLIENT (useAutoAccept hook)
   ───────────                         ───────────────────────────
   agent proposes ONE change
   status = 'idle'  ───Realtime──▶     row.status becomes 'idle' + has a proposal
                                        applyAgentProposal()   # reuse the MANUAL apply path
                                        continueAgent()  ──────┐
   status idle→running  ◀──────────────────────────────────────┘
   next turn reads the UPDATED tree
   proposes the NEXT change ...        (repeat until agent calls finish)
```

Why bounce through the client at all? Because **the write engine lives client-side** (applying node
ops, streaming prose in the browser). Rather than duplicate that engine on the server, the server
idles and lets the client perform the author's gesture, then resume. One change per turn means each
change is *visible in the tree before the next is proposed* — genuinely live, not a batch dump.

Safety mechanics in `useAutoAccept`:
- **single-flight ref** (`busy`) — never act while a previous action is in flight.
- **hands-off while `running`** — only act on quiescent (`idle`/`awaiting_input`) rows; the edge fn
  owns the row while running.
- **exactly-once skip-set** — each item's id is claimed *before* running, so a stale row that
  re-presents an already-applied `add` can't duplicate nodes, and a poison item can't hot-loop.
- **always resume, even on failure** — a proposal that can't apply is discarded and the run is
  resumed anyway; otherwise one bad change would leave the run idle-stuck forever (the watchdog only
  revives `running`, not `idle`).

The turn budget (`MAX_TURNS`) is **not** reset by `continueAgent`, so the whole autonomous burst is
still bounded server-side — the client can't drive an infinite loop.

### 2d. Stopping — `stopRun`

Two shapes of stop, because a looping worker would clobber a naive status write:
- **while looping** (`running`) → set `cancel_requested=true`. The `advance()` loop polls this flag
  every 5s (via a `setInterval` that aborts the in-flight Claude `AbortSignal`) and marks itself
  `cancelled` cleanly.
- **while parked** (`awaiting_input`) → no worker is looping to notice the flag, so write
  `status='cancelled'` directly.

Terminal status is `cancelled` (not `error`) so a stop reads as a stop in history. Honest caveat:
an in-flight LLM call keeps generating and **bills** after you hang up — stopping saves the *next*
turn, not the current one.

---

## 3. How the display is refreshed

The golden rule: **a Realtime event is only a SIGNAL, never the source of truth.** The authoritative
read is always a fresh HTTP `SELECT`.

### The signal → re-read pattern (`useLatestTaskRow`)

```
Postgres UPDATE on book_agent_runs
        │
        ▼  (supabase_realtime publication)
WebSocket push  →  channel.on('postgres_changes', payload)
        │
        ├─ consider(payload.new)   # OPTIMISTIC: apply payload immediately for instant feel
        └─ scheduleRefetch()       # AUTHORITATIVE: debounced 200ms → SELECT the real row
```

Why not just trust the pushed payload? Two well-known Postgres/Realtime failure modes make the raw
payload unreliable, and this app hit both:

1. **The "unchanged-TOAST" gotcha.** When an `UPDATE` doesn't touch a large (TOASTed) jsonb column,
   Postgres omits it from the WAL new-tuple. The pushed row arrives with `steps=null` — which would
   **blank the chat feed** mid-turn. (You'll see comments all over the edge fn re-writing
   `steps: row.steps` alongside unrelated updates specifically to force the column into the WAL.
   `REPLICA IDENTITY FULL` on the table is the broader fix; the belt-and-suspenders re-write covers
   callers that still slip through.)
2. **Oversized payloads.** A big UPDATE can exceed Realtime's payload limit and get dropped as an
   empty/413 — which would freeze the UI on the last-seen status (e.g. the auto-accept loop stuck on
   "running"). PostgREST has no such limit, so the re-read catches it.

The re-read via HTTP sidesteps **both**, because it never depends on the payload body. The pushed
event is used only as a *"something changed, go look"* nudge. Architectural terms: **event
notification vs. event-carried-state-transfer** (this is deliberately the former), **read-your-own-
authoritative-state**, **debounce/coalesce** (a burst of events → one SELECT).

### Defense-in-depth row merge (`consider`)

Even the optimistic apply is defensive. When a payload for the *same* row arrives, `consider` merges
rather than replaces: for any key that is `null` in the incoming payload but non-null in the held
row, it **patches the old value back in**. Rationale: no writer in this app intentionally nulls a
column that held real data, so a null is *always* an unchanged-TOAST artifact, never a real change.
A different (newer) row id replaces wholesale; an older one is ignored. This is a **last-write-wins
with null-hostile merge** conflict policy.

### The stale watchdog (client side)

`useLatestTaskRow` also arms a timer while the row is in an `activeStatuses` state (`running`). If
the row hasn't advanced within `staleMs` (6 min for the rail), it flips `stale=true` and the UI
shows *"This turn stalled — it may have died."* Note the rail passes **only `running`** as active —
`awaiting_input` idles on the human and must never be flagged stale.

---

## 4. How DB-changed information is handled — the UI triggers & handlers

The rail (`AgentRail.tsx`) is a thin projection. Here's the full trigger/handler map.

### Inbound: row → screen (derived, memoized projections)

```
row  (from useLatestTaskRow)
 ├─ steps      → chat bubbles (StepBubble): user/answer = right bubble,
 │                note/ask = markdown prose, read = muted activity line,
 │                applied/discarded = collapsed ResolvedCard
 ├─ proposals  → ProposalCard(s) with Apply / Discard
 ├─ pending    → the answer composer (when status='awaiting_input')
 ├─ sessions   → archived-chat history drawer
 ├─ status     → running→"thinking…" spinner · error→RunError · idle→composer + "next step" nudge
 └─ context_auto → the ∞ auto toggle + arms useAutoAccept
```

All derived with `useMemo` off `row`, so a new row over Realtime re-renders the whole surface with
zero client-held conversation state. That's the "refresh = no-op" guarantee cashed out.

### Outbound: gesture → server (handlers, all async-ack)

| UI gesture | handler | writes |
|---|---|---|
| type + Enter | `send` → `sendAgentMessage` | new `user` step, `running` |
| answer a question | `reply` → `answerAgent` | `tool_result`, `running` |
| Apply a proposal | `apply` → `applyAgentProposal` | runs node ops on `book_nodes`, drops proposal, leaves `applied` step |
| Discard | `discard` → `discardAgentProposal` | drops proposal, leaves `discarded` step |
| Stop | `stop` → `stopRun` | `cancel_requested` / `cancelled` |
| New chat / resume | `newChat` / `resume` | archive to `sessions[]` / restore |

Every handler ends by calling `refetch()` — belt-and-suspenders so the UI reconciles even if the
Realtime push is slow or dropped. The server write it triggered will *also* push a Realtime event;
both funnel through the same authoritative SELECT, so a double-signal just coalesces.

### Two client-owned write paths (not just the edge fn)

Not all row writes come from the agent. The client writes the row directly in two safe cases,
**always gated on the thread being quiescent** (`idle`, never `running`/`awaiting_input`) so it
never races the edge fn that owns the row mid-turn:

- **Resolving a proposal** (`resolveProposal`) — apply/discard drops it from `proposals[]` and
  appends an `applied`/`discarded` step. Re-reads `steps` fresh before writing to avoid clobbering
  anything the edge fn wrote.
- **Logging a human decision** (`logAgentTurn`), **staging an engine-produced proposal**
  (`stageGeneratedProposal`), **session archive/restore** — all `maybeSingle` → check `status` is
  idle → merged write.

This is **cooperative ownership** of a shared row: server owns it while `running`; client may write
it while quiescent. The `status` field is the mutex.

### Optimistic echo

On send, the composer stashes the sent text in `optimistic` state and renders it as a faded bubble
immediately — before the row round-trips. A `useEffect` clears it once the real `user`/`answer` step
appears in `steps`. Pure perceived-latency polish; the row is still the truth.

---

## 5. Putting it together — one full message, end to end

```
1. author types, hits Enter
2. AgentRail.send: optimistic bubble + sendAgentMessage(POST book-agent)
3. edge fn: append user step+transcript, status='running', reinvoke(chain), return 202
4. ── Realtime push (INSERT/UPDATE) ──▶ useLatestTaskRow: consider() + debounced SELECT
5. rail re-renders: optimistic bubble replaced by real step, "thinking…" spinner
6. chain link: one Claude call
      ├─ wants to read? → execute tool, append tool_result, reinvoke → back to 6
      └─ terminal? → write proposal/answer, set status idle/awaiting_input
7. every row write ──Realtime──▶ SELECT ──▶ rail projects the new steps/proposals
8. status='idle' → spinner gone, composer back, proposal card (or next-step nudge) shown
9. (if a chain link ever dies in 'running' > 5min → pg_cron watchdog re-kicks it)
```

Every arrow is either a **fire-and-forget dispatch** (never awaited for its result) or a
**signal-then-authoritative-read**. Nowhere does one component block waiting on another's return
value. That is the whole architecture: **a durable row, disposable compute that relays itself, and a
UI that projects the row and only ever nudges it.**

---

## Glossary of the named patterns

- **Externalized/durable state** — process state lives in a DB row, not worker memory; any worker resumes it.
- **Self-chaining continuation (trampoline)** — each worker does one unit then dispatches its own successor to beat the wall-clock.
- **Fire-and-forget dispatch** — `reinvoke` resolves on send, not completion; `waitUntil` keeps the dying worker alive to send it.
- **Watchdog / reaper + idempotent recovery** — pg_cron re-kicks chains dead >5min; generous threshold avoids racing live work.
- **Quiescent state** (`idle`/`awaiting_input`) — resumable-but-not-running; invisible to the watchdog by design.
- **Asynchronous request/acknowledge (202)** — client fires and returns; the answer arrives later over Realtime.
- **Event notification vs. event-carried-state-transfer** — Realtime is used as a *signal only*; the row is re-read over HTTP.
- **Debounce/coalesce** — a burst of Realtime events collapses to one authoritative SELECT.
- **Unchanged-TOAST gotcha** — Postgres omits untouched large jsonb from the WAL, arriving as `null`; fixed by re-writing the column + `REPLICA IDENTITY FULL` + null-hostile merge.
- **Last-write-wins with null-hostile merge** — the client's row-conflict policy in `consider`.
- **Cooperative ownership / status-as-mutex** — server writes the row while `running`, client while quiescent.
- **Cooperative cancellation** — `cancel_requested` flag polled between units; parked rows cancelled directly.
- **Optimistic UI** — faded echo bubble before the row round-trips, reconciled on arrival.
```
