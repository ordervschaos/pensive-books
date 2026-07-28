# Agent Architecture — Diagram

Visual map of the **book-agent**: the book's ONE tool-using story-editor. Diagram-first companion to
`agent-runtime-architecture.md` (which is the pure-plumbing prose) and `agent-rail.md` (the product
intent). Everything below is grounded in `supabase/functions/book-agent/*.ts` as of 2026-07-15.

**The one idea:** the agent is not a process in memory — it is **one database row**
(`book_agent_runs`, `kind='thread'`, one per book). Compute is disposable: an edge-function worker
reads the row, does one turn, writes it back, and dies. Any worker (or the watchdog cron, or a
second tab) resumes from the row alone. *Architectural term: externalized/durable state — stateless
compute over stateful storage.*

---

## 1. The whole system at a glance

```mermaid
flowchart TB
    subgraph client["Browser (AgentRail)"]
        U[Author types message / answers / Stop]
        AA[Auto-accept watcher<br/>applies staged ops to book_nodes]
        RT[Realtime subscription<br/>row change → re-read → render]
    end

    subgraph edge["Edge function: book-agent"]
        IDX[index.ts<br/>request router + auth]
        DRV[advance.ts · driveChain<br/>in-worker turn driver]
        ADV[advance.ts · advance<br/>ONE chain link = ONE Claude call]
        CTX[context.ts · threadSystem<br/>per-turn prompt assembly]
        TOOLS[tools.ts · threadToolsFor<br/>the tool belt]
        EXEC[exec-tools.ts · toolResults<br/>run read-class tools]
        PROP[proposals.ts<br/>validate propose_* → staged proposal]
    end

    subgraph store["Postgres (source of truth)"]
        ROW[(book_agent_runs<br/>the row IS the process)]
        NODES[(book_nodes<br/>the Novel DNA tree)]
        BOOK[(books<br/>brief · craft_notes)]
    end

    LLM[["_shared/llm.ts · callLLM<br/>Anthropic / DeepSeek / Qwen"]]
    CRON[pg_cron watchdog<br/>revives stalled 'running' rows]

    U -->|POST bookId,message| IDX
    AA -->|POST runId,autoContinue| IDX
    IDX --> ROW
    IDX -->|chain: reinvoke self| DRV
    DRV --> ADV
    ADV --> CTX
    CTX --> BOOK
    CTX --> NODES
    ADV --> TOOLS
    ADV --> LLM
    LLM --> ADV
    ADV -->|read-class tools| EXEC
    ADV -->|propose_* tools| PROP
    EXEC --> NODES
    PROP --> ROW
    ADV -->|persist transcript/steps/status| ROW
    ADV -->|not done → step| DRV
    ROW -.Realtime.-> RT
    AA -.applies.-> NODES
    CRON -.revive.-> DRV
```

**Read this as:** the client only ever *kicks* the loop (a POST) and *watches* the row (Realtime).
All thinking happens inside the durable loop. The agent **never writes `book_nodes` itself** — it
stages proposals; the client applies them.

---

## 2. Request entry paths (`index.ts`)

Four shapes of POST hit the same function. Only `chain` is machine-authenticated (a shared secret);
the rest are the authenticated author.

```mermaid
flowchart LR
    A["{ bookId, message }"] -->|author| G[get-or-create thread row<br/>reset turns · append msg] --> K[chain kick]
    B["{ runId, answer }"] -->|author answers ask_author| H[append tool_result<br/>status→running] --> K
    C["{ runId, autoContinue }"] -->|auto-accept resume| I[status idle→running] --> K
    D["{ runId, chain:true }"] -->|self / watchdog · secret| DR[driveChain]
    K -.reinvoke self.-> D
```

- **message** — the persistent omni-rail conversation. A turn ends in `idle` (not `done`), so the
  next message resumes with full transcript context. One thread per book.
- **answer** — resumes a run parked in `awaiting_input` by `ask_author`.
- **autoContinue** — the auto-accept live loop: client applied the last staged change to the tree,
  now asks the agent's next turn to read the *updated* tree. Pure status flip, no transcript edit.
- **chain** — the cross-worker self-invoke; drives the next turn.

---

## 3. The durable loop — `driveChain` → `advance`

`driveChain` runs turns **back-to-back in one worker** while wall-clock budget remains, then hands
off to a fresh worker at the boundary — avoiding a reinvoke + cold boot per logical turn. Each
individual Claude call still fits the ~150s worker cap, so durability holds.

```mermaid
flowchart TB
    START([chain call]) --> DC{driveChain:<br/>budget ≥ 90s left?}
    DC -->|no| HANDOFF[chain → fresh worker] --> DONE1([return])
    DC -->|yes| ADV[advance one turn]
    ADV --> OUT{Outcome}
    OUT -->|continue| DC
    OUT -->|retry| BACKOFF[sleep 2s → fresh worker]
    OUT -->|stop| DONE2([return])

    subgraph advance_detail["advance() — one chain link"]
        L1[load row · guard status/cancel/MAX_TURNS] --> L2[threadSystem:<br/>instructions + bookState]
        L2 --> L3[tick turns · persist steps<br/>start cancel poll 1s]
        L3 --> L4[callLLM<br/>max_tokens 5000 · effort medium]
        L4 --> L5{inspect tool_uses}
    end
    ADV -.expands to.-> advance_detail
```

**Turn budget & guards** (`advance.ts`):

| constant | value | why |
|---|---|---|
| `MAX_TURNS` | 20 | interactive runaway guard |
| `AUTO_MAX_TURNS` | 100 | autonomous builds iterate change-by-change |
| `CALL_TIMEOUT_MS` | 140_000 | one call must fit the ~150s worker cap |
| `max_tokens` | 5000 | ~55 tok/s decode → all that fits the timer |
| `output_config.effort` | `medium` | HIGH thought past the timer (billed aborts) |

Turns are counted **before** the call, so a mid-call worker death still burns budget and a
crash-looping run hits the ceiling instead of being revived forever.

---

## 4. Tool dispatch — where a turn ends (`advance` L5)

Two tool *classes*. **Read-class** tools execute inline and the loop continues. **Terminal**
(`propose_*` / `finish` / `ask_author`) end the turn — the agent is read-only on `book_nodes`, so
every write goes out as a *staged proposal* the author (or auto-accept) applies.

```mermaid
flowchart TB
    RESP[Claude response · tool_uses] --> T{which tool?}

    T -->|read_node · search_nodes<br/>get_schema · read_skill<br/>check_against_contract<br/>update_vision · audit_vision<br/>research_web| READ[exec-tools · toolResults<br/>fan out concurrently]
    READ --> APPEND[append tool_results<br/>status stays running] --> CONT([continue])

    T -->|propose_node_ops| P1[validate vs live tree + lock fence]
    T -->|propose_prose_render| P2[stage render request]
    T -->|propose_expansion| P3[stage engine pass<br/>beatsheet/scenes/premise/…]
    T -->|propose_options| P4[stage 2–4 options ON node]
    P1 & P2 & P3 --> STAGE[push to run.proposals<br/>status→idle] --> STOP([stop · await author apply])
    P4 --> ONNODE[push to book_nodes.proposals<br/>status→idle] --> STOP

    T -->|ask_author| ASK{auto mode?}
    ASK -->|no| PARK[status→awaiting_input<br/>question in pending] --> STOP2([stop · await answer])
    ASK -->|yes| JOURNAL[journal fork as decision step<br/>auto-answer · proceed] --> CONT

    T -->|finish| FIN[status→idle · report] --> STOP3([stop · quiescent])
    T -->|none| BARE{auto mode?}
    BARE -->|no| IDLE[status→idle] --> STOP3
    BARE -->|yes| NUDGE[inject 'act or finish' sentinel] --> CONT
```

**Read-class vs terminal** is the load-bearing distinction: reads compose (batch them in one turn),
proposals are the only exit and each ends the turn. A rejected proposal (fails validation against the
live tree / lock fence) is handed back as the failing tool's result so the next turn can correct.

---

## 5. Per-turn context assembly (`context.ts · threadSystem`)

Prompt is split for **prompt-cache prefix discipline**: a byte-stable `instructions` block (cached)
plus a volatile `bookState` injected at the *end* of the latest user message — so the changing tree
never invalidates the cached prefix.

```mermaid
flowchart LR
    subgraph stable["instructions (system-cached · byte-stable per run)"]
        SYS[SYSTEM_THREAD role prompt]
        EFF[effort line · low = fast propose]
        AUT[autonomous_mode block · if auto]
    end

    subgraph volatile["bookState (rebuilt every call · injected request-time)"]
        BRF[brief + vision · binding voice contract]
        CN[craft_notes · researched reference]
        OBJ[current_objective · guided-flow anchor*]
        SA[story_analysis · structural lints]
        BS[between_scenes · ledger entering next draft]
        FOC[focus · attached nodes hydrated full]
        MEN[mentioned · intent-hydrated named nodes]
        SK[skill_briefs · playbooks matched to ask]
        TREE[dna_tree · WHOLE tree as digest]
    end

    stable --> CALL[callLLM]
    volatile --> CALL
```

Key mechanisms:

- **Tree digest** — the whole tree ships every turn, but each node is a one-line digest
  (handle/gist + causal + meter spine). Full content is one `read_node` away. Keeps tokens bounded.
- **Intent hydration** — nodes the *message* names (by "scene 14", node id, or entity name) get
  their full plan + a named scene's prose inlined, deterministically (regex + DFS numbering) — no
  `read_node` round-trip to act on the ask.
- **Three-state objective** *(\*)* — a concrete typed ask OMITS the objective; an empty ask, the
  "Next" nudge, or `auto` injects it (in auto it IS the work queue).
- **Live re-derivation** — objective, analysis, ledger are recomputed from the *current* tree each
  link (same engine the web client runs), so an auto resume advances on its own.
- **Discovery gate** — mid-interview (vision not compiled, building not started) pins the
  `vision-interview` skill and suppresses ask-triggered skills.

---

## 6. The row as a state machine

```mermaid
stateDiagram-v2
    [*] --> running: message (new/resume)
    running --> running: read-class tool → continue
    running --> idle: propose_* / finish / bare reply
    running --> awaiting_input: ask_author (interactive)
    running --> cancelled: cancel_requested
    running --> error: MAX_TURNS / API 4xx / billing
    idle --> running: next message
    idle --> running: autoContinue (auto-accept applied)
    awaiting_input --> running: author answers
    error --> running: next message
```

`status` is the cursor; `transcript` is the agent's real memory; `steps` is the human-readable feed
the chat renders; `proposals`/`pending` hold staged output. The watchdog cron only revives stalled
**running** rows — parked (`awaiting_input`) and quiescent (`idle`) runs are left alone.

---

## 7. The proposal review channel (why the agent can't corrupt the book)

```mermaid
sequenceDiagram
    participant M as Model
    participant R as book_agent_runs.proposals
    participant A as AgentRail (client)
    participant N as book_nodes
    M->>R: propose_node_ops (validated vs live tree + locks)
    Note over R: turn ends · status idle
    R-->>A: Realtime → render staged proposal
    alt manual review
        A->>N: author clicks Apply → applyNodeOps
    else auto-accept
        A->>N: watcher auto-applies
        A->>M: POST autoContinue → next turn reads updated tree
    end
```

There is **no path from the agent straight to `book_nodes`**. Every mutation is a validated,
reviewable proposal applied through the existing write path (`applyNodeOps`, the v2 prose pipeline,
or the `dna-expand` engine). This is the safety invariant of the whole design.

---

## Where each piece lives

| Concern | File |
|---|---|
| Request router + auth | `index.ts` |
| Loop driver + one chain link | `advance.ts` (`driveChain`, `advance`) |
| Per-turn prompt assembly + tree digest | `context.ts` (`threadSystem`) |
| Tool schemas (the belt) | `tools.ts` (`threadToolsFor`) |
| Read-class tool execution | `exec-tools.ts` (`toolResults`) |
| propose_* validators → staged proposals | `proposals.ts` |
| System prompt text | `prompts.ts` (`SYSTEM_THREAD`) |
| render→verify injection (auto) | `verify.ts` |
| eager ack + thread titling | `ack.ts` |
| transcript compaction / cache breakpoints | `transcript.ts` |
| Row shape + shared types | `shared.ts` |
| LLM chokepoint (provider convert + logging) | `_shared/llm.ts` |
| Self-chain reinvoke + secret | `_shared/self-chain.ts` |
```

