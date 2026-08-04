# Agent focus — declaring what we're working on

Status: **Slice 1 SHIPPED** (2026-08-03) — migration pushed, `book-agent` deployed, 15 edge + 2 web
tests green. Slices 2–3 not started. Design ratified in conversation; this doc is the spec.

Slice 1 landed as: `_shared/agent-focus.ts` (registry + `resolveFocus`/`focusBlock`/`focusSkills`),
`agent-focus.test.ts` (the degradation + anchor-not-fence locks), migration
`20260803190000_agent_focus.sql`, the `setFocus` branch in `book-agent/index.ts`, focus resolution +
`<focus>`→`<pinned>` rename in `context.ts`, the self-clear in `advance.ts`, and the rail's
`FocusChip` fed by the `agentFocusModes.json` mirror.
Builds on [agent-context-model.md](agent-context-model.md) (anchors, not fences) and
[agent-guidance-system.md](agent-guidance-system.md) (the three-state objective rule).

---

## 1. Thesis

**The agent already has a mode. It is derived, invisible, and unoverridable.** This work promotes it
to an explicit, declarable, visible one.

Three pieces of live code prove the mode exists today:

- `_shared/dna-journey.ts` computes `DNA_STAGES` (premise → foundations → structure → scenes → draft)
  and `stageSubsteps()` with per-substep `done` / `ready` predicates. The stage machine is already
  built, already a twin, already tested.
- `book-agent/context.ts` already branches on it: the `discovering` predicate pins the
  `vision-interview` skill and **suppresses ask-triggered skills**; `inInterview` forces objective
  injection; `injectObjective` is a three-state rule. That is mode-conditional context assembly,
  written as scattered ad-hoc predicates rather than one named concept.
- `book-agent/tools.ts` — `threadToolsFor()` takes **no arguments** and returns a constant. The seam
  for parameterization is already cut.

So the work is not "add modes to an agent that has none." It is: **replace five implicit predicates
with one declared, visible, author-overridable object.**

The HCI name for the risk being addressed is a **mode error** — acting under a wrong belief about
which mode the system is in. The two classic antidotes are *make the mode visible* and *make exiting
cheap*. Today the system has the worst configuration: it is modal, but the mode is invisible and
cannot be exited.

---

## 2. The invariants (read this before changing anything here)

Focus could in principle control four things. They get four different verdicts, and the first two are
**permanent invariants**, not preferences:

| # | axis | narrowing it is | verdict |
|---|---|---|---|
| 1 | **Visibility** — what the agent can SEE | a scope fence | **NEVER.** This is exactly what `agent-context-model.md` deleted. |
| 2 | **Write permission** — what it may CHANGE | a permission fence | **NEVER.** Locks are the only immutability; the review gate is the safety. |
| 3 | **Affordance** — which tools/skills are OFFERED | *relevance*, not a fence | Allowed, under the conditions in §6. |
| 4 | **Salience** — which ambient blocks are injected, and scoped how | curation | Allowed — and the highest-value part. |

> **The reachability test.** Curation is anchoring **iff the omitted thing is still reachable.**
> The tree digest passes (`read_node` reaches the rest). Scoped lints pass (a focus switch or a lints
> tool reaches the rest). A write-fence fails — nothing the model can say reaches past it.
>
> **Corollary (build requirement):** anything focus hides MUST have a named way to get it back, and
> the prompt must say what that way is.

> **Invariant.** A narrowing the agent cannot *name* and cannot *escape* is a fence, regardless of
> what this document calls it.

The gravity toward axes 1–2 is real — it is how the deleted design got built the first time. These
invariants are restated in the header comment of `_shared/agent-focus.ts` so they are enforced where
the code is, not only here.

---

## 3. The shape: three slots, not two

```
   mode          target              pinned[]
   ────          ──────              ────────
   the VERB      the DIRECT OBJECT   the MATERIAL kept in view
   "draft"       "scene 14"          "Mara's profile, the smuggling thread"
```

- **`mode`** — a named goal. Drives skills, ambient lens, tool menu, opening framing.
- **`target`** — **0 or 1** node: what the mode operates *on*. Owned by the mode; what `done()` reads.
- **`pinned[]`** — 0..n nodes the author wants kept in view. **Already exists** as the context tray
  (`context_attached_ids` → the `<pinned>` block). Owned by the author.

### Why not one flat `subjectIds[]`

Mode `draft-scene` on scene 14, and the author *also* pins Mara because her voice keeps drifting.
Flatten them and:

- `done(subjectIds[0])` becomes **order-dependent** — detach and re-attach Mara and the completion
  predicate points at a character node;
- the UI cannot tell which chip is "being written" from which is "reference";
- clearing the mode must decide whether Mara goes too, and both answers are wrong.

The target is the object of the verb. The pins are adverbial. Different slots.

### They cannot conflict

> **Mode answers "what am I doing?" The tray answers "what should I be looking at?"**

Two things can only conflict if they answer the same question. These never do — so there is no
arbitration logic to build.

### Different owners → different lifetimes

| | `target` | `pinned[]` |
|---|---|---|
| set by | the mode (usually implied by *how* you entered — "draft this scene" on a tree row sets both at once) | the author, explicitly |
| cardinality | 0 or 1 (mode-declared: `required` \| `optional` \| `none`) | 0..n |
| cleared when | the mode clears | never automatically |
| survives a mode switch | no | **yes** |
| read by `done()` | yes | no |

### What each drives

Orthogonal in the policy layer; additive in exactly one place.

| | `mode` | `target` | `pinned[]` |
|---|---|---|---|
| tools offered | ✅ | — | — |
| skills injected | ✅ | — | — |
| ambient **lens** (which lint families) | ✅ | — | — |
| ambient **scope** (whose lints) | — | ✅ | ✅ **additive** |
| hydration into the prompt | — | ✅ edit-ready | ✅ content |
| `done()` | ✅ declares | ✅ subject of | — |

**Ambient scope is `target ∪ pinned`.** Pinning a node means "keep an eye on this," so its lints
belong in view even when the mode targets something else.

### Hydration depth: `target ≥ mentioned > pinned`

The target is the thing being *changed*, so it deserves the edit-ready treatment `<mentioned>`
already produces (path + child counts + schema + prose), not the thinner treatment the tray gets.

Today's code hydrates *message-mentioned* nodes more richly than *author-attached* ones — an
asymmetry that reads backwards, since attaching is the more deliberate signal. Introducing `target`
is the moment to fix it.

### Naming

Two things were heading for the name "focus". Resolved:

- **"Focus"** = the mode/task → `<focus_mode>` + `<target>`.
- **"Pinned"** = the tray → the tag `<focus>` is renamed `<pinned>`; the column stays
  `context_attached_ids`.

The rename is a **prompt byte change**, so it ships behind the `variants.ts` A/B seam rather than
blind.

---

## 4. Storage

Follows the established `context_*` flat-column convention on `book_agent_runs` (no jsonb blob — the
existing columns are all flat scalars, and jsonb invites merge hazards):

| column | meaning |
|---|---|
| `context_focus_mode text` | the declared mode key. **NULL ⇒ derived/wide** |
| `context_focus_target text` | the target node id, or NULL |
| `context_focus_at timestamptz` | when the author declared it — powers the stale-focus resume confirm (§6) |

**`setBy` needs no column.** A stored value is by definition author-declared; NULL means "no
declaration — use the derived stage." That is the *derived proposes, author disposes* rule expressed
as a nullable column.

`pinned[]` is deliberately **not** in this group: `context_attached_ids` already exists, is
author-owned, and outlives any single mode. Merging them would tie the tray's lifetime to the mode's.

---

## 5. The registry — policy-as-data

`_shared/agent-focus.ts`, matching the idiom of `agent-skills.ts`, `craft-kb.ts`, and the structure
templates. Everything a mode controls is declared in one literal; a new mode is one entry.

```ts
{
  key: "draft-scene",
  label: "Drafting a scene",
  blurb: "Sketch, render, and read back one scene.",
  target: "required",                       // "required" | "optional" | "none"
  stage: "draft",                           // the journey stage this mode belongs to (derivation)
  skills: ["render-brief", "scene-plan-craft", "prose-patch"],
  ambient: { objective: false, lints: "scoped", betweenScenes: true, hunger: false },
  done: (nodes, target) => sceneHasProse(nodes, target),
  exitHint: "Ask about anything else and I'll offer to widen the focus.",
}
```

The modes: `wide` · `interview` · `logline` · `foundations` · `structure` · `scenes` · `draft-scene`
· `consistency-audit`.

`consistency-audit` is the entry that proves the design: it needs the **whole book visible** —
scoping its territory would break it outright. What it narrows is only its tool menu and its ambient
lens. Same conclusion as every other mode: narrow the menu and the salience, never the territory.

---

## 6. Exit — the condition on which focus is allowed to exist

An exit affordance is not a convenience on top of focus; without it, tool narrowing (§7 slice 3)
degrades from an affordance back into the deleted fence.

**The reframe:** because the ask always wins, focus never *blocks* anything. Exiting does not mean
"regain access" — it means **stop biasing the defaults**. So exiting is always safe, never urgent,
never destructive, and the system must never force an exit to get work done.

### Five exits, not one

| exit | trigger | state |
|---|---|---|
| **Complete** | `done()` fires | auto-clears; shows "✓ interview complete → next: logline" |
| **Abandon** | author clicks ✕ | → `wide`; the pinned tray **survives**; journal it |
| **Switch** | author picks another mode | a transition; old mode's `done()` evaluated and recorded first |
| **One-turn bypass** | an off-focus ask | **nothing happens** — the ask wins, focus persists |
| **Drift** | N consecutive off-focus asks | *suggest* a switch; never auto-switch |

Row four is what most designs get wrong. A focus that clears itself the moment you ask one tangential
question is worse than no focus — you would spend the session re-setting it. **One off-focus ask is
not evidence of a mode change; a pattern is.**

### Three actors can exit — and the agent must be one

- **The author** — a ✕ on the chip, or plain language ("forget scene 14", "let's step back"). The
  typed exit matters more than the chip: this is a chat product; the author will *say* it before they
  click it.
- **The system** — the `done()` predicate. Self-clearing.
- **The agent** — `propose_focus_change(mode, why)`, or the existing `ask_author` path.

The third is what converts tool narrowing from a fence into an affordance. Without it: the agent is
in `draft-scene`, realizes the scene cannot be written until a thread two acts back is fixed, finds
the expansion tool absent, and — having no way to say so — **improvises a workaround** rather than
reporting the obstruction. This preserves *AI proposes, author owns*: the agent requests, the author
confirms; it never silently re-scopes itself.

### Resume: confirm, never silently restore

The highest-risk moment for a mode error is returning after a gap.

- `done()` now true → it already self-cleared; show what completed.
- `done()` still false → **do not silently resume.** Show a resumable chip: *"Still drafting scene 14
  — continue, or clear?"* `context_focus_at` exists to detect this.

### Exit must not depend on the agent's cooperation

1. **Clearing is a plain row write, never a tool call.** The author must be able to clear while a turn
   is mid-flight or the agent is stuck in a retry loop. Anything routing exit *through* the agent
   inherits the agent's failure modes.
2. **Focus is read at turn start**, exactly like `bookState`. A mid-turn clear lands on the next chain
   link rather than corrupting the running one — the same discipline cooperative cancel already uses.

---

## 7. Build order

Cheapest and safest first, so the risky part is only built if the cheap part proves the need.

### Slice 1 — legibility. Zero fencing of any kind. ✅ *shipped 2026-08-03*

Make the mode declarable, visible, and clearable. Nothing is hidden from the model that isn't hidden
today; the author gains sight of, and a veto over, a mode that already governs the agent.

- `_shared/agent-focus.ts` — the registry + pure resolution (`resolveFocus`, `focusBlock`, `isDone`).
- Migration: the three `context_focus_*` columns.
- `threadSystem` — emit `<focus_mode>`; let focus drive skill selection and the objective rule.
- Rename `<focus>` → `<pinned>`.
- Client: a chip strip in `AgentRail` — current focus, one-click clear, mode picker.

**Success:** the author can see which mode the agent is in, override it, and clear it in one click;
`done()` self-clears a completed focus; no tool or write behaviour changes.

### Slice 2 — the ambient lens. Curation only.

`lintConfigFor(brief, focus)` plus `target ∪ pinned` scope filtering; per-mode toggles for the
objective / between-scenes / hunger blocks. Ship an escape so anything hidden stays reachable.

**Success:** asking about scene 14 no longer drags Act 3's pacing flags into the turn; asking "what
else is wrong?" still returns everything.

### Slice 3 — the affordance. The only slice that narrows anything.

`threadToolsFor(focus)` — the seam already exists. Non-negotiable conditions:

1. `read_*`, `ask_author`, and `finish` are **always** in the belt. Never fence the escape hatches.
2. The narrowing is **stated in the prompt, with the way out**: *"You are in draft-scene focus; the
   expansion engines aren't offered here. If the author needs one, say so and offer to widen."*
3. It is **never** a write fence. Any node may still be edited via `propose_node_ops`.
4. Ships with `propose_focus_change` and drift detection (§6), which only become load-bearing here.

**Never build:** visibility narrowing, or write-permission narrowing.

---

## 8. The caching physics decide the UX

Where the declaration *lives* determines what switching costs:

| what focus controls | where it lives | cost of a switch |
|---|---|---|
| ambient blocks, skills, hydration (slices 1–2) | volatile tail, inside `<book_state>` | **≈ free** — already the uncached region |
| a mode addendum in the system prompt (like `autoLine`) | position 0 | busts the cached prefix |
| **the tool belt** (slice 3) | front of the cacheable prefix | **busts everything** — full re-prefill |

The physics agree with the UX instinct: slices 1–2 make switching cheap enough to be casual; slice 3
makes it expensive enough that it must be deliberate. That argues for chip-click-or-confirmed-proposal
switching and *against* automatic drift-based switching — and for keeping the mode's *instruction
text* in the volatile tail even after slice 3, so only the belt sits in the expensive region.

Worth measuring at build time via `ai_calls` (cache-read vs input tokens) rather than assumed: the
active tier is OpenRouter/DeepSeek and caching behaviour is provider-specific.

---

## 9. Measurement

The A/B seam already exists (`variants.ts` / `variantSuffix`, appended last) and `ai_calls` records
provider, tokens, and latency per call, so focus is A/B-able from day one.

The metric that matters is **not** token count — it is **on-task rate**: how often a turn does the
thing that was asked. That is the failure focus exists to fix and where a regression would surface
first.

---

## 10. A simplification payoff

Focus-driven skill selection makes the regex trigger system **partly redundant**. Today
`matchSkills(authorAsk)` guesses the job from vocabulary and needs the `discovering` override to stop
story nouns tripping the wrong playbook mid-interview. With a declared focus the mode *states* the
job; triggers degrade to a fallback for ad-hoc asks inside `wide`. The four-condition `discovering`
predicate collapses into one registry lookup — net complexity plausibly goes **down**.

---

## Vocabulary

*mode error* (acting under a wrong mode belief; antidotes are visibility + cheap exit) · *implicit vs
explicit state machine* · *affordance vs permission* · *capability boundary vs scope boundary* ·
*salience / attention budget* · *completion predicate* (a mode that computes its own exit) ·
*policy-as-data* · *derived proposes, author disposes* · *escape-hatch legibility* · *the
reachability test*.
