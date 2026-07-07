---
description: PM session over pm/ — three-hats review, status, shipped, next, gtm, decision log
---

# /pm — run a PM session over the `pm/` knowledgebase

User input: `$ARGUMENTS`

## Always first

1. Read `pm/STATE.md` and `pm/ROADMAP.md` (plus `pm/GTM.md` / `pm/DECISIONS.md` when the mode
   touches them). `pm/README.md` holds the operating rules if you need them.
2. **Drift check:** run `git log --oneline --since=<STATE.md snapshot date>` and compare against
   STATE.md and ROADMAP.md → Now. Anything shipped/changed but not reflected in the files is the
   first finding to surface. The repo is ground truth; the files must catch up.

## Dispatch on the input

- **empty or "review"** — full **three-hats pass**:
  - *Builder:* is STATE.md honest? (drift check results; half-done items marked as such)
  - *PM:* is Now/Next still the best rank against milestone M1, then `docs/NORTH_STAR.md` §2?
    Is Now ≤ 2? Should anything be pulled, parked, or killed?
  - *Owner:* any cost/GTM/distribution implication of current work? (GTM.md anchors)
  - Output: findings per hat → concrete proposed file edits → apply after the user ratifies.
- **"status"** — concise report from STATE + ROADMAP (milestone, Now, drift found). Read-only.
- **"shipped <thing>"** — verify in git/code what actually landed, move the row in STATE.md,
  free the Now slot in ROADMAP.md, one DECISIONS.md line if scope changed en route.
- **"next"** — recommend what to pull into Now, ranked against M1 → NORTH_STAR §2, with the
  three-hats tradeoff stated. Edit ROADMAP.md only after the user ratifies.
- **"gtm"** — work the open questions in GTM.md; advance draft → plan; record new facts
  (costs, channels tried) in the anchors section.
- **"decision <text>"** — append a dated entry to DECISIONS.md (newest first): decision, why,
  what it replaced.
- **anything else** — treat as a free-form PM discussion grounded in the files; end by writing
  any durable conclusion into the right file.

## Standing rules

- **AI proposes; the author owns.** Priority changes and strategy calls need explicit user
  ratification before editing ROADMAP/GTM. Mechanical truth-keeping (drift fixes, snapshot
  dates, moving genuinely-shipped rows) applies directly.
- Update the snapshot date in any file you edit.
- A conclusion that isn't written into a file didn't happen — land it before ending.
- When awaiting a ratification, play the ping (`afplay /System/Library/Sounds/Ping.aiff`).
