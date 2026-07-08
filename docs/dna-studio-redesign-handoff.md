# DNA Studio — design hand-off for a redesign

> **RESOLVED 2026-07-08 — the redesign shipped.** The open questions in §8 were decided and
> implemented; this doc is now the *before* picture plus the decision record below. Current state:
>
> 1. **Identity: Paper-DS light, everywhere on `/dna`** (§8-1). The three coexisting visual systems
>    are gone. `DnaTreePage` mounts the studio inside a `theme-paper` wrapper, so the studioUi-based
>    surfaces (AgentRail, Overview) resolve the Paper-DS tokens natively — both dark-token override
>    hacks (`TREE_DARK_VARS`, the rail's inline var block) were **deleted**. The tree's own skin is
>    formalized as **Console-on-Paper**: a named TS token set `T` + `MONO`/`SERIF` font stacks in
>    `components/tree/treeChrome.tsx` (TS constants, not CSS vars, because the tree styles inline and
>    composes alpha suffixes). Mono remains the structural voice (labels/badges/meta — same role
>    pv-mono plays app-wide); Newsreader serif carries everything the author reads or writes (row
>    titles, field values, prose, diffs) — §8-5 answered as "both, split by content type."
> 2. **Kind palette: per-kind hues kept, rationalized** (§8-3). Every hue re-picked as a 600–800-weight
>    ink legible on `#f6f3ec`; family relationships preserved (violet spine / cyan entities / orange+ochre
>    structure / green scene / magenta thread); `voice_profile` and `meter` got colors. `KIND_BG` is now
>    derived (8% alpha of `KIND_COLOR`) so it can't drift. The amber collision resolved: beat = ochre
>    `#a16207`, draft dot = same ochre, stale = brighter `#d97706` — stale reads as its own signal.
> 3. **Panels: one owner per edge** (§8-2). Left = search dock, right = agent rail, bottom = timeline
>    (now insets left of the search dock instead of running under it); the focus readout shifts inboard
>    of whichever left-edge occupant is open (`leftInset` props). Fixed widths remain — §8-4 answered
>    as "wide desktop only, on purpose."
> 4. **The old dark console survives as a real theme.** "Terminal" is now a selectable app theme
>    (AppearanceMenu swatch → `ThemeProvider` → `.theme-terminal` in `tokens.css`); when it's active,
>    the studio swaps its console tokens to the original dark palette via `setConsoleTheme("terminal")`
>    (both skins live in `treeChrome.tsx` as `PAPER`/`TERMINAL`). This is §8-1's "if dark console:
>    define it as a real token set, give it a name" — done for both directions.
> 5. **Nothing in §4 was dropped**; type floor raised from 8–9px to 9.5–10px minimum. The `.dna-md`
>    markdown CSS now rides the `--pv-*` vars. Out of scope, still dark: `DnaJsonPage`,
>    `DnaLedgerPage`, `DnaArchitecturePage` (dev routes off the studio).

**Audience:** whoever (human or agent) redesigns the DNA Studio's visual and interaction design.
**Scope:** the *interface* only — layout, visual language, component vocabulary, information density.
Not the generation method (that's `docs/dna-studio-analysis.md`) and not the data model (that's
`apps/web/src/features/dna/FEATURE.md` + `docs/novel-dna-schema.md`). Read those two first if you
need to understand *why* a screen shows what it shows — this doc assumes that and focuses on *how it
currently looks and behaves*, so a redesign doesn't accidentally drop a working affordance.

**Route:** `/books/:slug/dna/tree` (and its five tab suffixes below). Entry component:
`apps/web/src/features/dna/pages/DnaTreePage.tsx` — read it top-to-bottom before touching anything;
it's the one file that owns all cross-cutting layout state.

---

## 1. The one-paragraph mental model

A book is one tree (`book_nodes`): brief → seed(logline) → premise → pillar → (cast/world/threads/
games) → acts → beats → scenes → prose. The Studio is a live, editable view of that tree. There is
**no separate outline or draft document** — pages are a render of the tree, not a parallel artifact.
Every node uses the same interaction verbs (expand / choose / edit / lock), at every depth. This
uniformity is a deliberate architectural bet (see `dna-studio-analysis.md` §2) — **a redesign should
preserve "one node shape, everywhere," not introduce per-kind bespoke layouts.**

---

## 2. Current information architecture

```
/books/:slug/dna/tree              ← "tree" tab (default) — the structural tree itself
/books/:slug/dna/tree/overview     ← dashboard: next move, shape map, health, threads
/books/:slug/dna/tree/taste        ← "Voice & Feel" — every taste/subjective field, pulled to one place
/books/:slug/dna/tree/analytics    ← lints + pacing/promise/charge report
/books/:slug/dna/tree/characters   ← read-only cast dossier
/books/:slug/dna/tree/story        ← the assembled manuscript, read in order
```

One route, splat-matched — switching tabs never remounts the page, so cross-tab state (rail open/
closed, search, attached context) survives. A redesign can restructure what's *inside* each tab
freely, but collapsing this into a full remount-per-tab model would lose that persistence and should
be called out as a deliberate trade, not an accident.

### Persistent chrome (present regardless of tab)

```
┌─────────────────────────────────────────────────────────────────────┬───────────────┐
│ top bar: book name · dna    [search ⌕]  [editor ✦]                  │               │
├───────────────────────────────────────────────────────────────────┤  AGENT RAIL   │
│ tab strip: overview | tree | voice | analytics | characters | story  │  (420px,      │
├───────────────────────────────────────────────────────────────────┤  fixed right, │
│ status bar: N nodes · M accepted · stale count | complete% strong%  │  toggleable)  │
│   | kind legend | [timeline][history][lens] (tree tab only)         │               │
│   | expand-all / collapse-all / json / fork                         │               │
├───────────────────────────────────────────────────────────────────┤               │
│                                                                       │               │
│                    < active tab body >                               │               │
│                                                                       │               │
├───────────────────────────────────────────────────────────────────┴───────────────┤
│ (tree tab only) SpineTimeline — bottom filmstrip, toggleable, 420px right-inset when │
│ rail is open                                                                         │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Additional floating/overlay surfaces, all independently toggleable and independently persisted
(localStorage, per book):
- **Search panel** — left-docked, 320px, opens on `/` keypress or the search icon; regex/case/
  whole-word/kind-filter options (`components/tree/search.tsx`)
- **FocusPanel** — bottom-left readout of "what controls this node" (consumes / consumed-by) when a
  node's context badge is clicked (`components/tree/panels.tsx`)
- **Modals** — DiscardStoryModal, HistoryModal (version restore), NodeDetailsModal, ProseReaderModal
  (`components/tree/modals.tsx`)

**This is six independently-positioned floating panels that can all be open simultaneously**
(rail + search + timeline + focus panel + a modal), each with its own fixed pixel width. On anything
narrower than a wide desktop monitor this is already tight; there is currently no responsive
behavior at all — every width (420px rail, 320px search) is a hard-coded pixel value. **Flag this as
the single biggest structural UX risk to inherit**, not just a visual one.

---

## 3. The core design problem: two visual languages collide here

This is the most important thing to understand before redesigning anything.

The rest of the product has a real design system — call it **Paper-DS** — defined in
`apps/web/src/components/book/shared/studioUi.tsx` and the CSS custom properties in
`apps/web/src/index.css`:
- Light, warm, editorial: `Newsreader` serif for reading text (`pv-serif`), monospace uppercase for
  labels/eyebrows (`pv-mono`), generous `rounded-2xl` cards, HSL custom-property tokens
  (`--pv-accent`, `--pv-surface-2`, `--pv-border-soft`, `--pv-text-muted`, `--pv-text-faint`…)
- A real component vocabulary: `Panel`, `Eyebrow`, `ActionLink`, `PickButton`, `OptionCard`,
  `RunError`, `RunningInline`, `RunningCard`, `Gate`, `Hero`, `StageHead`, `StepDot`, `Pip`/`Pip3`,
  `ProgressMeter`, `DoneStrip`, skeletons. This is used across the book editor, the revision chats,
  the beat-sheet editor — everywhere *except* the DNA tree.

The DNA Tree Studio **opts out of it almost entirely.** `DnaTreePage.tsx` and everything under
`components/tree/*` (which is ~90% of the screen — `TreeRow`, `Subtree`, `EditableField`, `treeChrome`,
`panes.tsx`, most of `panels.tsx`) is written as **raw inline React `style={{...}}` objects with
hard-coded hex colors and `fontFamily: "ui-monospace, monospace"` on almost every element** — not
Tailwind classes, not the token system, not the shared components. Example, `treeChrome.tsx:5-26`:
a hand-maintained `KIND_COLOR`/`KIND_BG` hex map (violet for seed, indigo for premise, sky for
character, orange for act, amber for beat, green for scene…) that exists nowhere else and has no
relationship to the app's semantic tokens.

A **second, narrower pattern** then reintroduces the design system, but re-themed dark: `AgentRail`
and the Overview tab (`TreeOverviewTab.tsx`) *do* use `Panel`/`Eyebrow`/`ActionLink`/`RunError` from
studioUi — but wrapped in a local CSS-variable override (`TREE_DARK_VARS` in
`TreeOverviewTab.tsx:16-25`, duplicated inline in `DnaTreePage.tsx:552-561`) that remaps the *same*
token names (`--pv-accent`, `--background`, etc.) to a dark violet-on-near-black palette instead of
the app's default warm-paper one. So the same component (`Panel`) renders two completely different
skins depending only on which DOM subtree it's mounted in.

**Net result: three coexisting visual systems on one screen** —
1. Paper-DS light (the rest of the app, if you navigate away from `/dna`)
2. Paper-DS dark-token-override (AgentRail, Overview tab, ThreadRow)
3. Raw hard-coded-hex monospace terminal (the tree itself — search, tree rows, panes, timeline,
   status bar, tab strip, legend)

None of this was designed as a system — it accreted feature-by-feature (see the `project_dna_tree_editor`
/ `project_tree_components_split` history: the tree grew from a debug view into "the ONE studio
surface" without ever getting a visual pass). **The central decision a redesign needs to make is not
"what should it look like" in isolation — it's whether DNA Studio should (a) fully adopt Paper-DS
(light, editorial, consistent with the rest of the product) or (b) keep and *formalize* a distinct
dark "engineering console" identity (consistent with itself, intentionally different from the rest
of the app, because this is the one screen where the author is manipulating structure/data rather
than reading/writing prose). Both are defensible. What's not defensible is the current unplanned
mix of both plus a third ad hoc system.**

---

## 4. Interaction inventory — what must survive a re-skin

A redesign that only changes colors/type/spacing is safe by construction. A redesign that touches
layout or component boundaries must preserve every one of these, or explicitly call out what it's
dropping. Grouped by surface:

### Tree rows (`components/tree/{Subtree,TreeRow,EditableField,treeChrome}.tsx`)
- Expand/collapse per node (chevron), plus a *separate* "open detail" state for leaf nodes
  (`openSet` vs `collapsedSet` — two different kinds of "closed")
- Click-to-edit fields, auto-growing textareas, save-on-blur (`EditableField.tsx`)
- ★-marked "load-bearing" fields vs. ordinary fields
- Status pill (accepted / draft / empty) + amber "stale" dot (derived from `src_hash`, not stored)
- Lock toggle (locked nodes are protected from regenerate sweeps)
- Kind badge, color-coded, doubles as a context-focus trigger (click → highlights
  "consumes"/"consumed-by" neighborhood in green/blue, opens FocusPanel)
- Backlinks row ("referenced by …") — collapsible, shows inbound cross-references
- Hidden/"structural" fields row — collapsed-by-default toggle for AI-maintained plumbing (state
  keys, thread roles, `grounds_in`) vs. author-owned taste fields
- Prose rollup badge on beat/act rows — 3-segment bar (done/stale/none) + fraction
- Drag-and-drop reorder within a sibling group
- Delete with a dangling-reference warning (lists what will break)
- Add-row affordance per kind at the appropriate depth
- Search-match highlighting inline (`Highlighted` in `search.tsx`) — must merge visually with the
  click-to-edit and stale-chip states, not fight them
- Proposal overlay — pending agent-proposed ops render as **phantom/diff rows in place** in the same
  tree (`proposalOverlay.tsx`) — added/changed/removed states, with an inline accept/reject picker
  (`ProposalPicker`). This is a core "review the AI's suggested edit before it lands" mechanic — treat
  it as first-class, not a modal afterthought.
- Health lens — a toggle that dims every node *without* a lint and reveals ones that have one
- Flash/scroll-to on jump (from search, from a lint click, from the map)

### Top-level chrome
- Search: regex / case-sensitive / whole-word toggles, kind filter, live match count, `/` to open
- Agent rail: open/closed persists per-book; drag context ("@-attach") a node into the agent's
  working set from a row's attach icon; the rail's own thread UI (message list, streaming, stop,
  session history, auto-accept "∞" toggle — see `AgentRail.tsx`)
- SpineTimeline: reading-order filmstrip across acts→beats→scenes, click to jump
- Health pip (completeness % + strength % bars) that deep-links into Analytics
- Kind-count legend, always visible
- Fork (duplicate the whole tree into a new book), JSON export link, expand-all/collapse-all

### Per-tab
- **Overview**: next-move card, story-shape map (click a node to drill in), lints, threads list,
  autopilot-style bulk actions
- **Voice/Taste**: every subjective field (premise tone, pillar controlling idea, voice profile,
  per-character idiolect) pulled into one flat list, independent of tree depth
- **Analytics**: lint list (click → jump to offending node), pacing/promise/charge report
- **Characters**: read-only cast dossier
- **Story**: continuous reading view of all written prose, "render pages" and "read in reader" actions

If a redesign simplifies any of the above away (e.g. merging the health lens into search, or
removing the separate stale-dot from the status pill), say so explicitly in the deliverable — don't
let it disappear silently.

---

## 5. Content model surface (what the UI has to represent)

Twelve node kinds, currently color-differentiated with no other visual grouping cue
(`dnaSchema.ts:160-180`, `treeChrome.tsx:5-19`):

| Kind | Level | One-line gloss | Current hex |
|---|---|---|---|
| seed | 0 | the raw idea, before refinement | `#a78bfa` violet |
| premise | 1 | the central dramatic question | `#818cf8` indigo |
| pillar | 2 | controlling idea + ending | `#6366f1` indigo (darker) |
| character | 2 | want / need / wound | `#38bdf8` sky |
| relationship | 2 | bond + charge between two characters | `#7dd3fc` |
| world_fact | 2 | a rule scenes must stay consistent with | `#bae6fd` |
| location | 2 | a place, with sensory palette | `#5eead4` teal |
| voice_profile | 2 | pov / tense / narrative style | — |
| thread | 2 | a promise paid off later | `#f9a8d4` pink |
| game | 2 | a contest with win/lose conditions | `#93c5fd` |
| tentpole | 2 | a planned major set-piece | `#e0f2fe` |
| meter | 2 | a numeric tracked axis (comedy, heat…) | — |
| act | 3 | — | `#fb923c` orange |
| beat | 4 | causal unit (needs → establishes) | `#fbbf24` amber |
| scene | 5 | the dramatized moment | `#4ade80` green |

Plus three **status** states per node (accepted/draft/empty — green/amber/grey dot) and one
**derived** boolean (stale — amber ring), independent of the kind color. A redesign needs a palette
strategy that can carry *two* independent color dimensions (kind identity + status) without
collision — the current system already strains at this (amber is both "beat" and "stale" and
"draft").

---

## 6. Observed pain points (not user-tested — read as hypotheses to validate, not verdicts)

- **No responsive design at all.** Every panel width is a hard pixel value; nothing has been
  observed or built below "wide desktop." A tablet or narrow laptop is currently unusable.
- **Small type, everywhere.** Labels run 9–11px monospace uppercase throughout the tree. Combined
  with low-contrast greys (`#555`, `#666`, `#888` on `#0a0a0a`) this is a plausible accessibility
  (contrast ratio) problem, not just a taste one — worth an actual contrast audit.
- **Icon-only affordances with no label fallback.** The quick-toggle bar uses bare glyphs (`⌕ ✦ ▦ ⟲
  ◐`) for search/editor/timeline/history/lens — legible only via `title` tooltip on hover.
- **Simultaneous floating panels compete for the same edge.** Rail (right, 420px) + search (left,
  320px) + timeline (bottom) + focus panel (bottom-left) can all be open together; nothing currently
  prevents overlap-feeling clutter.
- **Color is the only encoding for kind identity** — no icon, no shape, no grouping beyond the hue.
  Colorblind-safe review has not been done (violet/indigo/sky/teal are close in hue for some CVD
  types).
- **Density is uniform across very different tasks.** Deciding a controlling idea (rare, high-stakes,
  one node) renders with the same terse row chrome as scanning 40 scene rows (frequent, low-stakes,
  skimmed) — no visual "zoom level" differentiates deliberate authoring from bulk scanning.

---

## 7. Constraints — what a redesign should *not* touch

- **Data model / edge functions are out of scope.** This is a pure client-side view over
  `book_nodes`; `lib/novelDna.ts`, `lib/dnaSchema.ts`, `lib/bookNodes.ts`, and everything under
  `supabase/functions/` are the private model DNA owns (`FEATURE.md` "the seam") — a redesign
  changes *presentation*, not what data exists or how it's generated.
- **Realtime/live-projection behavior is load-bearing, not optional** (see memory: "Refresh = no-op"
  is a standing product rule). Any redesign that reintroduces a fetch-once pattern is a regression,
  not a simplification.
- **Stack**: React + TypeScript, React Router (splat routes), Supabase JS client, Tailwind available
  but currently unused in `components/tree/*` (inline styles instead) — Tailwind + the `cn()` helper
  + shadcn/ui primitives (`@/components/ui/*`) + studioUi are all already dependencies of this app;
  a redesign does not need to introduce any new library to make the design-system decisions above.
- **`docs/dna-studio-system.md` is stale** — it documents a deleted 3-column `DnaStudioPage`/
  `DnaStudio.tsx`/`DnaVisuals.tsx` layout (removed in the "DNA substrate pivot," see memory
  `project_dna_substrate_pivot`). Do not use it as a description of current behavior; this document
  supersedes it for UI purposes. (Worth deleting or clearly marking superseded in a follow-up — not
  done here since it wasn't asked for.)
- **`docs/dna-studio-analysis.md` is current and authoritative for *why* the screens show what they
  show** (the generation method) — keep reading it alongside this doc, don't treat this doc as a
  replacement for it.

---

## 8. Open questions the redesign should resolve (not this doc's job to answer)

1. **Light Paper-DS vs. formalized dark console** — pick one, deliberately, per §3. If dark console:
   define it as a real token set (not a per-mount-point override hack), give it a name, document it
   next to Paper-DS.
2. **Panel real estate strategy** — with rail + search + timeline + focus panel all independently
   toggleable and all fixed-width, what's the actual policy? (Mutually exclusive? Responsive collapse
   order? A single unified side-panel with tabs instead of stacked independent panels?)
3. **Does every node kind need a distinct hue**, or would a smaller palette (e.g. group by ladder
   rung: idea / foundations / structure / scene, 4 colors not 15) reduce cognitive load while keeping
   kind legible via the label text that's already shown?
4. **Minimum viable responsive breakpoint** — is mobile/tablet in scope at all for an authoring tool
   this dense, or is "wide desktop only" an acceptable explicit constraint to document and design for
   on purpose (rather than the current accidental one)?
5. **Terminal/mono aesthetic — keep as a deliberate "you are editing structured data" signal, or
   replace with the serif reading-first feel used for prose elsewhere?** Note the Story tab already
   switches to `Georgia serif` for prose paragraphs mid-page (`panes.tsx:48`) — there's precedent for
   mixing type families *within* the tree by content type (structure vs. prose), which could be a
   deliberate design lever rather than an inconsistency.

---

## 9. File map — where to work

| Area | Files |
|---|---|
| Route shell / cross-tab state | `apps/web/src/features/dna/pages/DnaTreePage.tsx` |
| Tree UI (dependency-ordered) | `components/tree/treeChrome.tsx` → `nodeDisplay.ts` → `search.tsx` → `EditableField.tsx` → `TreeRow.tsx` → `proposalOverlay.tsx` → `Subtree.tsx` |
| Satellite tree panels | `components/tree/panels.tsx` (Voice/Journey/Focus/Timeline), `panes.tsx` (Story/Characters), `modals.tsx`, `BriefSection.tsx` |
| Overview dashboard | `components/DnaOverview.tsx`, `components/TreeOverviewTab.tsx`, `components/DnaStoryMap.tsx`, `components/DnaStageDiagram.tsx` |
| Analytics | `components/DnaAnalysis.tsx` |
| Agent rail | `components/AgentRail.tsx` |
| Shared design system to reuse or extend | `apps/web/src/components/book/shared/studioUi.tsx`, tokens in `apps/web/src/index.css` |
| Method/architecture background (read, don't edit for this task) | `apps/web/src/features/dna/FEATURE.md`, `docs/dna-studio-analysis.md`, `docs/novel-dna-schema.md` |

Routes are registered in `apps/web/src/App.tsx`; no route changes are implied by a visual redesign
unless the IA itself is being restructured (open question #2 above touches this).
