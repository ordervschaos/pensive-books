# TODO 07 — Scene sketch + direction (the treatment rung between scene plan and prose)

Status: **not started** · Depends on: nothing hard (rides existing seams) · Docs: `doc_1783196400000_dna_scene_sketch_layer.md`, `doc_1783198900000_dna_scene_direction.md`

## Why
The scene→prose jump is the pipeline's one uncontrolled resolution leap: a ~10-line spec becomes ~1,500
words inside the most expensive, least inspectable call (off-worker stream). The system patched the gap
twice — the **ephemeral** agent `RenderBrief {focus,mustHonor,avoid}` before prose (`novel-dna.ts:49`,
attached per-proposal, never on the tree) and the **reactive** read-repair after. This promotes that plan
into a durable, hashed, lintable artifact: `scene.content.sketch` — WHAT the page does (moves) + HOW it's
shown (direction) — so variety/quality decisions move to the cheap JSON layer and promise delivery becomes
a pre-stream lint instead of a post-stream regret.

**A field, not a rung** — prose precedent (`scene.content.prose`; `premise.shape` demotion). No KIND_LEVEL /
PARENT_KIND / LADDER_NEXT / reconcile / journey-stage changes.

## Contract (`scene.content.sketch`) — moves, not sentences; NO dialogue
```jsonc
sketch: {
  opening: "where/when/register the page cuts IN — must differ from prev page (anti-echo at plan level)",
  moves: [                                    // 3–7
    { what: "what turns / what gets touched",
      thread: "t_…",                          // optional ref — which open thread this move works
      sense: "smell:tar" }                    // optional pick from the loc's sensory palette
  ],
  exit: "state at the cut OUT — hands off to establishes",
  direction: {                                // HOW it's shown (see doc)
    cut: { in: "late — mid-argument", out: "early — before the answer" },
    distance: "far|mid|close|deep",           // psychic distance (Gardner)
    mode: "dialogue|action|interior|description|summary",  // scene-vs-summary + dominant texture
    time: "real|compressed|stretched",
    tension: "suspense|mystery|irony"         // reader-knowledge engine
  }
}
```
Generation inputs (the "derived from structural aspects"): scene spec + beat plan (already projected by
`realizeScenesFromBeat`, `dnaExpand.ts:176`), open threads at this point (ledger), tentpole via `realizes`,
location palette, `register` (taste seed — direction elaborates it, never contradicts it), prev scene's
sketch (for the contrast lints).

## Staleness — the elegant part (mostly free)
- `prose_src_hash` ALREADY hashes plan = content minus `{prose, observed_establishes, continuity_flags}`
  (`novelDna.ts:383` stampProse / `:370` isProseStale). Sketch lives in content ⇒ **edit sketch → prose
  stale, zero code change**.
- NEW `authoring.sketch_src_hash` = metaHash(plan minus `sketch` too) + `stampSketch`/`isSketchStale` twins
  of `:383`/`:370`. Edit scene spec → sketch stale → (transitively) prose stale. Chain: spec → sketch → prose.
- Migration behavior (by design, call it out in UI copy): generating a sketch for an already-prosed scene
  flags that prose stale — correct, the prose wasn't written from it.

## Generation: `dna-expand` target `"sketch"`
- Own-content refinement, the `target:"logline"` precedent (`dna-expand/index.ts:619`; client write-back
  `dnaExpand.ts:257`): writes onto the scene's OWN content.sketch, not a child. Small JSON call, on-worker
  (fits the ~150s ceiling; no two-hop needed).
- **Absorb the RenderBrief**: reuse the existing `brief` request plumbing (`dna-expand:301`) — the agent's
  retrieved focus/mustHonor/avoid becomes INPUT to sketch generation. `propose_prose_render` keeps `brief`
  only as a CORRECTIVE override on re-renders (book-agent's fix loop, `book-agent/index.ts:881`); the primary
  path is: sketch first, render references it.
- Prose prompt assembly (`dna-expand:638`, prepare `:647`): inject accepted sketch VERBATIM (like the brief
  at `:590` today) — moves as the page's spine, direction as render instructions.
- Agent path: `propose_expansion(nodeId = scene, target = 'sketch')` — same propose/commit duality as
  beatsheet/scenes/contract targets.

## Lints (pure, pre-stream, in `verticalLints` `novelDna.ts:845` — BOTH twins + parity lock)
- **`promise_undramatized`** (warn): a sketch move that pays off a thread / realizes a tentpole / lands the
  value turn, while direction says `mode: summary` or `distance: far` — promised a moment, plans a report.
  Pure join over refs already on the scene. THE "delivering the promises" check.
- **`direction_monotone`** (warn): adjacent prosed-order scenes with identical (mode, distance, tension) —
  enforces the `register` schema note "adjacent scenes should differ".
- Both fire only when sketch exists ("don't badge what we didn't generate", house rule at `:362`).

## Verify side (closes the generate↔verify duality)
- `check_against_contract` (`book-agent/index.ts:1040`) gains a DIRECTION axis: judge extracts OBSERVED
  distance/mode/cut points/did-the-turn-land from the prose, trace-diffs vs planned `sketch.direction` →
  targeted repair ("turn landed in summary — dramatize moves 4–5"), not "regenerate". `scene_reading_departs`
  is the template.
- Server plan-conformance follow-up (VERIFY_SENTINEL, `book-agent:862–881`): mention sketch conformance in
  the sentinel text; the heavy judging stays in check_against_contract.

## Journey / recipe (NOT a new stage — a sub-step of the prose loop)
- `STEP_RECIPE.prose` (`dnaJourney.ts:151–152` + twin `_shared/dna-journey.ts:153`): BEFORE each render, if
  the scene has no sketch or it's stale → `propose_expansion(scene, 'sketch')` (agent's retrieval feeds the
  brief input); render references the accepted sketch. Soft gate in v1 — prose can still render sketchless
  (backward compat); the recipe pushes, doesn't block.
- Auto-accept mode absorbs the extra gate like everywhere else.

## Scope / where it touches
- `dnaSchema.ts` scene block (`:126`): `sketch` field spec (+ edge twin `_shared/dna-schema.json`).
- `novelDna.ts` + `_shared/novel-dna.ts` (parity-locked): SceneContent type, stampSketch/isSketchStale,
  2 lints (+ `novelDna.parity.test.ts` fixtures).
- `dna-expand/index.ts`: `sketch` target branch; prose branch injects sketch.
- `dnaExpand.ts` (client): expandNode write-back for sketch (stampSketch), expose in the expansion surface.
- `book-agent/index.ts`: propose_expansion accepts sketch target; check_against_contract direction axis;
  system-prompt item 4/5 wording.
- `dnaJourney.ts` + twin: prose recipe text.
- Tree editor: sketch display/edit (see decisions).
- NOT touched: reconcile/render (sketch never projects to pages), digest, stream proxy, eval-bridge (not a mirror).

## Decisions to settle first
- **Editor rendering of `moves`** (list-of-objects exceeds current EditSpec types): (a) dedicated SketchCard
  in DnaTreePage, (b) extend the editor with a structured-list type, (c) v1 = one multiline "what — thread —
  sense" line per move. Recommend (c) then (a); don't build (b) for one field.
- **Bulk path** (`invokeGenerateBook`): sketch-per-scene before each prose render (N extra cheap calls)?
  Recommend yes, always — it's the quality layer and it's cheap relative to prose.
- **Direction options picker** (2–3 candidate directions via propose_options before render): fast-follow,
  NOT v1 — v1 generates one direction + lints it.
- **`scene-direction.ts` tier-1 craft KB** (story-shapes.ts pattern: vocabulary + pairing heuristics):
  fast-follow; v1 embeds a condensed version in the sketch target's system prompt.

## Success criteria
- `dna-expand target:'sketch'` writes a schema-valid sketch onto `scene.content.sketch`, stamps
  `sketch_src_hash`; scene-spec edit → sketch badges stale; sketch edit → prose badges stale (existing
  machinery, verify no code change needed there).
- Prepared prose prompt (`prepare:true` return) contains the sketch verbatim.
- Lint fixtures: a payoff move in summary mode fires `promise_undramatized`; two adjacent same-direction
  scenes fire `direction_monotone`; parity test locks both twins.
- `check_against_contract` on a prosed scene returns per-axis direction verdicts with evidence.
- Fresh book in AgentRail: agent sketches before the first render without being asked (recipe drives it).
- A page rendered WITH a sketch opens in a different place/time/register than its predecessor (spot-check
  vs the known verbatim-echo failure).
