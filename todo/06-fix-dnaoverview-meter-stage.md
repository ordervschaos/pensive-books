# TODO 06 — Fix DnaOverview missing `meter` stage-map key (chore)

Status: **not started** · Pre-existing (not introduced by the verify-loop work) · ~1 line

## Problem
`apps/web/src/components/book/dna/DnaOverview.tsx:21` — a `Record<NodeKind, StageKey>` is missing the `meter`
key. The `meter` kind was added to `ENTITY_KINDS` in `novelDna.ts` but the stage map wasn't updated. This is
the **sole** TypeScript error in the app build (`tsc -p tsconfig.app.json`), so it blocks a clean full build.

## Fix
Add `meter` to that `Record` mapped to the appropriate `StageKey` (whichever stage entities show under —
likely `"foundations"`, matching the other pillar entities). Confirm `tsc -p tsconfig.app.json` is clean
afterward (0 errors).

## Success criteria
- `npx tsc --noEmit -p tsconfig.app.json` → 0 errors.
