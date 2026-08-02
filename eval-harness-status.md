# DNA agent eval harness — status

**Where it stands:** the premise-rung eval loop is built and running end-to-end. You can drive a book
headlessly, grade it on three families of criteria, and calibrate the graders. What is *not* done is the
A/B itself — and there is one blocker that must be resolved before any A/B number is trustworthy.

**The single most useful thing learned today:** of the ~8 failures observed, **7 were in the harness, not
the agent** — and two of them I initially reported to you as agent defects. A harness produces confident
numbers whether or not it works. That is the entire argument for the `--refs` calibration step.

---

## 1. What you can run today

| Command | Does |
|---|---|
| `pnpm dna:dryrun <bookId> [--queue] [--watch]` | Read-only. What would the auto-accept watcher do right now? Safe against a live browser-driven thread. |
| `pnpm dna:run --task <id> [--auto] [--dry] [--max-steps N] [--max-chat N]` | Drives a fresh scratch book to the premise gate. |
| `pnpm dna:run --book <id>` | Drives an existing book. |
| `pnpm dna:grade --book <id> --task <id> [--refs] [--no-judges]` | Grades a run. `--no-judges` is free. |

## 2. Architecture — the one decision that shaped everything

The agent's build loop is **split-brain**: the `book-agent` edge fn proposes ONE change and idles; a
watcher applies it and resumes. That watcher was React-only, so an automated build needed a browser tab.

**Rather than port the apply engine to Node (a third twin of write logic), only the ~40-line DECISION was
extracted.** Everything else is the real thing:

```
apps/web/src/features/dna/lib/autoAccept.ts     ← nextAutoAction(), shared VERBATIM with the browser
      ↑                              ↑
useAutoAccept.ts (browser)     scripts/agent-build-run.mts (Node)
      └─────────── both call the REAL applyAgentProposal / applyNodeOps / generateExpansionOps ──────────┘
```

The only thing swapped is the supabase client, via a tsconfig `paths` override
(`scripts/harness/tsconfig.json`). Two one-line app edits were needed so those modules load outside Vite:
`localFn.ts` and `agentThread.ts` now read `import.meta.env` through the object (Vite still inlines it; it
is simply undefined under Node).

**Fidelity note:** the harness authenticates as a **real user** (magic-link mint), not the service role, so
writes go through the same RLS policies a browser hits. An earlier estimate that headless would bypass RLS
was wrong — that gap is closed.

**Halt condition** is the product's own gate — `stageComplete(nodes).premise` — not a bespoke rule. Prose
is additionally halted at the layer level as a backstop.

### Files

```
apps/web/src/features/dna/lib/autoAccept.ts       the shared decision (pure; all imports are `import type`)
apps/web/src/features/dna/lib/autoAccept.test.ts  11 tests locking that decision
scripts/harness/env.ts                            .env.local + real-user JWT mint
scripts/harness/supabaseClientNode.ts             Node stand-in for the browser supabase client
scripts/harness/tsconfig.json                     the paths override that makes the swap work
scripts/harness/thread.ts                         shared reads, errText, premiseProgress (the halt predicate)
scripts/harness/author.ts                         the scripted author (user simulator)
scripts/agent-build-run.mts                       the applying driver
scripts/agent-build-dryrun.mts                    the observe-only driver
scripts/eval-premise.mts                          the grader
scripts/eval-premise-tasks.json                   3 fixtures with reference answers
```

## 3. The ladder already existed

`stageSubsteps("premise")` in `dna-journey.ts` is literally **interview (vision) → seed (logline) →
premise (dramatic question)** — the exact progression to evaluate. The harness reuses it rather than
defining its own, so it can never disagree with the product about what "done" means.

## 4. What gets measured

**A · deterministic** — gate reached, sub-steps, logline shape checks, `must_mention` / `must_avoid`.

**B · trajectory** — the family nothing else in the repo covered. Turns, step histogram, reads,
`ask_author` count, applied/discarded, tokens, cache-read ratio, providers, errors, latency. Straight off
`ai_calls` + `book_agent_runs`, which already log everything.

**C · model judges** — the deployed `read-logline` / `read-premise`, called through the app's own
`buildBriefFitInput` / `buildLoglineFitInput` so the judge sees exactly the payload the UI sends.

**The author reports four signals that say WHERE to look when a run goes wrong** — the thing that stopped
me misattributing my own bugs:

| Signal | Means |
|---|---|
| `fallbackUses` | the fixture under-specifies this agent's questions |
| `nudges` | the agent narrated instead of asking |
| `repeats` | the agent re-asked what it was already told (retention) |
| `ambiguous` | fixture patterns overlap — answer chosen by rule ordering |
| `pushes` | the author had to DEMAND the artifact |

## 5. Results so far

**Calibration (`--refs`, `thin-brief`): 10/10.** The task is solvable and the graders are not impossibly
strict. This is the precondition for trusting anything else.

**Book 1278 (existing 57-turn full build), trajectory only:**
```
reads/turn 3.53 · applied 69 · discarded 5 · 8 errors · 339 ai calls · 6891s model time
tokens in 12,475,339 · cache-read 9,518,208 = 43% of prefill
```
> ⚠️ **Cache-read is 43% of prefill.** Now #1's bar is "cache-read ≫ input." This is close to the inverse.
> Measured, not diagnosed — worth its own investigation, independent of the eval work.

**Run 1347 (author-present, author only ANSWERS):** gate not reached, 6/10, `applied 0`, `asks 0`. The
agent interviewed for 12 exchanges and staged nothing.
**This was a fixture artifact, not an agent defect** — see below.

**Run 1348 (author pushes after 8 questions):** the agent staged its first change immediately after the
push — `apply [dna] Write the logline into the seed`, Interview ✓.

### The finding that survives

**The agent does not self-converge from interview to building, but it does converge when told.**
Run 1347's author only ever answered questions, so it could only test *"does the agent converge
unprompted?"* — never *"can it reach the gate with a cooperative author?"*, which is the question that
matters. Adding author patience (`pushAfter: 8`) split one unreadable outcome into three:

- `pushes 0` + gate → self-converged
- `pushes > 0` + gate → converged only when told ← **currently observed**
- `pushes > 0` + no gate → cannot close even under instruction

### A separate product finding

**Auto mode has a hole.** `auto: true` promises the author can walk away, but the agent asks its questions
in **prose**, which routes around `ask_author` entirely — so `pending` stays null, auto-mode's auto-answer
never fires, and the run parks. In a browser a human just replies; unattended it is a silent stall.

## 6. ⚠️ Blocker before any A/B

**The regex author is coupled to how the agent PHRASES questions, so it is not variant-neutral.** A
variant could score better merely by hitting the patterns more often. That invalidates the comparison the
whole exercise exists to make.

The fix is an **LLM-backed author** — fact sheet + "answer only from these facts," temperature 0 —
which is phrasing-independent and treats both arms identically. It is blocked today because **no LLM key
reaches Node** (they live in the Supabase edge env), so it needs a proxy or a local key.

> This reverses an earlier recommendation of mine. I argued for a deterministic regex author on A/B-validity
> grounds; the phrasing-coupling argument is stronger and points the other way. Determinism is worth
> something, but not at the cost of variant-neutrality.

## 7. The harness bugs, in order (all initially looked like agent failures)

1. Hand-rolled node projection dropped `book_id` → every write would have failed. Fixed by delegating to
   the app's own `loadTree`. *The exact twin-drift this harness exists to prevent, one level down.*
2. `String(e)` on a PostgREST rejection prints `[object Object]`, hiding #1. → `errText()`.
3. Progress read `SubStep.done`, which doesn't exist (it's `.status`) → a finished book reported an empty
   premise.
4. `/resolve/` matched inside **"unresolved"** → an ending answer to a question about a drowning. A
   confidently *wrong* author answer is worse than a fallback. → word boundaries.
5. Matched the agent's declarative **recap** instead of its question, so its echo re-triggered the rule
   that produced it — the author repeated itself while the agent protested "you've said it three times."
   → `questionsIn()` extracts interrogatives only.
6. Phrasing-coupled rules missed "Who's inside?" → topic-noun matching (safe only because #5 strips the
   recap first).
7. `\bshe\b|\bher\b` in the protagonist rule — a catch-all in a topic-noun costume. → removed.
8. Messages containing no `?` at all were answered with a random fact → separate `nudge` path.
9. `reads/turn` divided by `book_agent_runs.turns`, which **resets per user message** → reported 20 reads
   ÷ a counter rolled back to 1. Now also reports `readsPerAiCall`, with the caveat printed inline.

## 8. Next

1. **Resolve the LLM-author blocker** — precondition for §6. Everything below is gated on it.
2. Run N trials × M fixtures. One run per variant is two samples of noise; `eval-logline.mjs` already has
   `--trials` as the pattern to copy.
3. `context_variant` column on `book_agent_runs` + branch in the deployed fn, so both arms ship in ONE
   deploy and trials can be **interleaved** (sequential deploy-A-then-B is confounded by provider drift).
4. Pairwise preference judge, position randomized.
5. Separately, and not gated on any of the above: **diagnose the 43% cache-read ratio.**
