# Novel DNA — the information-flow graph (brief → book)

**This is the core of the system, not the UI.** The UI is one way to drive this graph; the graph is what
makes a book. It defines (a) what gets generated from what, (b) what context flows into each step, and
(c) how the finished tree projects to pages. Companion to `novel-dna-schema.md` (the fields) and
`novel-dna-spec.md` (storage/render).

---

## 1. The master graph

```
                         BOOK-LEVEL INPUT  (books.brief + settings)
            premise · genre · tone · content_type(heat) · scope.word_target ·
                  success_criteria · voice_exemplar · narration · canon
                                        │
                        ┌───────────────┴────────────────┐
                     derives                           derives
                        ▼                                 ▼
        MANDATE  (binding: heat / length / genre /        VOICE  (voice_exemplar, narration)
        success — carried VERBATIM)                        │
                        └──────────────┬───────────────────┘
                                       │  injected into EVERY generation step below
                                       ▼
 ════════════════ THE DNA TREE  (book_nodes — the single source of truth) ════════════════

  GEN ORDER          NODE                 PRODUCES                              READS (context in)
  ─────────  ──────────────────  ──────────────────────────────────  ──────────────────────────────
   (1)  seed ─────────────────►  logline                              brief.premise
         │ generate
   (2)  premise ──────────────►  genre, tone, dramatic_question,      seed + brief
         │                       5-part shape (setup→3 turns→resolve)
         │ generate
   (3)  pillar ───────────────►  controlling_idea, ending             premise + brief
         │   ("pillar" = the NODE: argument + ending. The entities below are its
         │    CHILDREN — part of the Foundations STAGE — and READ its argument+ending.)
         ├──(3a) cast ────────►  character ×N (want/need/WOUND/LIE/   controlling_idea+ending  ┐
         │        │              truth/idiolect)                                               │ ENTITY
         ├──(3b) world ───────►  world_fact ×N (rules)                controlling_idea+ending   │ REGISTRY
         ├──(3c) relationships►  a↔b dyads (bond/charge)              cast                      │ (children of
         ├──(3d) tentpoles ───►  set-pieces (fluid/pinned)            argument + cast           │  pillar; refd
         │                                                                                      │  by scenes)
   (4)  acts ────────────►  acts: goal, TURNING_POINT, value,    pillar + cast   │
         │ generate                target_pct (where the turn lands)                   │
   (5)  threads ──────────────►  PROMISE registry {name,promise,      premise+pillar+ │
         │   (after acts)   payoff}                              ACTS ◄─────┘  (sees whole arc)
         │ generate (per act)
   (6)  BEAT SHEET ───────────►  ALL beats at once: summary,          ALL acts + THREADS + cast
         │  (GLOBAL pass —       connector(therefore/but), planned     (sees the WHOLE sequence, so it can
         │   not per-act)   POLARITY, + thread ROLE per beat      schedule setup→payoff in order and
         │                                                             plan the polarity to OSCILLATE)
         │ ↳ enforcePromiseSchedule: drop any payoff with no prior setup → setup→payoff is an INVARIANT
   (7)  scenes ───────────────►  pov→char, present→chars, goal/        beat (its planned POLARITY +
         │                       conflict/outcome, VALUE_SHIFT,        thread SCHEDULE) + cast + tentpoles
         │  REALIZE the beat —   realizes→tentpole.                    — scenes INHERIT the beat's polarity
         │  inherit polarity +   The beat's thread schedule is         and thread anchors (don't re-invent
         │  thread anchors       propagated onto the scenes.           them locally — that was the bug)
         │ generate (per scene)
   (8)  prose ────────────────►  the words (scene.content.prose.text)  scene + VOICE + MANDATE +
                                                                       char idiolect + prior-scene tail

 ═══════════════════════ RENDER  (projection — pure function, no generation) ═══════════════════════

   scenes in DFS reading order  ──►  partition by `chapter_start` boundary  ──►
        each chapter  ──►  [ section page (title)  +  text page (its scenes' prose, concatenated) ]
                                                  │
                                                  ▼
                                          PAGES  ──►  the book  (read / EPUB)
```

**One law of the flow:** every step reads only **what is above it** + the **registries** + the
**MANDATE/VOICE**. Nothing reads forward. A late payoff is reachable because the *promise* (a thread)
was registered at step 5 and is handed to the beat (6) and scene (7) that keep it — in reading order.

---

## 2. The two edge types

The tree has parent→child edges (the ladder) **and** reference edges (the promise/entity graph). They
are different and do different jobs.

```
  PARENT edges  (the ladder — "is composed of")        REFERENCE edges  (cross-links — "points at")
  ───────────────────────────────────────────          ─────────────────────────────────────────────
  pillar → act → beat → scene                      scene ─pov,present─► character
  pillar → character / world_fact / tentpole / thread   scene ─realizes────► tentpole
                                                         scene ─threads─────► thread  (role: setup|payoff|advance)
  define READING ORDER (DFS) and RENDER.                beat  ─threads─────► thread  (intended role)
                                                         relationship ─a,b─► character
                                                         define MEANING (who, what's promised/paid).
```

A payoff at a later scene = a **reference edge that reaches forward in reading order**: the setup scene
and the payoff scene both point at the same `thread`; their distance is the words between them. Beats
are never reordered to express it.

---

## 3. The cascade (why order matters after the first pass)

Editing any node dirties what *derives from it* — down the parent edges **and** across reference edges —
stopping at any lock. This is the dirty graph (content-hash staleness):

```
  edit pillar.ending        → every act/beat/scene below goes "stale" (unless locked)
  edit a character's LIE    → every scene that references that character goes stale
  edit a thread's promise   → the beats/scenes that set it up or pay it off go stale
  regenerate(node)          → walks down, STOPS at locks, restamps; locked subtrees are never touched
```

So generation is not one-shot: it's a forward pass you can re-run from any node, with locks as the
fixed points the author has committed.

---

## 4. The context contract (what each generator is handed)

| step | binding | ancestors | registries | special |
|---|---|---|---|---|
| seed/premise/pillar | MANDATE | brief | — | — |
| cast/world/tentpoles | MANDATE | premise+pillar | — | — |
| relationships | MANDATE | pillar | **cast** | reference chars by name → resolved to ids |
| acts | MANDATE | pillar | **cast** | the arc shape from premise |
| **threads** | MANDATE | premise+pillar | — | **the acts** (sees the whole arc to place promises) |
| beats | MANDATE | act | **threads + cast** | tags each beat's thread role |
| scenes | MANDATE | beat | **open threads + cast + tentpoles** | anchors setup/payoff at the scene |
| prose | **MANDATE + VOICE** | scene | char idiolect | prior-scene tail for continuity |

**Invariants:** the MANDATE is verbatim at every step (it never softens — the anti-launder rule).
LOCKED ancestors/refs are hard constraints. A generator that needs an entity gets the *registry*, not a
guess (cast is fed to beats/scenes; threads to beats/scenes; tentpoles to scenes).

---

## 5. Where the new pieces (threads + pacing) slot in

Two structural gaps close together because they share one engine (§6). Today the flow runs `… → acts
→ beats → scenes → prose`; beats/scenes have *hooks* (`beat.threads`, `scene.advances`) but no registry,
and nothing carries a position on the arc.

**Threads** — step (5), between acts and beats. Turns the hooks into real reference edges:
- a `thread` entity (off the pillar) holds the promise; the inline `beat.threads[].promise` text is gone —
  beats/scenes now *reference* the thread (`{ref, role}`), so the promise lives once;
- a beat tags its *intended* role; a scene carries the *realized* anchor;
- validation: payoff scene must follow setup scene; set-up-but-never-paid = dangling; paid-but-never-set-up
  = unearned (§4.5 of the schema).

**Pacing** — one field, `act.target_pct` (where this act's turn should land). Everything else is
*derived*: cumulative `prose.words` gives each scene an actual %, a act's turning point gets an actual
%, and the **pacing-drift lint** fires when actual strays from `target_pct`'s structural gravity (≈.25/.50/.75).
No per-scene budget field — the position falls out of the words.

That is the whole change — one new registry kind, one new reference edge with an ordering check, and one
pacing field. The generation order is unchanged.

---

## 6. The analytic layer — read the shape, don't generate

After a pass, three derived views read the draft along **scenes-in-reading-order**. None generate; each
turns the tree into a shape and emits lints. Same engine, three questions:

```
  scenes in reading order  ─────────────────────────────────────────────────────────►
       │                          │                          │
   PACING (when)             PROMISES (what)            CHARGE (emotional topography)
   cumulative words → %      track each thread's         sequence of value_shift.polarity
   vs act.target_pct    open/closed state           (up/down) per scene
       │                          │                          │
   drift off .25/.50/.75     dangling · unearned ·       a run of same-polarity scenes
   = sagging / rushed act    misordered payoff           = the sagging middle
```

These are exactly what *Save the Cat* / Weiland (pacing), Story Grid setup-payoff (promises), and Story
Grid value-shift / *Bestseller Code* (charge) measure — but computed off the DNA, continuously, instead of
by hand on a spreadsheet. They are the conformance backstop for structure, the way the gate is for prose.

---

## 7. Why beats are a GLOBAL pass (the root fix)

A first end-to-end run (book 1172) exposed two failures the analytic layer caught: a 15-scene unrelieved
descent (`sagging_middle`) and a thread paid off five times but never set up (`unearned_payoff`). Both have
**one root cause**: the forward pass generates each node from its *parent*, but two properties — the **thread
lifecycle** (setup→payoff) and the **emotional oscillation** — are properties of the **whole scene sequence**,
and when beats were generated *per-act* and scenes *per-beat*, no step ever held the whole sequence
while assigning thread roles or polarity. They emerged from local decisions, and emerged badly.

The fix is structural, not a prompt patch: **generate the beat sheet as ONE global pass** (step 6) that sees
every act and every thread, so it can (a) schedule each promise's setup before its payoff and (b) plan
the polarity to oscillate. Then `enforcePromiseSchedule` (a pure function) **drops any payoff lacking a prior
setup** — so setup→payoff stops being something we *hope* the model does and becomes an **invariant the
generator cannot violate**. Scenes then *realize* the sheet (inherit polarity + thread anchors) rather than
re-inventing them. The lints move from *detectors* (complain after) to *invariants* (impossible to break).

General principle: **a property must be decided at the resolution where its whole scope is visible.** Parent-
local generation is correct for the causal spine; sequence-level properties need a sequence-level pass.
