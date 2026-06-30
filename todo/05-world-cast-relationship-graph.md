# TODO 05 — Pillar 2: world / cast / relationship graph

Status: **not started** · Independent of the verify loop (sequenced second on purpose) · Doc: `docs/true-agent.md` ("World / cast / relationship")

## Why
The original brief's second half: the world is built to serve the story; **cast is deliberate** (each
character picked for a reason tied to genre/premise — "casting to win a world"); relationships carry an
explicit **game** (opponent / teacher / playmate). Visualize as an Obsidian-style graph.

## It's a DNA *content* extension, not a new system
Everything is `book_nodes`. The kinds already exist (`character`, `relationship`, `game`, `world_fact`,
`location` — see `ENTITY_KINDS` in `novelDna.ts`). Work is: enrich the content + a graph render + (optional)
generation that makes casting choices *reasoned* and the games explicit.

## Pieces
1. **Character node = a reasoned choice.** Each carries *why cast* — the contract it serves (tie to genre/premise). May need a `why`/`role-in-genre` field on `CharacterContent` (already has want/need/wound/lie/role).
2. **Relationship edges name the game.** `RelationshipContent` (has `a`/`b`/`bond`/`charge`) + an explicit `game` (opponent/teacher/playmate…); the existing game-score meter rides on these.
3. **The graph render** — pure projection of the entity edges (like `meterSeries`/the meters page). Encoding contract:
   - enemy (mutual hostility) → two **red** arrows
   - mutual friend → two **green**
   - asymmetric (A friend of B, B hostile) → **green** A→B, **red** B→A
   - in love → **pink** (overrides green on the in-love direction)
   - hidden / incidental → low edge **weight** → longer & fainter (load-bearing links cluster tight)
   - direction + color encode the game; edge weight drives length.
4. **(Optional) reasoned cast generation** — generate/critique a cast where each pick is justified against the genre/premise, and the load-bearing relationship games are made explicit (vs incidental links kept weak/hidden).

## Scope / touches
- `novelDna.ts`: small content-shape additions (`why` on character, `game` on relationship) + a pure `relationshipGraph(nodes)` deriving edges with {a, b, direction, color, weight}.
- A `/dna/graph` dev page (mirror `DnaMetersPage`/`DnaLedgerPage`: load nodes, subscribe, render the force/graph view) + route + nav suppress.
- If generated: a `read-*`/expand-style edge fn + bridge route (4th-mirror rule) + `lib/`.

## Benefit of doing it after the verify loop
Once the loop runs, casting choices can be **verified** against the genre contract (does this character/game serve the promise?) instead of merely asserted.

## Success criteria
- The relationship graph renders from the live tree (refresh = no-op) with the color/direction/weight encoding above.
- Characters carry a *reason* and relationships a *game*; both editable.
- (If generation) a proposed cast is reasoned + the load-bearing games explicit, reviewable at the gate.
