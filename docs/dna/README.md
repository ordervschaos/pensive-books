# Novel DNA — a guided walkthrough

A teaching-oriented tour of the DNA build system: how one `brief` becomes a book
by walking a self-similar `book_nodes` tree down a resolution ladder, and how the
agent drives that walk. Read in order, or jump to a rung.

- **[00 · Pipeline overview](00-pipeline-overview.md)** — the whole ladder on one
  page; the cross-cutting invariants; the driver in brief.
  Artifact: https://claude.ai/code/artifact/ca9cbe0b-4643-4d2f-9c73-57cffc171bbc
- **[01 · Seed & Premise](01-seed-premise.md)** — brief → logline → central question.
- **[02 · Foundations](02-foundations.md)** — the pillar + the entity branch (the materials).
- **[03 · Structure](03-structure.md)** — acts + the global beat-sheet pass (the causal DAG).
- **[04 · Scenes](04-scenes.md)** — each beat projected into value-turning units.
- **[05 · Prose](05-prose.md)** — the two-hop render + rolling digest + read-repair.
- **[06 · Driver](06-driver.md)** — the self-chaining agent loop that moves a book
  through all of the above.
  Artifact: https://claude.ai/code/artifact/e8306f59-bc9d-41e3-a87f-89c8ceac49d1

> Authoritative specs live alongside as `docs/novel-dna-spec.md`,
> `docs/novel-dna-schema.md`, `docs/agent-rail.md`, etc. This folder is the
> narrative walkthrough that ties them together; the feature manifest is
> `apps/web/src/features/dna/FEATURE.md`.
