# DNA UI self-explanatory pass — audit

> Snapshot: 2026-07-09. Origin: user request (two screenshots — Tree tab, Analytics tab) to make
> the whole DNA Studio self-explanatory, mechanics legible, missing control points surfaced.
> Ratified via `/pm` 2026-07-09: **Next item, comprehensive scope (all 6 tabs)**. This doc is the
> audit; an implementation plan/phasing is not yet designed.

## Diagnosis

This is mostly a **discoverability gap, not a missing-content gap**. Natural-language copy for
node kinds and journey stages already exists in the schema layer — it's wired as hover-only
tooltips, which have no on-screen signal (no **information scent**) that they're interactive and
are unreachable on touch. The **affordance** (click-to-act) pattern is inconsistent: some
sections have it, the worst-offending one (Analytics lints) doesn't.

The STALE badge (Tree tab) is the model to replicate: click → popover → plain sentence → explicit
action (regen/accept). Everything below should converge toward that shape: **visible, not
hover-gated; explained, not just labeled; actionable, not just displayed.**

## Audit by surface (via Explore subagent over `apps/web/src/features/dna/`)

### Tree — node kind labels (SEED/PREMISE/PILLAR/SHAPE/MOVEMENTS/…)
- `lib/dnaSchema.ts:178-194` (`KIND_EXPLAINER`) — plain-English gloss per kind already written.
- Exposed only as hover `title` on the kind chip: `components/tree/TreeRow.tsx:219`,
  `components/tree/Subtree.tsx:239` (entity-group headers).
- No legend/glossary panel anywhere in studio chrome (`treeChrome.tsx`, `DnaTreePage.tsx`).
- **Fix shape:** promote to a visible/first-use affordance (persistent legend, or expand-on-tap
  instead of hover) — content doesn't need to be rewritten, just re-exposed.

### Tree — journey strip (Idea/Foundations/Structure/Scenes/Prose)
- Stage captions: `lib/dnaJourney.ts:13-18` (`DNA_STAGES`) — plain 1-2 sentence descriptions.
- Rendered hover-only: `components/tree/panels.tsx:97`.
- "What's left" gap line (`panels.tsx:126-140`) is already done right: plain sentence, clickable,
  jumps to the stage and opens the agent (`onGapClick`, `panels.tsx:131-133`). **This is the
  reference pattern for the rest of the pass.**

### Tree — STALE badges
- Computed in `lib/novelDna.ts:414-426` (input hash mismatch since last generation/prose write).
- Well-built in the Tree tab: click opens a popover (`TreeRow.tsx:255-303`) — plain sentence,
  list of what changed, regen/accept buttons.
- **Gap:** this doesn't exist outside Tree. Meters tab shows the same concept as inert text with
  no popover, no inline action: `components/tree/MetersPane.tsx:328,361` ("read is stale — plan
  changed since").

### Analytics — the worst offender, matches both screenshots directly
> **Correction (2026-07-09, second pass):** the first audit pass read the wrong component.
> `DnaAnalysis.tsx`'s own lints section (`151-166`) is dead code for this purpose — its one call
> site (`DnaTreePage.tsx:766`) always passes `hideLints`. The screenshot's Analytics tab is a
> separate, hand-rolled block at `DnaTreePage.tsx:746-763` (`health.issues.map(...)`,
> `goToNode`, `issueTitle`). That block **already has click-to-jump** for every issue with a
> `nodeId` (`onClick={i.nodeId ? () => goToNode(i.nodeId!) : undefined}`, `DnaTreePage.tsx:750`,
> landing label `${kind} · ${title} →` via `issueTitle`, line 542-545) — every lint rule that
> pushes a `nodeId` (which is effectively all of them) is already jumpable. The finding below is
> corrected accordingly; treat the struck claims as void.

- `DnaTreePage.tsx:749-759` renders lint `rule_id` (mono) + one raw technical sentence, e.g.
  `dangling_ref` → `"${n.kind} references a missing node"` (`lib/novelDna.ts:1952`), `pacing_drift`
  → `"act turn lands at X% (target Y%)"` (`lib/novelDna.ts:2014`). **Still the real gap:** no "why
  this matters for the reader" field, no "how to fix" field, anywhere in the `DnaIssue` type or
  the 47 rule definitions across `lib/novelDna.ts`.
- ~~Missing control point: no click-to-jump in the lints section~~ — **void**, see correction
  above. Click-to-jump already works on the live Analytics tab.
- **Still real, narrower than first stated:** `dangling_ref`'s message doesn't say *which field*
  is dangling (`lib/novelDna.ts:1952`: `"${n.kind} references a missing node"`, no field name) —
  for a `relationship` (fields `a`/`b`, both `character` refs) you land on the right node but have
  to hunt for which side broke. And once there, `EditableField.tsx`'s ref-type display
  (`components/tree/EditableField.tsx:82-97`) doesn't visually distinguish a dangling value from a
  normal one: `refName()` (`nodeDisplay.ts:46-47`) falls back to printing the raw id string when
  the target is missing, and it still renders as if it were a valid, clickable jump-link (`jumpId`
  is set whenever `raw` is a string, regardless of whether it resolves) — no color change, no
  "missing" cue. The fix mechanism (the ▾ dropdown, which lists valid same-kind nodes) already
  exists; it's just invisible that it's needed.
- Causality glyphs `∴`/`↯` (`DnaTreePage.tsx` embeds `DnaAnalysis` for this — `DnaAnalysis.tsx:128-149`)
  explained only via hover tooltip. A "Key" popover already exists (`DnaTreePage.tsx:592-616`,
  toggled by the `? Key` button, `803`) and already covers node-status dots + causality glyphs —
  but not lint vocabulary or the health-bar terms below. Extending this existing popover, rather
  than inventing a new one, is the cheap path.
- **Also on this tab, previously missed:** the "complete"/"strong" health bars
  (`DnaTreePage.tsx:731-744`, backed by `dnaHealth()` in `lib/dnaJourney.ts:300-328`) have real,
  precise definitions in code comments (`dnaJourney.ts:295-299`) but surface to the user only as a
  hover `title` — same hover-only pattern as everywhere else, and on the exact tab in question.

### Overview
- "Promises" / "Threads" section headers are already self-explanatory (`DnaOverview.tsx:113,243`).
- **Missing control point:** Issues panel truncates to 6 with "+N more" (`DnaOverview.tsx:275`),
  no expand/click-through — must switch to Analytics, which itself has no jump actions (above).

### Meters
- Score numbers (`X/5`) for Shape/Craft/cold-read (`MetersPane.tsx:337,368`) have no legend for
  what 1 vs 5 means; axis names (`row.axis`) are unglossed strings sourced from the AI read.
- Stale tags (see Tree section above) lack the popover/action pattern present in Tree.

### Voice, Characters, Story
- Not yet audited in depth (only a shallow pass was done). Treat as open discovery — a pass over
  these three tabs against the same checklist (visible-not-hover, explained-not-labeled,
  actionable-not-displayed) is part of the "comprehensive" scope ratified for this item.

## Missing control points — full list (for implementation planning)

1. ~~Analytics lints: no click-to-jump action~~ — **void**, corrected 2026-07-09: already works.
2. `dangling_ref`: message doesn't name the broken field; the field's display doesn't visually
   flag itself as broken once you land on it (mechanism to fix — the ▾ dropdown — already exists).
3. Meters stale tags: no inline re-run button (only the separate top-level "Read"/"Editor's read"
   button, not co-located with the tag).
4. Overview "+N more" issues: no expand/click-through.
5. Kind labels & stage captions: content exists, zero visibility without hover (not reachable on
   touch at all).
6. Score legends (`X/5`) and causality glyphs (`∴`/`↯`): no persistent key, tooltip-only (a `Key`
   popover exists — `DnaTreePage.tsx:592-616` — but doesn't cover lints or the health bars).

## Analytics tab fix — implementation design (2026-07-09)

Scoped to the Analytics tab only (`DnaTreePage.tsx` tab==="analytics" block,
`DnaTreePage.tsx:726-768`); the other 5 tabs are separate future work. Four pieces, independent
and separately shippable:

**1. Lint copy map** (the core ask — new file `lib/lintCopy.ts`)
- `Record<ruleId, { label: string; why: string; fix: string }>` — one entry per rule id (47
  total, enumerated via `grep -oE 'rule: "[a-z_]+"' lib/novelDna.ts | sort -u`).
- `label`: a human title replacing the raw slug as the primary visual text (e.g. `dangling_ref` →
  "Broken reference"). Keep the raw `rule` id too, demoted to a small muted/mono suffix or
  `title` tooltip — useful for support/bug-report reference, mirrors how `KIND_EXPLAINER` keeps
  the schema term visible alongside its gloss rather than replacing it.
- `why`: one sentence, reader-facing consequence ("the reader hits a dead link — this character
  or place doesn't exist anywhere in the book").
- `fix`: one sentence, the action that closes it ("open the node and either point this at a real
  entity or clear it").
- Lives in `lib/lintCopy.ts` (presentation-adjacent content, not engine logic) — parallel to how
  `KIND_EXPLAINER` sits in `dnaSchema.ts` rather than `novelDna.ts`. Consumed only by the
  Analytics tab render; `DnaIssue`/`novelDna.ts` stay untouched (the engine stays pure, per its
  own header comment).
- Render: under the existing rule/message line in `DnaTreePage.tsx:749-759`, add a second muted
  line: `why — fix`. Existing click-to-jump, severity color, and layout are untouched.
- **Open decision, not yet made:** draft all 47 by hand now, or draft ~10 (the ones actually in
  the screenshot: `dangling_ref`, `dangling_promise`, `logline_overlong`, `logline_static`,
  `shape_unmapped`, `direction_monotone`, `pacing_drift`, `sagging_middle`,
  `static_relationship`, `prose_echo`, `dialogue_flatline`) as the proof-of-pattern and backfill
  the rest as a follow-up pass once the shape is validated.

**2. `dangling_ref` field-awareness** (`lib/novelDna.ts`)
- `refsOf()` (`novelDna.ts:345-383`) currently returns `string[]` — the field name each id came
  from (`c.a`, `c.pov`, `c.loc`, …) is computed then discarded. Change its return type to
  `{ field: string; id: string }[]`; update the 4 call sites (`backlinkIndex:389`,
  `isStale`-suspects:`408`, scene-invalidation check:`509`, dangling_ref check:`1951`) to read
  `.id` where they only need the id, and `.field` at the dangling_ref site to build a field-named
  message: `` `${n.kind}'s "${field}" points at a deleted ${expectedKind}` `` instead of the
  current generic `"${n.kind} references a missing node"`. Small, mechanical, no new concepts —
  the field name was always there, just thrown away.

**3. Dangling-value visual flag** (`components/tree/EditableField.tsx`)
- In the `type === "ref"` branch (`EditableField.tsx:83-97`), when `raw` is a non-empty string
  and `!index.has(raw)`, render it in warning color with a leading "⚠ missing — " prefix instead
  of the bare id, and keep the existing ▾ dropdown (already lists valid same-kind candidates) as
  the fix action. Closes the "you can see the error, never act on it" complaint: the fix mechanism
  already exists, it just needs to visibly announce itself once you land on the node.

**4. Health bar glossing** (`DnaTreePage.tsx:731-744`)
- "complete"/"strong" already have precise definitions in `dnaJourney.ts:295-299`'s doc comment,
  surfaced today only as a hover `title`. Promote to a visible one-line caption under the two
  bars, or fold into the existing `Key` popover (`DnaTreePage.tsx:592-616`) as a new "Analytics"
  section alongside the causality-glyph key it already has — reuses an affordance instead of
  adding a new UI element. Leaning toward the `Key` popover: keeps the tab visually uncluttered
  and is exactly the discoverable-but-not-in-your-face pattern this whole effort is chasing.

**Sequencing:** #1 (copy map) is the core ask and highest-value; #2+#3 are a paired fix for the
`dangling_ref` complaint specifically (message + visual flag are useless without each other);
#4 is small and independent, can slot in anywhere. No item depends on another — any order works.

## Not yet decided (implementation planning, next session)

- Whether to hand-write all 47 lint-copy entries up front or ship the ~10 screenshot-visible
  rules first and backfill (see item 1 above).
- Whether the raw `rule` id stays visible (muted suffix) or is fully replaced by the human label.
- Phasing across the OTHER 5 tabs: fix Analytics first (this design) vs. do the hover→visible
  promotion first elsewhere (cheaper, unlocks the pattern everywhere at once)? Analytics is
  already committed as the first slice; this is about what comes after.
- Voice/Characters/Story audit — not yet done.
