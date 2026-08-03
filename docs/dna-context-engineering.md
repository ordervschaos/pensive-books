# Context engineering in the DNA studio

**The one-line thesis:** a book is far larger than any context window, so every AI call in this
system is a *curation decision* — what to put in front of the model for THIS call — and the
codebase treats that curation as a first-class, testable artifact rather than string concatenation.

This doc is the map of those decisions: which surfaces exist, what each one puts in the window,
why, and where the code lives. Two audiences:

- **the agent** (`book-agent`) — a long-lived tool loop whose context is a *conversation* that
  accumulates and must be pruned;
- **the subagents / generators** (`dna-expand` prose render, the continuity digest fold, the
  judges) — one-shot calls whose context is *assembled fresh* every time and never accumulates.

Those two shapes need opposite disciplines, and most of the interesting engineering in this repo
lives at that split.

---

## 0. The frame

```
POSSIBLE CONTEXT                        CURATION                 CONTEXT WINDOW
┌───────────────────────────┐                                ┌──────────────────────────┐
│ the whole book_nodes tree │                                │ system prompt  (stable)  │
│ every scene's prose       │                                │ ── cache breakpoint ──   │
│ 14 craft playbooks        │  ──►  digest · scope · trigger  │ transcript (compacted)   │
│ brief · vision · mandate  │       hydrate · fold · evict    │ ── cache breakpoint ──   │
│ lints · ledger · meters   │                                │ <book_state> (volatile)  │
│ the transcript so far     │                                │ <task> (the ask, LAST)   │
│ 17 tools                  │                                └──────────────────────────┘
└───────────────────────────┘
```

Everything below is a name for one arrow in the middle column.

**Vocabulary this doc uses** (architectural terms, so you can name these moves elsewhere):
*context window*, *prompt-cache prefix discipline*, *progressive disclosure*, *just-in-time
retrieval / intent hydration*, *digest (lossy projection)*, *fold / prefix-sum accumulator*,
*scoping vs fencing (anchors, not fences)*, *context compaction / eviction*, *salience inversion*,
*capability boundary vs scope boundary*, *degradation rule*, *twin / parity lock*.

---

## 1. The agent's window (`book-agent`)

Code: `supabase/functions/book-agent/context.ts` (`threadSystem`) + `transcript.ts`.

### 1.1 The two-part split — the single most load-bearing decision

`threadSystem` returns **two** strings, never one:

| part | contents | position | cache |
|---|---|---|---|
| `instructions` | `SYSTEM_THREAD` + effort/auto/variant suffixes | system, position 0 | **cached prefix** — byte-stable across every turn of a run |
| `bookState` | tree digest, objective, lints, ledger, focus, skills | appended as the **last block of the latest user message** | paid uncached, every turn |

Why: in auto mode the tree changes after *every* apply. Carrying the tree at position 0 invalidated
the entire cached prefix (system + whole transcript) on every single turn. Moving the volatile part
to the tail means each chain link re-reads the whole prefix from cache and pays only for the newest
turn.

`bookState` is **never persisted** into the stored transcript. Consequence: exactly one
`<book_state>` exists in the window at any time — the model physically cannot ground on a stale
tree from three turns ago.

```
turn N     [ SYSTEM (cached) ][ transcript … (cached) ][ user msg + <book_state> + <task> ]
                                                          └── the only thing you pay for ──┘
```

### 1.2 The tree digest — lossy by design

The whole tree ships every turn. Dumping full node content is the bulk of the tokens, so each node
becomes a **digest line**: handle/gist + its *causal + meter spine*.

`DIGEST_FIELDS` (context.ts:21) picks per kind — e.g. a beat shows
`connector · polarity · slot · needs · establishes · threads · grounds_in · realizes · plays ·
resolves · readings`, plus the first sentence (≤180 chars) of its summary. A scene shows
`goal · value_shift · pov · loc · needs · establishes · sketch` plus a `prose: "1,240w"` /
`undrafted` marker.

Three deliberate properties:

1. **Absent fields are dropped, not nulled** (`pickFields`). A beat with no `connector` reads as
   *floating* — visibly missing — instead of hiding inside a full dump.
2. **Full content is one `read_node` away.** The digest is an index, not the document.
3. **Reading-order numbers ride along** (`beat 3/41`, `scene 14/80`), computed over the same
   DFS-by-position walk the tree UI and the renderer use. This is a *shared-denotation* fix: the
   agent once called scene 14 "scene 17" because it inferred a number from the objective's target
   pointer. Numbers must mean the same thing to the agent, the UI, and the book.

The walk itself is depth-first by position, not a flat sort by level — a flat sort interleaves every
act's beats and scenes with no parent linkage, and the agent had no way to tell which beat a scene
belonged to.

### 1.3 Empty slots: three consumers, three treatments

The tree is going **dense** — every template slot exists as a real row with `content: {}`. That
turns absence from a *shape* (no row) into a *value* (a row that says nothing), and absence-as-value
fails open. `_shared/dna-context.ts` encodes the resolution, and it differs per consumer:

| consumer | treatment | why |
|---|---|---|
| entity registries (cast, threads, world, locations) | **omitted** | a nameless row is strictly worse than no row for a by-NAME lookup |
| ladder sequences (THE ARC) | **kept + explicitly MARKED** | position is information; drop empty acts and a three-act book reads as one act |
| the agent's tree digest | **kept + COLLAPSED** | placeholders are its *work queue*; it fills a slot by targeting that id |
| the reader-facing renderer | never sees them | nobody reads "Chapter 4: yet to be filled" |

Collapsing (`treeDigestLines`) drops descendants of an empty node and folds consecutive empty
same-kind siblings into one line with every id intact. Numbering stays computed over the *full*
list — "beat 7" must not silently renumber when beats 4–6 are blank.

Then `hungerBlock` states the same emptiness **once, in its own channel**: `STILL UNWRITTEN (3 acts
· 12 beats · 40 scenes)`. This is the subtle one — the danger was never that a model *sees*
emptiness, it's that it *misreads* emptiness as a settled fact. Inline among content, `- [?] {}`
asserts "this character has no want" and doubles as a bad format exemplar that lowers fill rate on
the filled nodes too. In its own named block, the same fact reads as an invitation, and stops
generators from wrapping the book up early.

### 1.4 Just-in-time hydration — two channels

The digest is thin on purpose, so two mechanisms inline **full** content for the nodes that matter
*this turn*:

- **`<focus>` — the context tray.** Nodes the author `@`-attached. Full content inlined; prose only
  carried for scenes (it's the bulk of the tokens and no other kind has any). Rebuilt from the live
  tree every turn, so it can never go stale the way the old glued-to-the-message "Focus —" prefix did.
- **`<mentioned>` — intent hydration.** Nodes the author's *latest message* names — by reading-order
  number (`scene 14`), by verbatim id (`n_abc123`), or by an entity's name. Deterministic regex over
  the same DFS numbering, capped at **4 nodes**.

A mentioned node arrives **edit-ready** — the three things every node edit needs:

```
[n_x9f2] scene 14/80 "The auction"          ← identity + shared number
path: pillar › act "Descent" › beat "…" › scene    ← POSITION: ancestors are fixed
  · children: 0                                     ← what an edit here STALES
{ "goal": …, "value_shift": … }                     ← CONTENT
prose (1,240w): …                                   ← the text, if it's a scene
+ schemaFor(["scene"])                              ← the kind's exact field names
```

Scene prose inlines up to `PROSE_INLINE_CAP` = 7,200 chars; longer prose keeps **head + tail** with
the middle elided — the two edges a continuity or wording ask actually reasons over. The payoff is
concrete: it collapses a `read_node` round-trip, and a round-trip here is a whole self-chain link
(row write + cold reinvoke + full prefill) before the agent can even start answering.

### 1.5 Conditional blocks — context that knows when to shut up

Not everything ships every turn. Three examples of *injection policy* being the actual engineering:

**`<current_objective>` — three-state.** The guided-flow anchor used to ride every turn, so a
concrete typed ask ("render scene 14") arrived next to a standing "do the next rung instead"
instruction. Now it's injected only when `auto || followObjective || !authorAsk || inInterview`.
A concrete ask omits it entirely. The interview rung is a deliberate exception: there are no typed
asks there — the author is just talking — and without the objective the agent improvised the whole
interview and never found its finish.

**`<story_analysis>` — mood-dependent framing.** The same lint text ships with a different `note`
attribute depending on mode: in auto it's *"the structural backstop — address any ⚠ flags"*; in
interactive it's *"for REFERENCE — act on a ⚠ only when the author asks"*. A per-turn imperative
made the agent fix lints when the author asked for something else entirely. Thresholds are
genre-tuned from the brief via `lintConfigForBrief`.

**`<skill_briefs>` — progressive disclosure.** Fourteen craft playbooks (`_shared/agent-skills.ts`)
reach the model through three channels: a one-line index always in the system prompt; deterministic
regex-triggered injection of the matching body; and a `read_skill` tool for when triggers miss.
Ask-matches win outright over objective-matches, so a concrete ask can't drag in the playbook for a
rung it's steering away from. And a state override: while `discovering`, the `vision-interview`
skill is pinned and ask-triggered skills are *suppressed* — a mid-interview answer ("my protagonist
is a lighthouse keeper") is a concrete message whose story nouns otherwise trip character-craft's
node-editing playbook mid-interview.

The rule for what lives where: **invariants stay in `SYSTEM_THREAD`** (never full-prose-via-edit,
never touch LOCKED, the ask wins) — a missed trigger must never cost safety. Only *technique* moves
into skills. Op semantics stay in the tool descriptions.

### 1.6 XML tags and the query-last rule

Every distinct kind of context gets its own tag — `<brief>`, `<craft_notes>`, `<craft_overrides>`,
`<current_objective>`, `<story_analysis>`, `<between_scenes>`, `<focus>`, `<mentioned>`,
`<skill_briefs>`, `<dna_tree>`, `<unwritten>` — each with a `note` attribute stating *how to use it*,
not just what it is. Tags disambiguate where one section ends and the next begins when a prompt mixes
instructions, reference, and a large structured document.

Then, critically, the author's ask is **restated after** the whole state dump:

```
<book_state> … 40k tokens of tree, lints, ledger … </book_state>
<task note="the author's CURRENT ask — THIS is your job this turn;
            everything in <book_state> above is reference, not instruction">
render scene 14
</task>
```

Without it, the last thing the model reads before replying is the tree and the lints — the
**salience inversion** behind "asked to render a scene, went and fixed lints." The query belongs
after the documents.

### 1.7 Eviction — compaction, breakpoints, and a forced commit

A long run accumulates every `read_node` result. Measured on book 1229: 14 full scene reads ≈ 200k
chars ≈ 50k tokens re-sent on every subsequent call; past ~60k tokens most calls blew the 140s
timeout and the loop crawled at one successful turn per ~4 attempts.

`compactTranscript` (transcript.ts:25): once the transcript JSON exceeds **120k chars**, stub every
tool_result body over **700 chars** *except* those in the **newest bulky message**. Blocks are
replaced, never removed, so `tool_use ↔ tool_result` pairing survives. Two bugs shaped that rule:

- v1 keyed on a trailing-message *count* — but batched turns pack a whole read sweep into ONE huge
  message, so a count of 6 protected the entire 7-message transcript.
- v2 keyed on "newest tool message" — but the post-apply `✓ Applied` ack is itself a tiny
  tool_result, so protection flipped to the ack right after every apply and pruned the read sweep
  the model still needed. It re-read everything, fixed one thing, lost it again.

Hence: only a message actually *carrying* big results claims protection.

Compaction alone wasn't enough. A lint with hits across a dozen scenes made the agent try to build a
complete inventory before proposing anything — but compaction prunes earlier reads before they're
used, so it re-reads forever (one run: 125 steps, 15 turns, **0 applies**). Prompt guidance cut the
rate but didn't stop it. The backstop is mechanical: **`FORCE_COMMIT_AFTER_READS = 15`** trailing
read steps injects a force-commit prod.

Cache breakpoints (`withCacheBreakpoints`) are applied at request time and never stored — the API
allows 4, and stored ones accumulate. One on the big first user message, one on the last block of
the latest message.

### 1.8 Anchors, not fences

`docs/agent-context-model.md` is the governing decision: the agent has **one** context mechanism —
attached nodes as *seeds*. There is no scope filter. The whole tree is always visible and every
non-LOCKED node is editable; attachments bias where the agent looks first. The Apply/Discard review
gate is the real safety, not scope.

The one intrinsic limit is a **capability boundary, not a scope boundary**: the agent never
generates full prose, because v2 prose is browser-orchestrated streaming and a server-side tool loop
physically can't drive it. So it *requests* a render (`propose_prose_render`); the client executes.

---

## 2. The subagents' windows

One-shot calls. Nothing accumulates, so nothing needs evicting — the entire discipline is
*assembly*.

**One-shot ≠ context-free.** Stateless is a claim about accumulation, not payload. Almost every
block below is re-derived from `book_nodes` at call time — blackboard, not handoff. The exception is
the **editor's brief** (`RenderBrief { focus, mustHonor[], avoid[] }`), the one channel carrying the
agent's chat-only knowledge (the author's ask this turn + what the agent retrieved via
`read_node`/`search_nodes`) across the boundary:

- authored by the agent via `propose_prose_render` / `propose_expansion` (`book-agent/tools.ts:95`);
- **serialized** onto the proposal (`agentThread.ts:59`), so it survives the Apply gate and the hop
  to the browser — the agent's turn is over by the time the render runs;
- **additive, never substitutive** — `dna-expand/index.ts:618` injects it *on top of* the computed
  context and ranks it below MANDATE and LOCKED;
- **sanitized at the trust boundary** — `sanitizeBrief` trims, caps `focus` at 400 chars, slices
  lists to 12;
- **any target may carry one** — a sketch or beat-sheet expansion is steerable the same way.

Known cost: the author's message reaches the render *only* as the agent's distillation. A lossy
compression channel with a model in the middle, undetectable downstream when under-curated — hence
the brief being visible in `ProposalCard` before Apply.

### 2.1 Prose render (`dna-expand`, target `prose`)

The context array (`index.ts:643`), in order:

```
BOOK name
BRIEF (binding)                    briefContext(brief, {scope:'full', vision:true})
MANDATE — NON-NEGOTIABLE           mandateContext(brief)  ← the binding half, verbatim
VOICE PROFILE                      pov · tense · style · constraints · reference sample
STORY SO FAR                       the ancestor chain, LOCKED items marked immutable
  ── render targets get a SCOPED bible; planning targets get the WHOLE arc ──
proseScope                         cast/threads/rules THIS scene references
BEAT PLAN                          sibling beats of the parent act
ENTRY STATE                        ledgerText — open promises + where each character last was
SETTING                            the resolved location's persistent sensory palette
DISCLOSURE BUDGET                  per-facet: fresh / vary in new words / saturated, drop
THIS SCENE'S REGISTER              how the one voice bends for this scene only
THE SCENE'S SKETCH                 accepted treatment: opening · moves · exit · direction
THE EDITOR'S BRIEF FOR THIS PAGE   the agent's curated focus/mustHonor/avoid, verbatim
SEAM WITH THE PREVIOUS SCENE       the previous scene's actual last paragraphs + how to join
PRECEDING CONTEXT (digest v2)      §2.2
STILL UNWRITTEN                    hungerBlock — don't wrap the book up early
THIS NODE [scene]                  the plan being rendered
```

**Scoping is the headline move.** A render target gets a *scoped* bible, not the whole book. A scene
renders one moment; it doesn't schedule threads across the arc. So instead of broadcasting every
character, location, thread and rule — which costs tokens *and* dilutes signal with cast that isn't
in the room — `proseScope` anchors on what this scene's plan and its parent beat actually reference:

- cast = leads (always, as insurance) ∪ characters name-matched in the scene/beat content;
- threads = only those the parent beat carries (`beat.threads[].ref`);
- world rules = only those the beat `grounds_in`.

Planning targets get the opposite treatment — breadth *is* their job, so they receive the full
registries plus `THE ARC`.

**The degradation rule** appears again and again here: every optional block computes to `""` when
its inputs are absent, and `.filter(Boolean)` drops it. No exposure data → no disclosure budget →
today's behaviour unchanged. New context is always additive and never breaks the old path.

**Two blocks worth naming individually:**

*The disclosure budget* (`docs/scene-ledger.md` §2.4) turns "describe the setting" into a budget:
for each entity in this scene, which facets are already rendered, how many times, and the last
phrasing used. Saturated facets get *"do NOT restate; an oblique echo at most"*. Anything not listed
is unrendered — "this is your chance to establish it."

*The seam* carries the previous scene's **actual last two paragraphs** (or its planned `sketch.exit`
if undrafted) plus an explicit instruction for how to join. It's cheap — no model call — so it rides
even the `light` path, and it's kept deliberately *distinct* from the digest's voice block: the old
fused block conflated "continue from here" with "sound like this," and prose kept re-telling the
previous page.

### 2.2 The continuity digest — a fold, not a summary

Pasting the last N pages verbatim doesn't scale and, measured in
`scripts/prose-context-experiment.mjs`, verbatim previous-page is the single biggest source of
repetition. So prior prose enters as a **rolling fold**:

```
page 1 ──fold──► accum₁ ──fold──► accum₂ ──fold──► … ──► PRECEDING CONTEXT
         ▲                 ▲
    cached on         each fold sees ONLY (cumulative state + this one page),
 node.authoring        never the whole book — so cost is O(1) per page
   .prose_digest
```

Each link stores its **delta** (`line` = this page's recap; `ledger`/`impressions` = the cumulative
snapshot) keyed by `src_hash` (this page's prose) and `prev_hash` (the accumulator it folded onto).
Editing any earlier page breaks the chain from that point forward and only the suffix re-folds.
`DIGEST_VERSION` invalidates the whole chain when the shape or model changes — a digest built by a
weaker model is not trusted. The fold runs on `DIGEST_MODEL` (a reasoning model), deliberately *not*
the cheap tier: this is read-comprehension that downstream prose treats as authoritative, so a weak
model's misreadings poison every later page. There's a fold budget; hitting it returns a **partial**
digest covering the prefix folded so far, and each link persists immediately (an earlier
persist-at-end lost everything on worker death, so the cache never warmed).

Result: ~B-quality continuity at roughly ⅓ the tokens of the all-pages baseline. The digest ships as
three channels — `<continuity_ledger>` (cumulative grounded state), impressions (what *resonates*, a
weighted reader-memory list, not every fact), and an **anti-repeat blocklist** of distinctive phrases
the render must not reuse — plus one `<previous_page>` block explicitly labelled *voice + cadence
reference only*.

Ledger entries are **grounded**: each carries a `ref` to the DNA node id it concerns, sanitized
against the entity registry, so the fold resolves epithets and pronouns to a real character instead
of minting a parallel one.

### 2.3 The worker ceiling — a context constraint disguised as infra

Supabase's free-plan worker dies at ~150s, which was killing ~54% of prose calls. The fix splits the
call at the context boundary:

```
browser ──► dna-expand { prepare:true } ──► assembles the ENTIRE context, returns the
                                             model request WITHOUT calling the model  (fast)
        ──► /api/stream-prose (Vercel) ────► streams the 80–140s generation off-worker
```

The context assembly — the expensive, DB-bound, twin-tested part — stays server-side; only the long
generation leaves. The beat sheet uses the same shape with a third `finalize` hop so sanitize / lint
/ repair-decision logic also stays server-side.

### 2.4 The agent → subagent handoff

The agent can't write prose, but it *can* curate the prose call's context. `propose_prose_render`
carries a `brief` — `{ focus, mustHonor, avoid }` — injected **verbatim** as *"THE EDITOR'S BRIEF FOR
THIS PAGE"* and framed as highest-priority guidance that **augments** the deterministic context and
does not override the MANDATE or LOCKED facts.

That's the whole architectural claim in miniature: deterministic context is the floor (computed,
testable, always present), and the agent's judgment is a **layer on top**, never a replacement.

```
       agent (has taste, has read the book)
            │  brief: focus / mustHonor / avoid
            ▼
   ┌─────────────────────────────────────────┐
   │ deterministic floor: mandate · voice ·  │  ← computed, twin-tested, never skippable
   │ ledger · seam · disclosure · digest     │
   └─────────────────────────────────────────┘
            ▼
       prose model (streams off-worker)
            ▼
       verify: plan-conformance judge → read-repair
```

### 2.5 Verify — context for judging

`book-agent/verify.ts` builds a **plan slice** per scene: its DNA edges with thread ids resolved to
names and promises, so the judge reads *the promise*, not a hash. One scoping fix matters as a
context lesson: a payoff is paid once, but beats sometimes mint identical thread refs onto every
child scene. Judging all of them fails the ones that don't deliver it, and the agent learns to
dismiss verify — **alarm fatigue**. So payoff judgment is scoped to the last scene in reading order
that still carries a given ref.

---

## 3. Cross-cutting principles

1. **Curate at write time, not read time.** The tree digest, the ledger, the disclosure budget and
   the fold are all *precomputed projections*. The model never spends turns assembling its own view.
2. **Anchors, not fences.** Almost every block says "honor what's relevant; this is not a fence."
   Scoping shapes attention; the review gate provides safety.
3. **Absence needs a channel.** Omitted content must be announced (`hungerBlock`), or omission reads
   as completion.
4. **The query goes last.** Reference first, ask last, or the reference becomes the ask.
5. **Cache prefix discipline.** Byte-stable at position 0; volatile at the tail. Anything that
   changes per turn must never sit early.
6. **Every optional block degrades to `""`.** Additive context can never break the existing path.
7. **Deterministic assembly.** Regex triggers, hashes, DFS numbering — nothing random. A retried
   chain link re-derives a byte-identical prompt, which is what makes resume safe.
8. **Twins are parity-locked.** Context renderers shared between edge functions and the web client
   (`novelDna.ts`, `dna-context.ts`) have tests demanding byte-identical output — a second copy is
   the drift this repo keeps paying for.

---

## 4. Adding a new context block

The checklist the existing blocks were built against:

1. **Which consumer?** Agent digest / planning generator / render generator / judge / renderer.
   They get different treatments — see §1.3.
2. **Digest or full?** Default to a digest line + a tool to fetch the rest. Inline full content only
   for nodes this call is *about* (focus / mentioned).
3. **Where does it sit?** Volatile → the tail of the latest user message. Stable → the system
   prompt. Never the reverse.
4. **Own XML tag + a `note` saying how to use it.** "Honor this" vs "for reference" is often the
   entire behavioural difference.
5. **Does it compete with the ask?** If it could pull the turn off-task, gate its injection (see
   the three-state objective).
6. **Empty case.** Compute to `""`, and add a hunger-style channel if the omission could read as
   completion.
7. **Deterministic?** If it depends on time or randomness, resume breaks.
8. **Test it.** If it renders content shared across twins, add a parity/golden test
   (`dnaContext.golden.test.ts`, `novelDna.parity.test.ts`).

---

## Reference

| Concern | File |
|---|---|
| Agent prompt assembly | `supabase/functions/book-agent/context.ts` |
| System prompt (byte-stable) | `supabase/functions/book-agent/prompts.ts` |
| Compaction, cache breakpoints, `<task>` | `supabase/functions/book-agent/transcript.ts` |
| Skill playbooks + triggers | `supabase/functions/_shared/agent-skills.ts` |
| Bible blocks, hunger, tree digest | `supabase/functions/_shared/dna-context.ts` |
| Prose/planning context assembly | `supabase/functions/dna-expand/index.ts` |
| Ledger, lints, fill state (twin) | `supabase/functions/_shared/novel-dna.ts` |
| Brief vs mandate split | `supabase/functions/_shared/brief.ts` |
| Plan-conformance judge | `supabase/functions/book-agent/verify.ts` |

Related docs: [agent-context-model.md](agent-context-model.md) · [agent-rail.md](agent-rail.md) ·
[scene-ledger.md](scene-ledger.md) · [agent-capabilities.md](agent-capabilities.md) ·
[agent-guidance-system.md](agent-guidance-system.md) · [ai-calls-context-map.md](ai-calls-context-map.md) ·
[dna/00-pipeline-overview.md](dna/00-pipeline-overview.md)
