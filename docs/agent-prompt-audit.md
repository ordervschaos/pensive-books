# Agent prompt audit — inefficiencies & inaccuracies in the DNA thread agent

> **Status:** findings 1, 2, 3, 4, and 6 are fixed (this pass). 5 was left as-is (flagged low
> priority, not urgent). A 7th issue turned up while fixing #6 — see below. The §3 sync test
> (`bookAgentDigestFields.test.ts`) has since been added — nothing is "still open" from this audit
> except the real illustration tool (§2, option a), a deliberately bigger follow-up.

> Follow-up to the scene-ordering bug fixed in commit `dfdac61` (the tree digest was sorted by
> `level` alone, so the agent couldn't tell which beat a scene belonged to and rendered the wrong
> one). That bug had a shape: **a hand-maintained mirror of the tree/schema silently drifted from
> the source of truth, and the model acted on the stale view as if it were complete.** This audit
> went looking for more instances of that shape in `supabase/functions/book-agent/index.ts` (the
> live prompt) and `apps/web/src/features/dna/lib/dnaJourney.ts` (the guided-flow anchor it's fed).
>
> Findings are ranked by severity. "Confirmed" means I cross-checked against the generated
> `_shared/dna-schema.json` (the actual source of truth) or grepped the whole repo for callers.
> "Judgment call" means the field exists and is optional — flagging it for a deliberate decision,
> not asserting it's wrong.

---

## 1. `meter` is missing from two node-kind whitelists — the agent can never add one (CONFIRMED, HIGH) — ✅ FIXED

`supabase/functions/book-agent/index.ts:100,112`:

```ts
cast_world: ["pillar", "character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "voice_profile"],
...
const ALL_NODE_KINDS = ["seed", "premise", "pillar", "act", "beat", "scene", "character", "relationship", "tentpole", "world_fact", "location", "thread", "game", "voice_profile"];
```

Both lists are missing `"meter"`. `ALL_NODE_KINDS` gates every `add` and `replace_children` op in
`proposeNodeOps` (`index.ts:1234,1236`). Meanwhile:

- `novelDna.ts`'s canonical `ENTITY_KINDS` **does** include `"meter"`.
- `DIGEST_FIELDS` (`index.ts:1017-1033`) **does** include a `meter` entry.
- `SYSTEM_THREAD` itself tells the agent `meter` is a valid foundations kind (`index.ts:1193`:
  *"foundations — character, relationship, world_fact, location, thread, game, tentpole, **meter**,
  voice_profile"*).
- `get_schema`/`read_node` will happily hand back a full, valid schema for `meter` (it's generated
  from the real `NODE_SCHEMA`, which has it).

So the agent is told meters are a real, addable kind, and even reads a correct schema for one if it
asks — but the moment it calls `propose_node_ops` with `{op:"add", kind:"meter", ...}`, the op is
silently dropped by the `ALL_NODE_KINDS.includes(o.kind)` check, and (if it was the only op in the
call) the whole proposal is rejected with a generic `"No valid ops — reference real, non-locked
node ids."` — no hint that `"meter"` specifically is the problem. This is a real capability the
project shipped (project memory: *"DNA meters pillar... numeric plottable axes (comedy/heat/
game-score)... Phase 1 shipped"*) that the agent's write path silently can't reach.

**Fix:** add `"meter"` to both arrays. One-line, no design decision required — every other
signal in the file already agrees it belongs.

---

## 2. The picture-mode "Illustrate" objective names an action the agent has no tool for (CONFIRMED, HIGH) — ✅ FIXED (option b)

`dnaJourney.ts:153`:
```ts
illustrate: "Generate the scene illustration for the TARGET NODE named in the objective above — the next scene in reading order. Don't pick a different one from the tree.",
```

This text is injected into `threadSystem`'s objective block every turn once a picture-mode book
reaches the draft stage. But grepping `book-agent/index.ts` for `illustrat|image_url|picture`
returns **zero hits** — there is no `propose_illustration`/`generate_scene_image` tool in
`THREAD_DNA_TOOLS`. Illustration generation only exists client-side
(`composeSceneIllustration`/`renderSceneIllustration` in `dnaExpand.ts`), reachable today only from
Autopilot's own loop — a completely separate code path from the AgentRail tool loop.

So for any picture-mode book, once the guided flow reaches "draft," the agent is handed an
objective it is structurally unable to fulfill through any tool it has. Best case it says so and
stalls the guided flow; worst case it improvises — e.g. `propose_node_ops` editing
`content.image_url` to a fabricated string, which would write a fake image reference into the
tree.

`docs/agent-capabilities.md`'s "What it CANNOT do" list (7 items) doesn't mention this either — it
predates being noticed.

**Fix:** either (a) give the thread agent a real illustration tool that stages a reviewable
render request the same way `propose_prose_render` does, or (b) if that's out of scope for now,
change `STEP_RECIPE.illustrate` to a hand-off line (mirroring the "book fully drafted" hand-off in
`currentObjective`) telling the agent to point the author at the manual illustrate action instead
of attempting it — and add the limit to `agent-capabilities.md`.

**Done:** took option (b) — a real illustration-proposal tool (client apply path, review UI) is a
bigger feature than a prompt-audit fix should decide on its own. `STEP_RECIPE.illustrate` now tells
the agent it has no illustration tool, names the target scene for the author, and explicitly warns
against inventing an `image_url`. Added as limit #8 in `agent-capabilities.md`. The real tool (a)
remains a legitimate follow-up if picture-mode books are meant to be agent-drivable end to end.

---

## 3. `DIGEST_FIELDS` shows the least useful field (or none) for several kinds (CONFIRMED, HIGH) — ✅ FIXED (the 4 required-field misses; judgment calls left as-is)

Same class of bug as the tree-ordering issue: `DIGEST_FIELDS` (`index.ts:1017-1033`) is a **third**
hand-maintained mirror of the node schema — alongside `novelDna.ts`'s content interfaces and the
*generated* `_shared/dna-schema.json` (which `dnaSchema.artifact.test.ts` keeps in sync with the
real `NODE_SCHEMA`). Unlike that generated file, nothing checks `DIGEST_FIELDS` against the schema.
Cross-checking each entry against `dna-schema.json`'s `kinds[kind].fields`/`.required`:

| Kind | `DIGEST_FIELDS` shows | Schema's required field(s) | Problem |
|---|---|---|---|
| `tentpole` | `["title"]` | `summary` | **`title` isn't a field on tentpole at all** — schema is `{ summary }` only. Digest silently renders empty and falls back to `nodeHandle()`'s own field-guessing, which happens to find `summary` — so it's masked, not broken, but the config line is simply wrong. |
| `world_fact` | `["name", "category"]` | `name`, **`rule`** | Misses the **required**, load-bearing field. The node's own doc comment in `novelDna.ts` says `mechanism`/`rule` is "the OPERABLE rule... The climax's win must fire a mechanism" — literally the thing the causality/no-deus-ex-machina design leans on — yet the standing digest shows only `name` + `category`. |
| `voice_profile` | `["pov", "tense"]` | **`style`** | Misses the **required** field — the actual prose-signature text. The always-visible view of the book's voice contract never shows the voice description itself. |
| `game` | `["name"]` | **`win_condition`**, **`lose_condition`** | Shows literally nothing about what the contest *is*. A beat can reference a game via `plays`/`resolves`; the agent has no way to reason about whether a beat's turn should decide it without a `read_node` round-trip on every game, every time. |

None of these are "wrong" in the sense of crashing anything — `read_node`/`search_nodes` still
reach the real data. The risk is the same shape as the ordering bug: **the digest looks like a
complete-enough summary, so the agent may act on it as if it were**, e.g. proposing a beat that
`grounds_in` a world_fact whose `mechanism` it never actually read, or writing prose whose voice
drifts because `style` was never in view.

Lower-confidence / **judgment calls** (fields are optional per schema, so this may be deliberate
token-budget shaping rather than a bug):
- `thread: ["name", "kind", "promise"]` — has `promise` but not `payoff`; a thread's whole identity is the setup↔payoff pair.
- `location: ["name", "mood"]` — drops the sensory palette (`sight`/`sound`/`smell`/`texture`), which is the location node's entire stated purpose ("prose-gen reads the SAME harbor smell each time instead of re-inventing it").
- `pillar: ["controlling_idea"]` — drops `ending`.
- `character: ["name", "role", "tag"]` — drops `want`/`need`/`wound`/`lie`, the character's dramatic engine (though these are longer than the others and may be intentionally deferred to `read_node`, matching how `beat`/`scene` already drop their long-form fields on purpose).

**Fix:** add `rule` to `world_fact`, `style` to `voice_profile`, `win_condition`+`lose_condition` to
`game`, and correct `tentpole` to `["summary"]`. Then add a cheap unit test asserting every
`DIGEST_FIELDS[kind]` is a subset of `dnaSchema.kinds[kind].fields` (schema access already exists in
this file via `CONTENT_SCHEMAS`) — this is exactly the kind of drift `dnaSchema.artifact.test.ts`
already guards against for the *other* hand-maintained copy; `DIGEST_FIELDS` should get the same
guard rather than a fourth silent mirror.

**Done:** the four required-field entries fixed (`world_fact`, `voice_profile`, `game`, `tentpole`).
The sync test is now added too — `apps/web/src/features/dna/lib/bookAgentDigestFields.test.ts` reads
`book-agent/index.ts`'s `DIGEST_FIELDS` block as text (mirroring `dnaSchema.artifact.test.ts`'s
cross-boundary pattern, since the edge fn can't be imported into Vitest) and validates every entry
against `NODE_SCHEMA` directly (not the editSpecs-derived artifact `kinds[].fields`, which drops
`genOnly` causality fields DIGEST_FIELDS deliberately surfaces): every kind exists, every field is
real, and every REQUIRED field is shown. Two documented, narrow exceptions: `beat.summary` is
covered by `gistLine()` (a separate mechanism, not `DIGEST_FIELDS.beat`), and `scene`'s inherited
causality fields (`needs`/`establishes`/`grounds_in`) are read-only data `NODE_SCHEMA` doesn't
declare (that's the WRITE contract; these are mechanically copied from the parent beat, never
independently authored). Verified the test has teeth: reverted the `world_fact` fix locally, the
test failed as expected, then restored it. The judgment-call entries (`thread.payoff`,
`location`'s sensory fields, `pillar.ending`, character's
want/need/wound/lie) were left alone; they're optional fields and a legitimate token-budget call,
not fixed here.

---

## 4. Autonomous-mode instructions only name `propose_node_ops`, not `propose_prose_render` (CONFIRMED mechanism, MEDIUM) — ✅ FIXED

`index.ts:1377` (`autoLine`, the `AUTONOMOUS MODE` block injected when `context_auto` is on):

> "• Make ONE change per turn with **propose_node_ops**. It is APPLIED LIVE immediately..."
> "• Prefer to commit directly... write it with **propose_node_ops**. (Avoid propose_options in autonomous mode...)"

The bullet list never mentions `propose_prose_render`. But the *code* treats it identically to
`propose_node_ops` in auto mode: `index.ts:543-545` acks it as "applied" the same way, and
`useAutoAccept.ts`/`applyAgentProposal` (`agentThread.ts`) auto-apply **any** staged proposal
regardless of `layer` ("dna" or "prose-render"), then resume the run exactly the same way. So when
an autonomous thread reaches the draft stage, the model has to *infer* — from a tool it isn't told
behaves this way at all — that it should render one scene at a time the same way it commits one
node-op at a time, rather than, say, batching many scene ids into one call (which the tool
technically accepts) or treating prose-render as needing a different cadence than the instructions
describe.

**Fix:** add a bullet: *"propose_prose_render behaves the same way — it also applies live
(the scene renders in the author's browser) and your next turn sees it; render ONE scene per turn,
same as a node op."*

**Done:** `autoLine` now says *"Make ONE change per turn with propose_node_ops, OR render ONE scene
per turn with propose_prose_render. Both are APPLIED LIVE immediately..."*.

---

## 5. `nodeHandle` (edge fn) and `nodeLabel` (web) are hand-duplicated and have already drifted (CONFIRMED, LOW)

`index.ts:1005-1009`:
```ts
// A short human handle for a node (mirror of lib/dnaChat nodeLabel) for read summaries + step labels.
function nodeHandle(content) { ...; return h.trim().slice(0, 60) : "(untitled)"; }
```
vs. `apps/web/src/features/dna/lib/dnaChat.ts:50-56`'s `nodeLabel`, same logic, `.slice(0, 80)`.

The comment already admits it's a manual mirror — and it's already drifted (60 vs. 80 chars). Low
stakes (just a display-string truncation length), but it's a second, independent confirmation that
this codebase's "copy the logic into the edge fn because it can't import the web module" pattern
reliably drifts. Worth knowing about, not urgent to fix.

---

## 6. ~500 lines of dead prompt/tool code for a caller that no longer exists (CONFIRMED via repo-wide grep, MEDIUM — housekeeping, not a live-prompt bug) — ✅ DELETED

`book-agent/index.ts` still carries a second, complete agent definition: `SYSTEM` (`:979`), `TOOLS`
(`:910`, including `propose_revision_plan`/`read_page`), `buildContext`/`proposePlan`
(`:1385`/`:851`), and the whole `{bookId, evaluation}` / `{bookId, instruction, targetPageId}`
"start a run" branch. This is the pre-DNA-pivot **eval-run** agent (the file's own header comment:
*"formerly revise-agent... it was promoted from the eval-revision agent into the omni-rail"*).

Grepping the entire repo for every possible caller (`targetPageId`, the old function name
`revise-agent`, `PageReview`, and every `book-agent` reference) turns up exactly one live caller:
`apps/web/src/features/dna/lib/agentThread.ts`, which only ever sends `{bookId, message, ...}` (the
`kind='thread'` branch). Nothing in the web app constructs an `evaluation` or `instruction` body
anymore — that UI (the Build Studio PageReview prose chat) was deleted in the DNA substrate pivot.

This isn't a "prompt inaccuracy" the model sees — it's dead weight in the file a future reader has
to mentally filter past, and a real risk that someone debugging "the agent's system prompt" edits
`SYSTEM` (the dead one) instead of `SYSTEM_THREAD` (the live one) by mistake, the way I almost did
while auditing this file.

**Recommendation:** confirm with the team there's truly no remaining caller (e.g. an admin script
or a paused feature), then delete `SYSTEM`/`TOOLS`/`buildContext`/`proposePlan`/the eval-run branch
of `Deno.serve` and the `evaluation`/`instruction`/`targetPageId` body fields.

**Done:** before deleting, queried the linked project's `book_agent_runs` table directly
(`kind, status, count(*) group by`). Result: 11 `eval`/`done`, 2 `eval`/`error`, 1 `eval`/
`awaiting_input`, plus the live `thread` rows — **zero** `eval`-kind rows in `running`, so nothing
was mid-flight. The one orphaned `awaiting_input` eval row was already unreachable from any current
UI (confirmed by the repo-wide grep above); deleting the eval-run code doesn't change its
reachability, it just means answering it via a raw API call would now error instead of silently
working. Removed `SYSTEM`, the old `TOOLS` array (folded `ask_author`/`finish` into a shared
`SHARED_TOOLS` const — see #7), `buildContext`/`outlineContext`/`threadsContext`/`evalContext`,
`proposePlan`, the `propose_revision_plan` handling branch, the `read_page` tool + its handling in
`toolResults`, the "Start a run" eval branch of `Deno.serve`, and every now-dead type
(`EvalResult`/`EvalIssue`/`EvalSection`/`PageRow`/`ThreadLite`/`RevisionPlan`). Also collapsed every
`isThread` branch in `advance()` to its thread-only behavior (a row's `kind` will only ever be
`"thread"` going forward) and trimmed `evaluation` out of `RunRow`/`ROW_COLS` (an unused per-turn
column fetch). File went from 1459 → 1134 lines. `deno check`/`deno lint` show the same
pre-existing, unrelated `EdgeRuntime` ambient-type gap as before (22 vs. the prior 28 — fewer
`waitUntil` call sites, not new errors) and the same 5 pre-existing lint issues.

---

## 7. `finish` was never in the thread's declared tool list, though the prompt told the agent to call it (CONFIRMED, HIGH) — ✅ FIXED

Found while mapping the dead code for #6. `threadToolsFor()` (the function that builds the actual
`tools` array sent to the API for a thread run) returned:

```ts
function threadToolsFor(_scope) {
  return [TOOLS.find((t) => t.name === "ask_author")!, ...THREAD_DNA_TOOLS];
}
```

`THREAD_DNA_TOOLS` never included `finish` — it was only defined inside the old eval-only `TOOLS`
array (§6), and `threadToolsFor` only ever pulled `ask_author` out of it, not `finish`. Yet
`autoLine` (the AUTONOMOUS MODE text, injected on every autonomous turn) explicitly instructs:
*"ALWAYS CONCLUDE: once the request is fully handled, call finish with a one-line summary..."* — an
instruction to call a tool the agent was never given access to. Anthropic's tool-use API only lets
the model call tools present in the request's `tools` array, so this specific instruction was
**impossible to follow** for every thread turn that ever ran, autonomous or not.

It wasn't catastrophic — the "no tool call at all" fallback in `advance()` already treats a bare
text reply as a normal end-of-turn (`status: "idle"`) — so a thread doesn't hang. But it means
`finish`'s structured `report` field (meant to give a clean, extractable one-line summary,
surfaced as a `"done"` step) was never actually reachable; the agent could only ever end an
autonomous run by replying with plain text, which the code captures as a `"note"` step instead of
the more deliberate `"done"` step.

**Done:** `threadToolsFor()` now returns `[...SHARED_TOOLS, ...THREAD_DNA_TOOLS]`, where
`SHARED_TOOLS` is `[ask_author, finish]` — both genuinely reusable, kind-agnostic control tools.
`finish` is a real, callable tool for every thread turn now, matching what the prompt has always
told the agent to do.

---

## Summary table

| # | Finding | Confidence | Severity | Status |
|---|---|---|---|---|
| 1 | `meter` missing from `ALL_NODE_KINDS`/`cast_world` — agent can never add one | Confirmed | High | ✅ Fixed |
| 2 | "Illustrate" objective has no corresponding tool | Confirmed | High | ✅ Fixed (hand-off text; real tool is a bigger follow-up) |
| 3 | `DIGEST_FIELDS` misses required fields (`world_fact.rule`, `voice_profile.style`, `game.win/lose_condition`) + wrong field (`tentpole.title`) | Confirmed | High | ✅ Fixed + sync test added |
| 4 | Autonomous-mode text doesn't mention `propose_prose_render`'s auto-apply behavior | Confirmed mechanism | Medium | ✅ Fixed |
| 5 | `nodeHandle`/`nodeLabel` duplicated, already drifted (60 vs 80 chars) | Confirmed | Low | Left as-is (not urgent) |
| 6 | ~500 lines of dead eval-run agent code (SYSTEM/TOOLS/buildContext) | Confirmed (repo-wide grep + live DB check) | Medium (housekeeping) | ✅ Deleted |
| 7 | `finish` tool never declared for the thread, though the prompt instructs calling it | Confirmed | High | ✅ Fixed (found while doing #6) |

**Still open:** the real illustration tool (§2, option a) — a deliberately bigger follow-up, not
done in this pass. Everything else confirmed-and-high-value is fixed, including the §3 sync test.
