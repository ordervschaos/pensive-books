# Novel DNA — the game pillar (an explicit possibility space = a solid climax)

**Status:** design contract for the `game` entity. Companion to `novel-dna-schema.md` (the fields) and
`novel-dna-flow.md` (generation order). Motivated by the "story as a game" frame.

## 1. The idea

The point of game-thinking is **not** that there are many games — a story can have exactly one. The point is
that a game gives the story a **clear possibility space: the explicit ways to WIN and the ways to LOSE.**
That is what makes a climax **solid**: the ending is one *realized, legal path* through a defined space, not
authorial fiat. The reader can feel the losses that loomed, so the win that lands is earned and chosen.

A game shares the **board** (the setting) and the **ruleset** (`world_fact.mechanism`); the win/lose must be
reachable by legal moves (grounding). A **beat is a turn**; the spine is the game(s) projected into reading
order. The climax = the central game **resolving to one pole** (won or lost), grounded in the rules.

**Core (every story): one game with both poles.** You can't win if you can't lose — a game needs a
`win_condition` AND a `lose_condition`, or there are no real stakes.

**Optional (multi-game stories): coupling.** When a book runs several games, one game's outcome can rewrite
another's stakes — and *then* stakes become **computable** (§4). Coupling is richness, not the definition; a
single uncoupled game is fully valid.

```
  ONE BOARD (setting) · ONE RULESET (world_facts + mechanisms)

  CORE — one game, two poles:
    GAME: the contract   players: Mara vs the law
        WIN:  self-redemption → free          governing_rules: [debt-bondage, peculium]
        LOSE: delivered to the rival → owned
        → the climax is this game resolving WON, by a legal move (redemption)

  OPTIONAL — coupling (multi-game): one outcome rewrites another's stakes
    GAME: the market  ──(lost → VOID)──►  GAME: the household
        (if Cassian loses Mara in the market, her household game is moot)
```

## 2. The `game` entity (a new entity kind off the pillar)

Same node envelope as the other entities (character/thread/tentpole/world_fact). Referenced by beats/scenes.

| field | type | fill | meaning |
|---|---|---|---|
| name | string | A/U | short handle (beats/scenes reference it) |
| players | `[ref→character]` | A/U | who contests this game |
| win_condition | string | ★/A | what counts as winning — **required** |
| lose_condition | string | ★/A | what counts as losing — **required** (no lose = no stakes) |
| stake | string | A/U | what is won/lost (the *prose* stake; the *computed* stake is §4, multi-game only) |
| governing_rules | `[ref→world_fact]` | A | the mechanisms this game runs on — ties win/lose to the ruleset (grounding) |
| couples | `[{ to:ref→game, when:won\|lost, effect:void\|raise\|lower\|enable, note }]` | A | **OPTIONAL** — when THIS game resolves, what it does to another game (the multi-game stakes edge) |

**Coupling semantics** — a directed edge owned by the *source* game:
- `when` = which resolution of the source fires it (`won` / `lost`).
- `effect` on the target game: `void` (target becomes moot), `raise` / `lower` (target's stake changes),
  `enable` (target only opens once the source resolves this way).
- Mara: `the market` couples `{ to: household, when: lost, effect: void }` — *if Cassian loses Mara in the
  market, her household game is void.*

## 3. How games attach to the spine (beats/scenes)

A turn (beat) plays games and may resolve them; scenes inherit (same pattern as threads/tentpoles/grounds).

| field on beat/scene | type | meaning |
|---|---|---|
| plays | `[ref→game]` | this turn advances these games (a move) |
| resolves | `[{ ref→game, outcome:won\|lost }]` | this turn DECIDES these games |

The beat sheet assigns `plays`/`resolves` across the arc (which game each turn moves, where each resolves),
the same global pass that schedules threads and places tentpoles. Scenes inherit onto their representative
scene.

## 4. Derived: the stakes graph (never stored — MULTI-GAME only)

When a book has coupled games, stakes become **computable**. Pure functions over the games + their
couplings (a single-game story simply returns empty — no penalty):

- **`stakesOf(game)`** — the transitive set of games affected if this game resolves (follow `couples`
  edges). `|stakesOf|` is the *computed stake magnitude*: how much rides on this game.
- **`cascade(gameId, outcome)`** — given a resolution, the games it voids / raises / lowers / enables,
  transitively (a void propagates as a loss, an enable as a won). The propagation the reader feels: "if he
  loses *her*, everything else collapses."

## 5. Lints (the discipline — so "game" doesn't rot into metaphor)

The discipline is the **possibility space**, not multiplicity. A game must be a real contest you can win
*and* lose; a played game must resolve. Coupling is never required — single-game stories are valid.

| lint | severity | rule |
|---|---|---|
| halfopen_game | warn | a game missing a `win_condition` or `lose_condition` — no real possibility space (you can't win if you can't lose) |
| unresolved_game | warn | a game played in ≥1 beat but never `resolved` by any beat — a dangling contest |
| ungrounded_game | warn | a game with no `governing_rules` (when the world has rules) — its win/lose isn't bound to the ruleset (risk of arbitrary outcome) |
| dangling ref | error | a `couples.to` / `plays` / `resolves.ref` / `players` / `governing_rules` pointing at a missing node (generic ref integrity) |

Note: NOT having `couples` is never a fault — a single central game is the common, valid case.

## 6. Generation order (where it slots in)

```
  … → acts → threads → GAMES (players/win/stake/couples, read the arc + cast + rules)
      → global BEAT SHEET (now also assigns plays/resolves per beat) → scenes (inherit) → prose
```

Games generate after acts + threads (they see the whole arc and the promises), and read the cast +
the world rules (so `governing_rules` binds the win to a mechanism — the grounding work). The beat sheet
gains `plays`/`resolves`; scenes inherit; the stakes graph + lints surface in DnaStudio + the chat context.

## 7. What this deliberately does NOT model (yet)

- **Want-evolution** (a player's win-condition changing as they learn the game) — adjacent, folded in later
  as a game's `win_condition` updated across acts. Not v1.
- **Win-substitution** (player loses the game they named, wins the one they needed) — expressible as a
  `couples … enable` from the declared game to the need-game, but not forced in v1.
