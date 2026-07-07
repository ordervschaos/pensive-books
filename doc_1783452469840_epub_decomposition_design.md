# EPUB → DNA tree: the decomposition (decompiler) design

**Status:** target = draft onboarding. **Layer A (P1) shipped 2026-07-08** — `lib/epubImport.ts` (parser) + `features/dna/lib/importEpub.ts` (adapter) + "Import an .epub" on `/books/new`; verified e2e (book 1233). Layers B (semantic ascent) not built.

## 1. Where this sits

The existing pipeline is a one-way compiler:

```
brief ──dnaExpand──▶ book_nodes tree ──novelDnaRender──▶ pages ──lib/epub.ts──▶ .epub
        (top-down generation)           (projection)          (export only)
```

The ask is the **inverse transform** — a *decompiler*:

```
.epub ──parse──▶ chapters/paragraphs ──adapter──▶ degenerate tree ──semantic ascent──▶ full DNA
      (mechanical, deterministic)     (reuse!)   (scenes w/ prose)  (LLM, bottom-up fold)
```

Prose = the compiled binary. DNA tree = the source. Import = lifting binary back to
source. That framing splits the problem into two layers with very different costs.

## 2. Layer A — mechanical decomposition (no LLM)

**The load-bearing discovery:** `features/dna/lib/migrateToDna.ts` →
`buildDnaFromStack(bookId, MigrationInput)` already builds a valid, provenance-stamped
DNA tree from `{brief, foundations, spine, pages}`:

- section page → `beat` (+ `chapter_start` on the first scene)
- text page → `scene` with `prose: {text, words}`
- placeholder `seed/premise/pillar` at the top
- `stampInput`/`stampProse` so day-one reads aren't falsely stale

So Phase 1 is an **adapter** (adapter pattern): `epubToMigrationInput(file): MigrationInput`.

Parsing steps (JSZip is already a dependency; `lib/epub.ts` is export-only today):

1. `META-INF/container.xml` → locate the OPF
2. OPF `<spine>` → reading-order list of XHTML files (+ metadata: title/author)
3. Per chapter XHTML: strip markup → plain text; chapter title from `nav.xhtml` / `toc.ncx` / first `<h1-2>`
4. **Scene segmentation** inside a chapter: split on break markers — `<hr>`, `* * *`,
   centered `***`, `⁂`, runs of blank space. Fallback: whole chapter = one scene.
5. Emit `MigrationPage[]`: one `section` page per chapter, one text page per scene.

Pure function, unit-testable with fixture epubs, no server involvement.

**Immediate payoff:** meters (`meterRead`), prose lints, cold read (`confusionRead`),
fact ledger, synopsis read all operate on prose-bearing scenes — they run on ANY
imported novel the moment Layer A lands. The analytics dashboards become a reading
instrument for published fiction.

## 3. Layer B — semantic ascent (LLM, "abductive inference")

The inverse of `dnaExpand`: infer the plan that best explains the prose. Shape is a
**map-reduce fold**, same silhouette as the incremental digest:

| Pass | Direction | What it infers |
|---|---|---|
| B1 map | per scene | goal, conflict, turn, value shift, POV, state keys |
| B2 fold | scenes → beat | summary, polarity, delivered promise |
| B3 segment | beats → acts | act boundaries (real inference — chapters don't announce them) |
| B4 crown | acts → premise/pillar | story shape, controlling idea, ending |
| B5 branch | whole book → entities | characters, relationships, world_facts, threads, tentpoles |

- Rides the durable-task + self-chain infra (150s worker ceiling; per-scene calls chain cleanly).
- B5 is `read-facts`-style entity extraction pointed at a new target.
- Cost ballpark: per-scene reads on the OpenRouter qwen tier ≈ a few dollars per novel, likely much less.

## 4. The epistemological flip (round-trip fidelity)

| | Generated book | Imported book |
|---|---|---|
| Ground truth | tree | **prose** |
| Prose | projection, regenerable | sacred, `locked: true, status: "accepted"` |
| Plan rungs | authored/derived | **inferred guesses**, `source: "ai"`, correct hashes |

Guard: tree edits + re-render must never clobber the original author's words. Locked
prose + honest provenance stamps encode that. Consider a book-level `imported` flag.

## 5. Use cases (why bother)

1. **Study mode** — decompose published novels along the same axes you generate along.
2. **Sequel canon** — extract the `books.canon` packet from book 1's epub; write sequels to anything.
3. **Onboarding** — writers with an existing draft enter the Studio without retyping.
4. **Self-eval round-trip** — tree → prose → decompose → diff trees = "how much of the plan survived into the prose", a novel eval signal.

Copyright note: personal-analysis tooling is fine; keep derived trees of copyrighted
work off the published/marketing surface.

## 6. Phasing

- **P1 (recommended first bite):** `epubToMigrationInput` adapter + Import-epub entry → `buildDnaFromStack`. Pure, an afternoon, immediately useful via the sensing passes.
- **P2:** per-scene semantic read (B1).
- **P3:** upward fold + entity branch (B2–B5).
- **P4:** act segmentation polish, thread/obligation reconstruction, canon extraction.

## 7. Named concepts

- **Decompilation / inverse transform** — recovering source from a compiled artifact; here: plan from prose.
- **Adapter pattern** — new input format shaped into an existing interface (`MigrationInput`) so the downstream machine is reused untouched.
- **Abductive inference** — inference to the best explanation; every inferred plan node is a hypothesis about authorial intent, not a fact.
- **Map-reduce fold** — per-scene map, then hierarchical reduce up the ladder.
- **Provenance stamping** — `src_hash`/`prose_src_hash` set at import so the staleness system doesn't fire falsely.
- **Round-trip fidelity** — guaranteeing encode(decode(x)) doesn't destroy x; here via locked prose.
- **Degenerate tree** — structurally valid but semantically empty top rungs (Layer A output before Layer B fills it).
