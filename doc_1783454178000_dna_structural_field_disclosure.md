# DNA tree: surfacing hidden node content

## The problem

`dnaSchema.ts`'s `NODE_SCHEMA` is the single source of truth (SSOT) for what a
node's `content` looks like. Every field carries an `EditSpec`, and one flag —
`genOnly: true` — marks fields the AI writes but the manual editor shouldn't
offer a form for (structural plan data: causality keys, thread anchors, the
scene sketch/treatment). `editSpecs(kind)` filters those out before the tree
renders anything, so `genOnly` fields were invisible everywhere in the UI —
not just non-editable, literally never displayed.

On top of that, a second, unintentional gap existed: several fields the edge
functions actively write (`chapter_start`, `time`, `present`, `advances`,
`observed_readings`, `observed_establishes`, `continuity_flags`,
`confusion_flags`) had drifted out of `NODE_SCHEMA` entirely — never added
when the read-passes (continuity read, cold-reader read, meter read) were
built. So they weren't even flagged `genOnly`; they simply didn't exist as
far as the schema was concerned.

## The two-bucket split

The user's audit named two different kinds of "hidden" data:

- **Bucket A — content fields.** Live on `node.content`, no computation
  needed, just a display gap. Cheap and low-risk to fix.
- **Bucket B — derived series.** Whole-tree computations (`causality`,
  `obligationLedger`, `meterSeries`, `facetEchoes`, `ledgerAt`, ...) that are
  either already surfaced in dedicated dashboards (Meters/Analytics tabs) or,
  for a few (`facetEchoes`, `ledgerAt`, `ledgerBefore`), genuinely orphaned
  with zero UI consumers. These need a "compute once per render, look up per
  row" pattern (same as the existing `issuesByNode`/`backlinks`/`proseRollup`
  maps) — a bigger, separate decision about which series deserve inline
  per-node badges.

Scoped this pass to bucket A only, by explicit agreement.

## The fix

`hiddenFields(node, index)` in `nodeDisplay.ts` — a pure function that reads
`node.content` directly and returns every top-level key `editSpecs(kind)`
doesn't already cover, with non-empty values rendered to a display string
(ref ids resolved to node titles via the existing `index` map, nested
objects/arrays flattened to `key: value · key: value`). Because it derives
from the *live content* rather than a maintained list, it automatically
covers both the `genOnly` fields and the undocumented ones — and can't drift
again as new fields get written by future edge functions.

Deliberately did **not** touch `NODE_SCHEMA` or `dnaSchemaArtifact()` — that
function also renders the AI generation prompt guide, and several of the
newly-visible fields (`observed_readings`, `continuity_flags`,
`confusion_flags`) are explicitly commented as *output-only, excluded from
chat context*. Adding them to the schema would have leaked them into the
model's prompt as if they were authorable input, which is the opposite of
what the existing code deliberately chose. Keeping the fix purely in the
display layer means the generation contract (and its golden test,
`dnaSchema.artifact.test.ts`) is untouched.

`HiddenFieldsRow` (`TreeRow.tsx`) renders a collapsed-by-default "▸
structural · N" toggle chip — visually matching `EditableField`'s row
geometry but read-only (no click-to-edit), consistent with the fact that
this is AI-authored plan/output data, not something the author hand-edits.
Wired into `Subtree.tsx` right after the editable `fields` block, in all
three body branches (pillar/seed/everything else).

## Verified

- `tsc -p tsconfig.app.json --noEmit` clean.
- `vitest run src/features/dna` — 603 passed, including the schema artifact
  lock test (confirms the AI prompt contract is unchanged).
- Live in the browser against book 1233 ("The Long Way"): a scene with
  `chapter_start.title` set shows "▸ structural · 1" → expands to `chapter
  start — title: One: The Door`; beats with no genOnly data set show no chip
  at all (the empty-value filter works as intended).
