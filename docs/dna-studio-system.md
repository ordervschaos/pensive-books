# DNA Book Studio — System Write-up for Redesign

## What it is

The DNA Studio (`/books/:slug/dna`) is a structured authoring environment for building a novel from the ground up. It's built on the **Novel DNA model**: a book is a single self-similar tree of nodes (`book_nodes` table), and everything from logline to prose to chapters are projections of that tree — not separate forms. The Studio is the author's UI to walk that tree.

---

## The mental model: resolution ladder

The book is built top-down, coarse to fine, in 5 stages:

```
Idea (seed → premise)
  ↓
Foundations (pillar + cast, world, tent-poles, games, relationships)
  ↓
Structure (acts/acts → beats — the causal spine)
  ↓
Scenes (one per beat — the dramatized moment)
  ↓
Prose / Illustrations (the actual text or image for each scene)
```

This is not a linear wizard — it's a **resolution ladder**. Higher rungs constrain lower ones. The system tracks `authoring.src_hash` per node: if a parent changes, its children are marked **stale** (amber chip). The author can lock any node to protect it from regeneration sweeps.

---

## Current layout: 3 columns

```
┌──────────────┬─────────────────────────────┬────────────────────────┐
│  Navigator   │  Stage (main content)       │  Agent Rail            │
│  (left ~20%) │  (center ~52%)              │  (right ~28%)          │
│              │                             │                        │
│  Overview    │  Stage-specific content     │  Conversational agent  │
│  ──────────  │  + DnaStageDiagram          │  (AgentRail) that sees │
│  Layers:     │  + NodeCards                │  the whole tree and    │
│  · Idea      │                             │  can talk/edit/explain │
│  · Foundations│                            │                        │
│  · Structure │                             │                        │
│  · Scenes    │                             │                        │
│  ──────────  │                             │                        │
│  Output:     │                             │                        │
│  · Prose     │                             │                        │
│  · Visuals   │                             │                        │
└──────────────┴─────────────────────────────┴────────────────────────┘
```

---

## The Navigator (left rail)

- A `Build` label at top, then `Overview` as a home link.
- **Layers** section (coarse→fine): 4 authoring stages. Each row: a `StepDot` + label + optional amber "stale" chip or a fraction `2/5`.
- **Output** section: Prose (the draft stage, same shape) + Visuals (illustrations, character portraits).
- A divider, then utility links: `edit brief →`, `render pages →`, `read →`.

The active row gets a faint accent background. Locked stages are dimmed and non-clickable. The "now" stage (the active frontier) shows a sub-step tally (`2/5`).

---

## The Stage (center)

### Overview (home)

Shows 4 panels:
1. **Next move** — the current stage + first open sub-step, with quick links to optional branches (World, Games, Tent-poles, Relationships, Threads).
2. **Story map** — a bird's-eye visual of the whole tree (act → beat → scene pips, with polarity color-coding and value arcs). Click a node to drill into its owning stage.
3. **Story analysis** — pacing drift, emotional charge, promise lifecycle.
4. **Autopilot** — a one-click "build the whole book" automation.
5. **Threads panel** — the cross-cutting promise registry, editable with NodeCards inline.

### Stage views (per layer)

Each stage opens with a `StageHead` (eyebrow / title / caption) and an inline `DnaStageDiagram` (a visual of that layer's shape — e.g. the causality DAG for beats, a character web for foundations).

Then the NodeCards.

**Foundations** has tabbed sub-sections: Pillar / Cast / World / Games / Tent-poles / Relationships.

**Structure** has 2 tabs: Acts / Beats. Beats tab shows drag-reorderable beats grouped under act headers.

**Scenes** shows beats as collapsible group headers, each containing its scene NodeCards.

**Prose** (Draft) shows a reading view: Act → Beat header (click to drill) → prose text inline. Top bar has progress (`12/41 scenes drafted`), bulk-generate action, and a `Read the book →` button that renders + redirects to the reader.

---

## The NodeCard (the atomic unit)

Every node — seed, premise, character, beat, scene — uses the same card. 4 zones:

1. **Identity row** (always visible, toggles open/closed): `chevron · kind badge (eyebrow) · title · status pill · stale chip · lock icon`
2. **Summary** (derived, read-only): kind-specific derived data. Beat: `needs [state keys] → establishes [state keys]`. Scene: `value axis: hope → despair ↘`. Game: win/lose conditions + coupling cascade. Character: physical tag.
3. **Fields** (editable): label → auto-growing textarea or select. ★ marks load-bearing fields. Save on blur.
4. **Action bar** (persistent, never reflows): left = generate verbs (Sparkles icon + label); right = lock toggle + delete. If `status !== "accepted"`, the only action is `approve`.

**Approve gates expansion**: you can only generate children of an accepted node. This enforces the resolution order — you commit Premise before Foundations can generate.

**Generate verb targets per kind:**
- `seed` → `generate premise`
- `premise` → `generate pillar`
- `pillar` → `generate cast`, `generate relationships`, `generate world`, `generate tent-poles`, `generate acts`
- `act` → `generate beats`
- `beat` → `generate scenes`
- `scene` → `write prose` (or `illustrate` in picture-book mode)

Regenerating unlocked children replaces them (locked ones stay, a confirm dialog states the count).

---

## Agent Rail (right panel)

An always-on conversational agent (`AgentRail`) that has the whole DNA tree in context. The author can talk to it, ask it to revise a specific node, explain a scene's structure, or generate targeted content. It runs as a durable `book_agent_runs` tool loop, not one-shot. The rail is only shown once there's a tree (nodes.length > 0).

---

## Two special outputs: Visuals + Picture-book mode

- **Visuals section**: standalone control for the book's look (output mode toggle prose/picture, cast portraits — AI-generated with `ImageGenStudio`).
- **Picture-book mode**: in this mode, the Draft stage illustrates each scene (image + caption) instead of writing prose. The NodeCard adapts: a two-phase `compose → preview prompt → render` flow. The scene card shows the pinned illustration inline.

---

## Live projection

`DnaStudioPage` subscribes to Supabase Realtime on `book_nodes` + `books`. Any change (from any source — the agent rail, a parallel tab, an edge function) triggers a debounced reload. The studio is always a live projection of the tree, never fetch-once.

---

## Key state logic

- `view` ∈ `"overview" | "visuals" | StageKey` — what's open
- `expanded` — per-node collapse state, with a smart default (open = needs attention or has open expand targets)
- `flashId` — scroll-to + ring a specific node (from map drilldown)
- `busy` — a string label of the in-flight operation, used to show spinners and disable buttons
- Stage gating: `buildJourney(nodes)` computes each stage's status (`done | now | locked | available`) from the tree alone — no separate journey store

---

## What it does NOT do

- No approval/gate mechanism like the old Build Studio. The DNA studio has no "Approve & continue" stamped timestamps. Progress is just "is the tree populated and accepted."
- No manual outline. The outline was retired; scenes own their chapter boundary (`scene.content.chapter_start`).
- No revision chat per layer. The agent rail handles all conversation; there's no per-stage ReviseChat.

---

## Key files

| File | Role |
|---|---|
| `src/pages/books/dna/DnaStudioPage.tsx` | Page shell, Realtime subscription, data load |
| `src/components/book/dna/DnaStudio.tsx` | The whole 3-column layout, stage rendering, NodeCard, SortableBeatList |
| `src/lib/dnaJourney.ts` | Stage status computation, sub-step gating |
| `src/lib/novelDna.ts` | Node types, pure ops (lock/edit/status), staleness, validate, renderBlockers |
| `src/lib/dnaExpand.ts` | Client-side `expandNode` → calls edge fn |
| `src/components/book/dna/DnaOverview.tsx` | Overview dashboard (next move, shape, lints, threads) |
| `src/components/book/dna/DnaVisuals.tsx` | Visuals control room |
| `src/components/book/dna/DnaStageDiagram.tsx` | Per-stage shape diagram |
| `src/components/book/dna/DnaStoryMap.tsx` | Bird's-eye story map on Overview |
| `src/components/book/dna/DnaAnalysis.tsx` | Pacing / charge / promise analysis |
| `src/components/book/studio/AgentRail.tsx` | Conversational agent rail |
| `docs/novel-dna-spec.md` | Full data model + phasing |
| `docs/novel-dna-flow.md` | Generation order graph |
