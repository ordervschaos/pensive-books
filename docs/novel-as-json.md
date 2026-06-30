# Novel DNA — the resolution-ladder authoring structure

Companion to `novel-compressed-schema.md`. That doc described the *finished* DNA (flat, compressed). This doc describes the **structure the user builds it with** — a resolution ladder where each rung adds detail, and the data carries both content and authoring state so the AI can do the heavy lifting without ever overwriting the user's intent.

Design objective: **ease** (small bounded ask per rung, choose-don't-author) **and control** (every node lockable, every edit shows its blast radius).

---

## 1. The self-similar rung node

Every level of the ladder is the same node shape. Learn four verbs once — expand, choose, edit, lock — apply them identically everywhere.

```jsonc
{
  "id": "n_a3f",
  "level": 2,                     // 0..6
  "kind": "pillar",              // seed | premise | pillar | act | beat | scene | prose
  "parent": "n_root",
  "children": [],                // next rung; empty until expanded

  "content": { /* shape depends on kind — see rung table; this is the prior flat schema, distributed */ },

  "authoring": {
    "source": "user",           // user | ai | ai_then_user   (who wrote current content)
    "locked": false,            // user pin → hard constraint, never overwritten, survives regen
    "status": "accepted",       // empty | proposed | draft | accepted
    "stale": false              // a locked/edited ancestor changed after this was written
  },

  "proposals": [                 // AI options the user chooses among (the ease lever)
    { "id": "p1", "content": {} },
    { "id": "p2", "content": {} }
  ],
  "chosen": "p1"
}
```

`authoring` is the part that makes ease + control coexist. Strip it out and you have the flat DNA; keep it and you have a build system.

---

## 2. The rungs — what gets added at each level

The discipline: keep each rung's *ask* small, and prefer "choose among proposals" over "fill a blank".

| Rung | kind | `content` shape | user's bounded job |
|---|---|---|---|
| L0 | seed | `{ logline }` | give the idea, or pick a proposal |
| L1 | premise | `{ genre[], tone[], dramatic_question, shape: {setup, turn1, turn2, turn3, resolution} }` | steer the turns + ending |
| L2 | pillar | `{ protagonist:{want,need,wound,lie,truth}, opposition, world_rules[], controlling_idea }` | **supply wound + lie** (human core) |
| L3 | act | `{ goal, turning_point, value }` ×3–5 | place the turning points |
| L4 | beat | `{ summary, connector:"therefore"\|"but" }` + declare `threads[{promise, kind}]` | which promises matter |
| L5 | scene | `{ pov, loc, present[], goal, conflict, outcome, value_shift, advances[] }` | tweak value shifts / order |
| L6 | prose | `{ text }` | voice corrections only |

Cognitive load is front-loaded onto L2 and tapers — spend the user's attention where the AI is weakest (the emotional core), not where it is strong (sentences).

Fan-out (geometric): 1 → 1 → ~4 → ~4 → ~12 → ~40 → ~40.

---

## 3. The three operations

Everything the user does reduces to these three. Ease and control live entirely inside them.

### expand(node)  — the ease
```
inputs  = node.content
        + all locked ancestors          // hard constraints
        + accepted sibling content       // local coherence
proposals = LLM.generate_children(inputs, n=2..3)
node.children[*].proposals = proposals
node.children[*].status    = "proposed"
// user picks one → chosen set, status -> "accepted", source -> "ai"
```

### lock(node) / edit(node) — the control
```
edit:  node.content = userValue; node.source = "ai_then_user" (or "user")
lock:  node.locked  = true
// a locked node is injected as a hard constraint into every downstream expand()
// and is never overwritten by regeneration
```

### propagate(node) — the recalc (run on every content change)
```
for d in descendants(node):
    if d.locked:
        d.flag = "ancestor changed — review?"   // kept, but surfaced
    else:
        d.stale = true                           // eligible to regenerate

// regeneration sweep, top-down:
regen(n):
    if n.locked: return            // STOP — locked subtree is protected
    if n.stale:  expand(n.parent for this child); n.stale = false
    for c in n.children: regen(c)
```

This is spreadsheet recalculation: `content` = value, derivation = formula, `locked` = a manually-typed literal that recalc skips, `stale` = the dirty bit. Editing a pillar dirties its unlocked subtree and stops cold at any lock.

---

## 4. Validation rules (cheap, catch the worst failures)

- A node may be `expanded` only if its parent `status == "accepted"`. (Enforces ladder order → progressive disclosure.)
- Every `thread.promise` (declared at L4) resolves to a `payoff` scene at L5 with a later index than its setup.
- Every L5 scene has a non-empty `value_shift`. (No flat "and-then" scenes.)
- Every L4 beat after the first in its act has a `connector` of `therefore` or `but`.
- A regenerate sweep never mutates a node where `locked == true`.
- After any edit, the user is shown the count of newly-`stale` nodes before regeneration runs (the visible blast radius).

---

## 5. Why this delivers "ease and control"

**Ease**
- Self-similar node → one UI vocabulary (expand / choose / edit / lock) at every depth.
- Choose-don't-author: `proposals[]` means the user is usually picking, not writing.
- Progressive disclosure: a rung is hidden until the one above is accepted; the whole novel is never on screen at once.
- Defaults from craft frameworks (Snowflake, Save the Cat, Dramatica) seed the AI's proposals so there is never a blank page.

**Control**
- `locked` is a hard rail: a pinned node is a constraint on all downstream generation and is never overwritten.
- `stale` makes every edit's blast radius visible and surgical — the user sees exactly what an L2 change touches before anything regenerates.
- Regeneration stops at locks, so the user's pinned work is never collateral damage.

---

## 6. Lineage

- **Resolution ladder / rungs** — the Snowflake Method (Randy Ingermanson): sentence → paragraph → page → scene list.
- **Bounded per-step ask** — progressive disclosure (Nielsen Norman Group); the wizard pattern.
- **Proposal defaults** — Dramatica, Save the Cat beat sheet (give the AI defensible structure to propose from).
- **Propagation engine** — spreadsheet recalculation; incremental build systems (Make, Bazel); React reconciliation. `locked` = manual override, `stale` = dirty bit.