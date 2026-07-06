# DNA: Scenes (stage 4 — beat shattered into value-turning units)

> A scene doesn't invent anything causal — it REALIZES (projects) its beat at
> higher resolution. The causal DAG was settled at the beat layer; scenes decide
> WHERE inside the beat each piece lands.

## Position + why generation flips to local

Rung 5, children of beats, last PLAN rung before prose.

Recipe (`dnaJourney.ts:151`): `propose_expansion(nodeId = THIS beat,
target='scenes')` — ONE call per beat. Contrast beats = ONE GLOBAL pass. Scenes
= per-beat LOCAL pass. Global causality (setup->payoff, polarity, needs/
establishes) was already resolved at the beat layer; a beat's scenes are local
detail. Expensive global pass happens once, at the layer where cross-book
decisions live.

## Scene schema (`dnaSchema.ts:121`)

- **pov** -> character ref (whose head)
- **loc** -> location ref (pulls the location's sensory palette verbatim -> prose)
- **goal / conflict / outcome** — the scene engine (Goal->Conflict->Outcome;
  McKee/Swain scene-sequel). goal required.
- **value_shift** {value, from, to, polarity} — the value that TURNS here
  (the "never a flat and-then" enforcer at finest grain).
- **register** (taste) — how the ONE voice BENDS here (pace/distance/intensity);
  adjacent scenes differ so the read never goes flat.
- **readings** (genOnly) — meter values inherited/refined from the beat.

## realizeScenesFromBeat — inheritance/projection (`dnaExpand.ts:176`)

After the LLM returns raw scenes, a local pass PUSHES the beat's plan down
rather than trusting the LLM to re-derive it. Position is meaningful:

```
needs        -> FIRST scene   (turn CONSUMES state at entry)
polarity     -> every scene value_shift.polarity (default)
threads      -> FIRST scene   (representative)
realizes[]   -> one tentpole per scene, in order
plays        -> FIRST scene   (advance contest)
resolves     -> LAST scene    (decide it)
grounds_in   -> LAST scene    (the win FIRES the rule)
establishes  -> LAST scene    (turn PRODUCES when it lands)
chapter_start-> first beat's first scene opens a chapter
```

Entry/exit split (`:191`): a beat's turn consumes at entry, produces at
resolution. So needs=first (beat begins), establishes=last (turn lands,
co-located with grounds_in/resolves). Piling both on scene 0 told the opening
scene to "produce everything" and left the resolving scene's plan-conformance
check (P2.2) expecting nothing it delivers. Single-scene beat: first===last,
keeps both.

Why it matters: scenes are a PROJECTION of the beat, not an independent
authoring layer. Beat = SSOT for causality; scenes inherit it and only add
resolution. If scenes re-invented needs/establishes the global DAG would rot on
expansion. Inheritance keeps "the global plan authoritative" (`:174`).

## Same seams as earlier layers

- Config-driven generation: scenes ride node_type_configs (`dna-expand:833`
  handles child_kind==="scene"); slots arc/priorScenes/entities/threads. "ONE
  authoritative structure — NOT alternatives."
- Propose/commit duality: realizeScenesFromBeat called by BOTH commit path
  (`dnaExpand.ts:312`) and propose path (`:446`) — proposed set carries the same
  plan.
- Coverage chain: stage = beatsWithScenes/beats (`dnaJourney.ts:232`). Every
  beat grows scenes, one call at a time.

## Picture

```
   BEAT (goal, turn, causal plan — SSOT for this segment)
     │  propose_expansion(target='scenes') -> LLM drafts raw scenes
     │  realizeScenesFromBeat()            -> beat plan projected DOWN
     ▼
 [scene1 needs/threads/plays][scene2 realizes][scene3 grounds_in/resolves/establishes]
     each: pov·loc·goal->conflict->outcome, value turns, register bends
                                   │
                                   ▼ next: PROSE (render + read-repair)
```

## Terms

scene as value-turning unit (Goal-Conflict-Outcome) · projection/inheritance
(scenes realize the beat; global plan authoritative) · local vs global
generation · entry/exit placement of causal state (needs=first, establishes=
last) · plan-conformance check · register/voice-bend · location-palette
inheritance · coverage chain · config-driven generation · propose/commit duality.
