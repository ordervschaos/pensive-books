// AgentTree — the collapsible, self-similar Q&A tree of the book-agent's architecture. Each node
// gives a complete understanding at its own depth and ends with the questions its children answer
// (progressive disclosure, applied recursively — read to any depth and leave with a coherent, just
// coarser, picture). Ported from a standalone HTML artifact once MDX made raw <details>/<summary>
// renderable in-app; kept as a dedicated component (not inlined in the .mdx) because its CSS and
// expand/collapse controls need real scoping and event handlers, which markdown prose can't hold.
import { useRef } from "react";

// Scoped under .agent-tree-doc (never applies outside this component) and under .not-prose (see
// agent-tree.mdx) so Tailwind Typography's default `code`/`p`/`details` styling doesn't fight this
// tree's own layout. Dark mode follows the app's real mechanism (Tailwind's `.dark` class), not a
// prefers-color-scheme media query, since the app already resolves and applies theme itself.
const CSS = `
.agent-tree-doc {
  --at-muted: #6e6a60; --at-line: #e2ded4; --at-accent: #8a4b12; --at-qcolor: #3d5a80; --at-chip: #efece4;
  font-family: Georgia, 'Times New Roman', serif;
}
.dark .agent-tree-doc {
  --at-muted: #97917f; --at-line: #2e2c25; --at-accent: #d98e4a; --at-qcolor: #8fb3d9; --at-chip: #211f19;
}
.agent-tree-doc .controls { margin: 0 0 1.5rem; }
.agent-tree-doc .controls button {
  font: 12px/1 ui-monospace, Menlo, monospace; color: inherit;
  background: var(--at-chip); border: 1px solid var(--at-line); border-radius: 4px;
  padding: .4rem .7rem; margin: 0 .5rem .5rem 0; cursor: pointer;
}
.agent-tree-doc .controls button:hover { border-color: var(--at-accent); }
.agent-tree-doc details { margin: .35rem 0; }
.agent-tree-doc details details { margin-left: 1.1rem; padding-left: .9rem; border-left: 1px solid var(--at-line); }
.agent-tree-doc summary {
  cursor: pointer; list-style: none; padding: .15rem 0;
  display: block; position: relative; padding-left: 1.1rem;
}
.agent-tree-doc summary::-webkit-details-marker { display: none; }
.agent-tree-doc summary::before {
  content: '▸'; position: absolute; left: 0; top: .18rem;
  color: var(--at-accent); font-size: .85rem; transition: transform .12s ease;
}
.agent-tree-doc details[open] > summary::before { transform: rotate(90deg); }
.agent-tree-doc details.leaf > summary::before { content: '·'; }
.agent-tree-doc summary:hover { color: var(--at-accent); }
.agent-tree-doc .q {
  font: 600 .72rem/1.3 ui-monospace, Menlo, monospace;
  color: var(--at-qcolor); letter-spacing: .04em; text-transform: uppercase;
  display: block;
}
.agent-tree-doc .a { font-weight: 700; }
.agent-tree-doc .body { margin: .35rem 0 .6rem; padding-left: 1.1rem; }
.agent-tree-doc .body p { margin: 0 0 .55rem; }
.agent-tree-doc .term { font: .8rem ui-monospace, Menlo, monospace; color: var(--at-accent); white-space: nowrap; }
.agent-tree-doc .next {
  font-size: .85rem; color: var(--at-muted); font-style: italic; margin: .2rem 0 .4rem;
  padding-left: 1.1rem;
}
.agent-tree-doc code { background: none; padding: 0; font-weight: normal; }
.agent-tree-doc code::before, .agent-tree-doc code::after { content: none; }
`;

export function AgentTree() {
  const rootRef = useRef<HTMLDivElement>(null);

  const expandAll = () => rootRef.current?.querySelectorAll("details").forEach((d) => { d.open = true; });
  const collapseAll = () => rootRef.current?.querySelectorAll("details").forEach((d) => { d.open = false; });
  const overview = () => {
    collapseAll();
    rootRef.current?.querySelectorAll(":scope > details, :scope > details > details").forEach((d) => {
      (d as HTMLDetailsElement).open = true;
    });
  };

  return (
    <div ref={rootRef} className="agent-tree-doc not-prose">
      <style>{CSS}</style>
      <div className="controls">
        <button onClick={expandAll}>expand all</button>
        <button onClick={collapseAll}>collapse all</button>
        <button onClick={overview}>overview (2 levels)</button>
      </div>

      {/* ═══════════════════════ ROOT ═══════════════════════ */}
      <details open>
      <summary><span className="a">The whole thing in one sentence:</span> a tool-using LLM agent whose entire process state lives in <em>one database row</em>, driven by disposable serverless workers that relay themselves, which re-reads a compact digest of the whole book every turn — and whose <em>only</em> way to change the book is staging proposals that a separate actor applies.</summary>
      <div className="body">
        <p>It presents as a chat rail beside a book, but architecturally it is four commitments: <span className="term">durable state</span> (the process is a Postgres row, not a server), <span className="term">a tool loop</span> (one LLM call per link, where the <em>kind</em> of tool called is the control flow), <span className="term">staged writes</span> (decide ≠ apply), and <span className="term">per-turn context assembly</span> (the prompt is rebuilt from live truth every call). Everything else — autonomy, recovery, speed — falls out of those four.</p>
      </div>
      <div className="next">You should now be asking: where does it live? what is a turn? how does it change things it can't write? how does it see a whole book? what if no one's watching? why does it feel fast? ↓</div>

        {/* ─────────────── 1. WHERE DOES IT LIVE ─────────────── */}
        <details>
        <summary><span className="q">Q · If workers are disposable, where does the agent actually live?</span> <span className="a">In one row. The row is not a snapshot of the process — it IS the process.</span></summary>
        <div className="body">
          <p>The <code>book_agent_runs</code> row holds everything: the raw LLM transcript, the human-readable feed, staged proposals, the parked question, the state-machine cursor, the turn counter. Compute (a serverless function invocation) reads the row, does one unit of work, writes it back, and dies. Any worker, any browser tab, any recovery cron resumes perfectly — because there is nothing to resume except the row. Pattern: <span className="term">externalized / durable state</span>.</p>
        </div>
        <div className="next">But: what exactly is in it? how does compute survive a 150-second execution cap? what if a worker dies mid-hand-off? and why does refreshing the page change nothing? ↓</div>

          <details>
          <summary><span className="q">Q · What exactly is in the row?</span> <span className="a">A state cursor, two histories, the staged work, and the guards.</span></summary>
          <div className="body">
            <p><code>status</code> (running / awaiting_input / idle / error / cancelled — the state machine), <code>transcript</code> (the raw message array — the model's real memory), <code>steps</code> (the chat feed humans see), <code>proposals</code> (staged changes), <code>pending</code> (a parked question), <code>turns</code> (budget), plus mode flags carried so every worker sees them.</p>
          </div>
          <div className="next">Why keep two histories — transcript AND steps? ↓</div>
            <details className="leaf">
            <summary><span className="q">Q · Why both a transcript and a step feed?</span> <span className="a">Two audiences, one source of truth — and they're genuinely two separate stored fields, not one derived from the other.</span></summary>
            <div className="body">
              <p>The model needs exact system/user/assistant/tool_result messages to continue reasoning; a human needs a readable narrative of what happened. Same events, two projections, written in parallel by the same code, in the same row update — not <code>steps</code> computed from <code>transcript</code> at render time.</p>
              <p><code>transcript</code> holds the raw <span className="term">LLM wire format</span> — the literal JSON shape the provider's API sends/expects, not a domain concept: tagged content blocks like <code>{'{type:"text",...}'}</code> and <code>{'{type:"tool_use",id,name,input}'}</code>, nested in a <code>content</code> array, built for the model to re-parse next call. <code>steps</code> is a flat, simple shape (<code>{'{t:"note"|"read"|"plan"|...,label}'}</code>) built by picking the human-relevant text OUT of that same response the moment it arrives — e.g. every <code>{'{type:"text"}'}</code> block becomes a <code>{'{t:"note",label}'}</code> step, right beside the line that appends the untouched block to <code>transcript</code>. Deriving the feed from the transcript at render time instead would force the UI to walk provider-shaped content blocks and know which ones mean what — i.e. the frontend would have to understand the LLM API's own protocol. Writing <code>steps</code> at the same moment as <code>transcript</code> means the UI only ever renders the flat shape and never touches wire format at all.</p>
            </div>
            </details>
          </details>

          <details>
          <summary><span className="q">Q · How does it survive the ~150s worker wall-clock?</span> <span className="a">A trampoline: each worker does one unit, then fires an HTTP call to itself and dies.</span></summary>
          <div className="body">
            <p>Do one unit → persist the row → POST to your own function with the run id — resolving on <em>dispatch</em>, not completion, with <code>waitUntil</code> keeping the dying worker alive just long enough to hand off. The successor gets a fresh 150s clock. Pattern: <span className="term">self-chaining continuation</span> — each bounce of the trampoline is a new process.</p>
          </div>
          <div className="next">Isn't a full reinvoke + cold boot per LLM call wasteful? ↓</div>
            <details className="leaf">
            <summary><span className="q">Q · Isn't one reinvoke per LLM call wasteful?</span> <span className="a">Yes — so a driver loops turns in-worker until the clock runs low.</span></summary>
            <div className="body"><p><code>driveChain</code> runs turns back-to-back in the same worker while wall-clock budget remains, giving each continued turn only the remaining clock as its LLM timeout, and hands off to a fresh worker at the boundary. It refuses to start a turn that can't comfortably fit — an aborted call still <em>bills</em>, so it's cheaper to give a fresh worker its full clock. An <span className="term">amortized trampoline</span>: chain durability without paying chain overhead between fast turns.</p></div>
            </details>
          </details>

          <details>
          <summary><span className="q">Q · What if a worker dies between persisting and dispatching?</span> <span className="a">A cron watchdog re-kicks any row stuck in 'running' for over 5 minutes.</span></summary>
          <div className="body">
            <p>A severed chain leaves the row in <code>running</code> forever with no worker attached. The watchdog sweeps every minute and re-fires the same continue call a worker would have. The threshold is deliberately generous — longer than any live unit — so it never races real work. Pattern: <span className="term">watchdog / reaper + idempotent recovery</span>.</p>
          </div>
          <div className="next">Then why doesn't it also revive rows sitting in idle or awaiting_input? ↓</div>
            <details className="leaf">
            <summary><span className="q">Q · Why never revive 'idle' or 'awaiting_input'?</span> <span className="a">Those states are correctly waiting on a human — reviving them would be a bug.</span></summary>
            <div className="body"><p><span className="term">Quiescent states</span> are alive-but-parked: the agent asked a question, or finished and awaits the next message. They are invisible to the watchdog <em>by design</em> — the state machine encodes "waiting" as distinct from "dead", and only 'running' can be dead.</p></div>
            </details>
          </details>

          <details>
          <summary><span className="q">Q · Why is refreshing the page a no-op?</span> <span className="a">The UI is a pure projection of the row — it holds no conversation state of its own.</span></summary>
          <div className="body">
            <p>The browser subscribes to row changes over Realtime and re-renders everything from the row. Closing the tab, losing the network, opening a second tab — nothing changes, because nothing lived in the tab.</p>
          </div>
          <div className="next">So does the UI just trust whatever the Realtime push says? ↓</div>
            <details className="leaf">
            <summary><span className="q">Q · Does the UI trust the pushed payload?</span> <span className="a">No — a push is only a signal; the truth is always a fresh SELECT.</span></summary>
            <div className="body"><p>Two real failure modes make pushed payloads unreliable: Postgres omits unchanged large jsonb columns from the replication tuple (the <span className="term">TOAST gotcha</span> — the feed would blank to <code>null</code>), and oversized payloads get dropped entirely (the UI would freeze on a stale status). So the push means "something changed, go look", and a debounced authoritative re-read fetches the real row. Pattern: <span className="term">event notification, not event-carried state transfer</span>.</p></div>
            </details>
          </details>
        </details>

        {/* ─────────────── 2. WHAT IS A TURN ─────────────── */}
        <details>
        <summary><span className="q">Q · What does one turn of the loop actually look like?</span> <span className="a">Load row → guard → one LLM call → dispatch by tool class: reads continue the loop, proposals end it.</span></summary>
        <div className="body">
          <p>The deep design move: the model never decides "should I keep looping" in prose — the <em>class</em> of tool it called decides. Read tools (read a node, search, fetch a schema) execute, append results, and loop again. Proposal tools stage a change and <em>end the turn</em>. Ask parks the run; finish concludes it. That asymmetry makes "one staged change per turn" a structural guarantee, not a prompt suggestion. Pattern: <span className="term">terminal vs. non-terminal tools</span>.</p>
          <p><span className="term">Guard</span> is the three early-exit checks that run BEFORE the LLM call — the expensive, billable step — so an invalid run never pays for one more turn it shouldn't have: (1) the row still exists and is <code>status: 'running'</code> — otherwise this call has no business driving a parked, finished, or vanished run; (2) <code>cancel_requested</code> is false; (3) <code>turns</code> hasn't hit the ceiling. Each is a <span className="term">guard clause</span> — an early return that rejects one invalid state, so the checks read as a flat list up top instead of nested conditionals burying the failure cases.</p>
        </div>
        <div className="next">Why gate on 'running' specifically? what happens on a malformed tool call? what bounds a runaway? how does stopping work? and why does a finished turn end 'idle' instead of 'done'? ↓</div>

          <details className="leaf">
          <summary><span className="q">Q · Why check the row is 'running' before doing anything?</span> <span className="a">Ownership — otherwise this call has no business driving the run.</span></summary>
          <div className="body"><p>A worker can be woken by a stale Realtime signal, a duplicate dispatch, or the watchdog re-kicking something that already finished. If the row isn't <code>'running'</code>, some other event already resolved it — parked on a question, idled out, or gone — so this invocation just returns <code>"stop"</code> without touching anything. The check is what makes a redundant wake-up harmless instead of a double-turn.</p></div>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · What happens when the model calls a tool wrong?</span> <span className="a">The validator's complaint is returned AS the tool's result, and the loop continues.</span></summary>
          <div className="body"><p>A proposal with a bad node id, a schema violation, or a locked-node touch doesn't error the run — the rejection text becomes the <code>tool_result</code>, the model reads it, and corrects itself next call. Pattern: <span className="term">rejection-as-tool-result / self-repair</span>. The turn budget bounds how long it can flail.</p></div>
          </details>

          <details>
          <summary><span className="q">Q · What stops a runaway loop?</span> <span className="a">A hard turn ceiling — 20 interactive, 100 autonomous — checked every link.</span></summary>
          <div className="body"><p>Hitting the ceiling fails the run honestly with an explanatory error rather than looping forever. Autonomy gets a higher ceiling because change-by-change iteration legitimately needs more calls — but it is still bounded.</p></div>
          <div className="next">One subtlety: when is the counter incremented? ↓</div>
            <details className="leaf">
            <summary><span className="q">Q · Why increment the counter BEFORE the LLM call?</span> <span className="a">So a crash mid-call still burns budget.</span></summary>
            <div className="body"><p>If the count came after, a worker that dies during the call leaves the counter untouched — the watchdog revives it, it crashes again, forever, on your bill. Counting first means a crash loop converges on the ceiling. <span className="term">Count-before-call budgeting</span>: charge for the attempt, not the success.</p></div>
            </details>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · How does stopping work if a worker is mid-call?</span> <span className="a">Cooperatively — a flag the loop polls every second, aborting the in-flight request.</span></summary>
          <div className="body"><p>Stop sets <code>cancel_requested</code>; the loop polls during the LLM call and fires an abort signal. A <em>parked</em> row has no loop polling, so it's cancelled by direct status write — two shapes of stop for two states. Honest caveat: an aborted provider call keeps generating and billing server-side; cancellation saves the <em>next</em> turn.</p></div>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · Why does a finished turn end 'idle', not 'done'?</span> <span className="a">'Idle' keeps the transcript — that one status choice turns a task runner into a conversation.</span></summary>
          <div className="body"><p>A terminal 'done' would make every exchange a one-shot job. 'Idle' is quiescent-but-resumable: the next user message appends to the retained transcript and re-runs the loop with full history.</p></div>
          </details>

          <details>
          <summary><span className="q">Q · What do you call the whole run of turns from one user message to the next idle?</span> <span className="a">A <span className="term">turn-cluster</span> — every turn since the last user/answer step.</span></summary>
          <div className="body"><p>One <em>turn</em> = one LLM call (the counter the 20/100 ceiling checks). A <strong>turn-cluster</strong> is however many turns chain together in response to ONE thing the user did — a message, or an answer to a parked question — running turn after turn (reads looping the chain) until a terminal tool fires and the row goes idle/awaiting_input/cancelled/error. Restarting always needs a fresh trigger from outside: a new message, an answer, or (auto mode) the auto-continue resume. It's genuine codebase vocabulary, not invented for this doc — the loop computes it by walking <code>steps</code> backward until it hits a <code>user</code>/<code>answer</code> step, to dedupe the "Loaded X playbook" grounding lines: without it, an autonomous run re-injecting the same context every turn printed the identical line every turn (the "10 identical Step 5/5 lines" bug).</p></div>
          <div className="next">Is a turn-cluster stored anywhere, or computed on demand? ↓</div>
            <details className="leaf">
            <summary><span className="q">Q · Is a turn-cluster stored in the DB in an identifiable way?</span> <span className="a">No — it's implicit, reconstructed on demand by scanning for boundary markers. And the counter that LOOKS like it tracks this actually tracks something coarser.</span></summary>
            <div className="body"><p>No <code>cluster_id</code>, no dedicated table, nothing segmented at write time. <code>steps</code> entries carry a <code>t</code> discriminator (<code>"user" | "note" | "read" | ...</code>) but no cluster tag — a cluster's start is found by walking <code>steps</code> backward until <code>t==="user"</code> or <code>t==="answer"</code>, fresh every time, never cached. <code>transcript</code> (wire format) isn't segmented either — the equivalent search skips pure-<code>tool_result</code> messages and harness sentinels until it finds one with real typed text. The counter that LOOKS like the answer, <code>turns</code>, is actually coarser: it resets to 0 only on a fresh <code>sendAgentMessage</code> — answering a parked question and the auto-accept resume both deliberately leave it untouched (so <code>MAX_TURNS</code> still bounds a whole autonomous burst), which means <code>turns</code> silently spans MULTIPLE turn-clusters across an ask→answer park/resume or an auto-accept run. Two different implicit boundaries, diverging exactly where you'd assume they line up.</p></div>
            </details>
          </details>
        </details>

        {/* ─────────────── 3. HOW DOES IT CHANGE THE BOOK ─────────────── */}
        <details>
        <summary><span className="q">Q · How does it change the book if it can't write to it?</span> <span className="a">It stages typed, validated proposals; a separate actor applies them through the same path human edits use.</span></summary>
        <div className="body">
          <p>The agent has zero mutation authority over the document. Every change is a discrete proposal object on the row — inspectable, journaled, reversible. Pattern: <span className="term">staged writes / plan–apply split</span>. Who applies depends on mode: the human clicks Apply, or (autonomous) the client applies automatically — same gate, automated.</p>
        </div>
        <div className="next">Why bother staging at all? how are huge vs. tiny edits expressed? why does it delegate heavy generation instead of doing it? and is there really no exception? ↓</div>

          <details className="leaf">
          <summary><span className="q">Q · Why staged writes instead of letting it edit directly?</span> <span className="a">One write engine, an always-on audit trail, an optional human gate, and reversibility.</span></summary>
          <div className="body"><p>Proposals flow through the <em>same</em> apply path as human edits — one engine to harden instead of two. Every change is a recorded event (never an opaque in-place rewrite), checkpoints can roll the whole document back, and the review gate can be human or automated without changing the architecture.</p></div>
          </details>

          <details>
          <summary><span className="q">Q · How are big and small edits expressed?</span> <span className="a">An op vocabulary spanning five sizes — and the descriptions push toward the smallest sufficient one.</span></summary>
          <div className="body"><p>Merge-edit a node, add, delete, rebuild-all-children-of-a-level, and a tiny find/replace for surgical text patches. Many small independent ops batch into one proposal. <span className="term">Op granularity</span> is where you teach an agent economy — and the tool descriptions carrying that teaching are the longest strings in the codebase, deliberately: they're firmware, not documentation.</p></div>
          <div className="next">What about a change that touches a hundred places, like a rename? ↓</div>
            <details className="leaf">
            <summary><span className="q">Q · How does "rename X everywhere" avoid a hundred tool calls?</span> <span className="a">One edit op on the entity's node — a database trigger fans it out.</span></summary>
            <div className="body"><p>The agent sets the entity's <code>name</code> once; a Postgres trigger propagates the rename into every occurrence in the same write. The general rule: when an operation is mechanical, push it <em>below</em> the tool boundary — never make the model enumerate and loop what the data layer can do in one transaction.</p></div>
            </details>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · Why does it delegate heavy generation instead of writing itself?</span> <span className="a">The agent is a router with taste; specialized engines do the bulk work.</span></summary>
          <div className="body"><p>Whole-structure generation and full prose rendering are staged as <em>requests</em> to separate pipelines with their own tuned prompts (prose even streams in the browser, escaping the server wall-clock entirely). The agent contributes what only it has: the decision, the timing, and a small curated steering brief from its reads. Keeps agent turns cheap; lets each engine be tuned in isolation.</p></div>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · Is there really no direct write?</span> <span className="a">One — capturing the user's own stated intentions — and its exemption teaches the rule.</span></summary>
          <div className="body"><p>The vision-capture tool writes without review because it records <em>the user's words</em>, not the agent's ideas — the risk a review gate protects against isn't present. Gate writes by <em>whose content they carry</em>, not by write-ness alone.</p></div>
          </details>
        </details>

        {/* ─────────────── 4. CONTEXT ─────────────── */}
        <details>
        <summary><span className="q">Q · How does it decide what to look at, given a whole book every turn?</span> <span className="a">The prompt is rebuilt each call in two layers: stable instructions that cache, and live state injected at the very end.</span></summary>
        <div className="body">
          <p>The system prompt (role, invariants, tool routing) is byte-identical across a run, so the provider's prompt cache keeps it warm. The volatile part — the current document digest, lints, pre-loaded content — is injected at the <em>tail of the latest message</em>, never persisted. Because it's never stored, exactly one current snapshot exists in context: the model <em>cannot</em> ground on a stale tree, because no stale tree is there. Pattern: <span className="term">prompt-cache prefix discipline</span>.</p>
        </div>
        <div className="next">How does a whole book fit? how do things the user names arrive pre-loaded? why is the ask repeated at the end? where does craft technique live? and what stops the transcript from bloating? ↓</div>

          <details className="leaf">
          <summary><span className="q">Q · How does a whole book fit in a prompt?</span> <span className="a">As a digest — one line per node — with read tools as the magnifying glass.</span></summary>
          <div className="body"><p>Each node ships its id, kind, a gist, and its <em>relational</em> fields (dependencies, what it establishes, ordering — numbered to match what the user's UI shows). Full content is one <code>read_node</code> away. The digest answers "what exists, what connects, what's missing" — empty fields are dropped so absence <em>reads as missing</em> instead of hiding in a dump. <span className="term">Digest + drill-down</span>: a map, never the territory.</p></div>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · How do things the user names arrive pre-loaded?</span> <span className="a">Deterministic parsing of the message inlines their full content before the model runs.</span></summary>
          <div className="body"><p>Regexes over the ask — "scene 14", a node id, an entity name, using the same numbering the UI displays — pull each match's full content, ancestor path, and schema into the prompt: everything an edit needs, zero read round-trips. This matters more here than in a chat agent: a round-trip can be a whole chain link (row write, reinvoke, cold prefill). <span className="term">Intent hydration / just-in-time context</span>. User-attached nodes get the same treatment, framed as <em>anchors, not fences</em> — they steer attention but never scope away the rest.</p></div>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · Why is the user's ask repeated at the very end?</span> <span className="a">Because the observed failure was the agent doing what it read last — the lints — instead of the ask.</span></summary>
          <div className="body"><p>After pages of reference material, the last impression wins. A <code>&lt;task&gt;</code> block restates the current ask as the final thing read — standard long-context guidance (<span className="term">query after documents</span>), adopted after a live salience inversion: asked to render a scene, the agent went off fixing lint warnings. Related: ambient state is <em>labeled by mode</em> — the same lint report ships as a directive in autonomous mode but as "reference, act only if asked" interactively, and the derived next-objective is omitted entirely when a concrete ask exists (<span className="term">three-state objective injection</span>).</p></div>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · Where does specialized technique live, if not in the system prompt?</span> <span className="a">In named playbooks, disclosed progressively through three channels.</span></summary>
          <div className="body"><p>The system prompt keeps invariants plus a one-line index. Full playbook bodies arrive by (1) that index, (2) deterministic regex triggers on the ask that inline matching bodies, (3) a <code>read_skill</code> tool for missed phrasings. The split rule: <em>safety-critical invariants never live in a skill</em> — a missed trigger must never cost safety. Determinism means a retried link re-derives the identical prompt, preserving resumability. <span className="term">Progressive disclosure</span>.</p></div>
          </details>

          <details>
          <summary><span className="q">Q · What stops the transcript from bloating over a long run?</span> <span className="a">Compaction: old bulky read results are stubbed to one-line pointers; the newest bulky message is protected.</span></summary>
          <div className="body"><p>Past a size threshold, older large <code>tool_result</code> bodies become "pruned — re-read if needed" stubs (the live digest is always present anyway). Blocks are replaced, never removed, so tool-call pairing survives; the rule is deterministic, so retries re-derive identical context.</p></div>
          <div className="next">Why "newest bulky message", so specifically? ↓</div>
            <details className="leaf">
            <summary><span className="q">Q · Why key protection to the newest BULKY message?</span> <span className="a">Because the two obvious heuristics both failed in production.</span></summary>
            <div className="body"><p>A <em>count</em>-based window fails when one batched message carries a whole read sweep — it protects everything or nothing. "Newest tool message" fails because tiny post-apply ACKs are also tool messages — the sweep the model still needed got pruned right after every apply, producing a read → apply → re-read-everything loop. Only a message actually <em>carrying bulk</em> — the working set — claims protection.</p></div>
            </details>
          </details>
        </details>

        {/* ─────────────── 5. AUTONOMY ─────────────── */}
        <details>
        <summary><span className="q">Q · What happens when the human walks away?</span> <span className="a">The same agent with four flag-controlled changes — most notably, the apply gate is automated by the client.</span></summary>
        <div className="body">
          <p>Autonomous mode is not a second agent: (1) a prompt addendum — carry every request to a committed change; (2) questions never park; (3) a higher turn ceiling; (4) the browser auto-applies each staged change and resumes the run. Same proposal-then-apply path, gates automated.</p>
        </div>
        <div className="next">How does it not deadlock at a creative fork? why does the loop bounce through the browser? what stops stalls and infinite gathering? and does anything check the output? ↓</div>

          <details className="leaf">
          <summary><span className="q">Q · How does it not deadlock on a question no one will answer?</span> <span className="a">The ask is answered instantly by the system — and journaled for the human to review later.</span></summary>
          <div className="body"><p>At a genuine fork the agent still asks, stating its options and its own choice; the system replies "proceed with your stated choice" and records question, options, and decision as a reviewable step. <span className="term">Decision journaling</span> beats both extremes: blocking forever, and deciding silently.</p></div>
          </details>

          <details>
          <summary><span className="q">Q · Why does the autonomous loop bounce through the browser?</span> <span className="a">Because the apply engine lives client-side — the server idles, the client applies, then resumes the run.</span></summary>
          <div className="body"><p>Agent stages ONE change → goes idle → Realtime tells the client → the client applies it via the <em>same</em> path a human click uses → flips the run back to running. Duplicating the write engine server-side means two engines to keep honest; and one-change-per-turn means each change is visible in the document before the next is proposed — the agent iterates against reality, not its plan. A <span className="term">distributed continuation</span> crossing the server/client boundary, guarded by: single-flight, only-act-when-quiescent (status is the mutex), and an exactly-once claim set. The server turn budget is never reset by resumes, so the client can't drive an unbounded loop.</p></div>
          <div className="next">What if an apply fails? ↓</div>
            <details className="leaf">
            <summary><span className="q">Q · What if an apply fails?</span> <span className="a">Discard it and resume anyway — the alternative is a run stuck forever where no watchdog looks.</span></summary>
            <div className="body"><p>A poison proposal that halted the loop would leave the row 'idle' — a quiescent state the watchdog deliberately ignores. So the watcher always resumes, even on failure: better to lose one change than strand the run.</p></div>
            </details>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · What stops it stalling or gathering forever?</span> <span className="a">Sentinel-tagged synthetic nudges — and the lesson that prompts reduce failure modes, only backstops eliminate them.</span></summary>
          <div className="body"><p>Two observed failures, two mechanical answers. <em>Bare-narration stall</em> ("once that applies, I'll…" — then nothing): inject one "act or finish" prod; a sentinel string marks it, and a second stall in a row goes honestly idle instead of prodding forever. <em>Gather-forever</em>: building a complete inventory of scattered problems while compaction prunes the early reads — one live run did 125 steps, 15 turns, 0 changes; after 15 consecutive reads with no proposal, a forced-commit message fires: fix what you've already read, now. Sentinels keep harness messages distinguishable from real user text.</p></div>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · Does anything check the output when no one's reviewing?</span> <span className="a">A verify pass judges each generated result against its own declared plan — carefully, to protect its credibility.</span></summary>
          <div className="body"><p>After a generation lands, the next turn opens with an injected plan-conformance verdict. Two refinements worth copying: the judge reads <em>resolved</em> references (the actual promise text, not an id hash), and known data-duplication artifacts are scoped out before judging — because a false FAIL teaches the agent to dismiss the verifier (<span className="term">alarm fatigue</span>), quietly defeating the layer. A verifier's credibility is a budget: spend it only on true positives.</p></div>
          </details>
        </details>

        {/* ─────────────── 6. FAST & HONEST ─────────────── */}
        <details>
        <summary><span className="q">Q · Why does it feel fast, and how does it stay honest across models?</span> <span className="a">Latency theater at the edges, token budgets sized to physics, and one provider chokepoint.</span></summary>
        <div className="body">
          <p>None of this touches the core loop — it shapes perception and portability around it.</p>
        </div>
        <div className="next">How does it respond instantly? why are its token caps so low? how does the same loop run on cheap models? ↓</div>

          <details className="leaf">
          <summary><span className="q">Q · How does it respond instantly when a turn takes a minute?</span> <span className="a">A cheap, deliberately blinded narrator model speaks first.</span></summary>
          <div className="body"><p>On a fresh message, a fast model emits one sentence of "here's what I'll do next" before the real turn starts (<span className="term">say-then-do</span>). It's fenced hard: it sees only the latest message plus one line of prior context, is told it cannot see the book, and must never claim findings or blockers — scoping the narrator's <em>knowledge</em> is what stops it confabulating. Silently pre-injected context is also surfaced as visible "Loaded X" activity lines, so the user watches grounding happen instead of a spinner.</p></div>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · Why cap output at ~5k tokens and medium reasoning?</span> <span className="a">Because that's all the physics allows: decode speed × remaining wall-clock.</span></summary>
          <div className="body"><p>~55 tokens/sec inside a 140s timer ≈ 5k tokens. A bigger cap produced turns that died at the timer, were retried verbatim, and died again — in <em>billed</em> streaks. When a loop runs under a hard clock, token budgets are a scheduling decision, not an ambition setting; big work splits across turns by design.</p></div>
          </details>

          <details className="leaf">
          <summary><span className="q">Q · How does one loop run on many providers?</span> <span className="a">One conversion chokepoint, with the strictest provider setting the contract.</span></summary>
          <div className="body"><p>Every call goes through a single shared module speaking one message shape internally, converted per provider. The strictest rule wins everywhere: OpenAI-style APIs demand a result for <em>every</em> tool call, so terminal tools get synthetic "ok" ACKs even where Anthropic wouldn't need them. Model <em>roles</em> are fenced in config (the agent role only resolves to tool-capable models), and every call is logged with function/task/user attribution — the raw material for cost accounting and offline evals.</p></div>
          </details>
        </details>

      </details>

    </div>
  );
}
