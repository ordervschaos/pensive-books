---
description: Evaluate a book's manuscript against the fiction rubric and write an editor's-read report
argument-hint: <bookId>
allowed-tools: Bash(node scripts/fetch-book.mjs:*), Read, Write
---

You are a seasoned developmental fiction editor. Evaluate the book with id **$1** against the project's fiction rubric and write an editor's-read report the author can act on. You (Claude Code) are the evaluator — do not call any external model API.

## Steps

1. **Download the manuscript.** Run `node scripts/fetch-book.mjs $1`. This writes `reports/$1-manuscript.md` (book metadata, the author's brief if set, and every text page with its `id:` and `page_index`).
2. **Load the rubric.** Read `knowledgebase/evaluation/fiction-evaluation-criteria.md` in full. These are your standards.
3. **Read the manuscript** at `reports/$1-manuscript.md`.
4. **Evaluate.** Work through every rubric section. Maintain the 60/40 reading stance — surrender to the story, but stay observant of craft. Identify the **genre contract first**; if an author brief is present, treat it as the contract to judge against, otherwise infer it and say so. If the brief indicates non-fiction, stop and tell the user the non-fiction rubric isn't wired up yet.
5. **Write the report** to `reports/$1-<slug>-read.md` (slug = a kebab-case of the book name) in the format below. **Also write the raw `result` object on its own to `reports/$1-read.json`** (just the JSON, no markdown) — the UI bridge reads this file.

## Discipline (this is what makes it useful, not generic)

- **Evidence for every claim.** Quote the exact phrase or moment from the manuscript. Refuse generic superlatives ("thrilling", "compelling") — be specific and concrete.
- **Cite the page.** For every issue, reference the page using ONLY the `id:` values from the manuscript file. Use `null` page for issues not tied to a single page (e.g. overall genre/length).
- **Actionable.** Each issue gets a concrete suggestion for revision, not just a complaint.
- **Honest but constructive.** This is feedback the author will use to revise — name real problems, including hard structural ones (passive protagonist, abandoned setups, continuity breaks, missing obligatory scenes), but frame them as fixable.

## Report format

A markdown file with two parts:

**Part 1 — human-readable:**

```
# The editor's read — *<book name>*

> Book id <id> · ~<N> words · <pages> pages · evaluated by Claude Code · <date>

## Editorial letter
<2–4 sentence holistic read: what the book is, its core strength, its most urgent problem>

**Genre contract:** <what you identified>
**Stance:** <short label, e.g. "promising premise, early draft — needs structural revision">

### Fix these first
1. <highest-leverage fix>
2. <next>
3. <next>

## Section findings
### <Section> — `<strong | solid | needs work>`
<the editor's assessment, prose>
- **Strength:** <evidence-backed positive>
- **⚠ high** — <issue> · *evidence:* "<quote>" · *page:* "<title>" (id <pageId>) · → <suggestion>
- **● medium** — ...
- **· low** — ...
(one block per rubric section present: Character, Plot, Pacing, Dialogue, Prose & Style,
 Genre Contract, World-Building, Emotional & Thematic Resonance, Presentation & Mechanics)
```

**Part 2 — the structured `result` JSON** (the shape a future in-app `book_evaluations` row would store), in a fenced ```json block:

```json
{
  "verdict": { "genre_contract": "...", "stance": "...", "letter": "...", "priorities": ["...", "...", "..."] },
  "sections": [
    {
      "id": "character",
      "title": "Character",
      "stance": "needs work",
      "assessment": "...",
      "strengths": ["..."],
      "issues": [
        { "severity": "high", "note": "...", "evidence": "...", "suggestion": "...", "page_ref": { "id": 0, "title": "...", "index": 0 } }
      ]
    }
  ]
}
```

`stance` ∈ `strong | solid | needs work`. `severity` ∈ `high | medium | low`. `page_ref` is either `{id,title,index}` (using a real page id) or `null`. Section `id`s: `character, plot, pacing, dialogue, prose, genre_contract, world_building, resonance, mechanics` (emit only those that apply).

After writing the file, give the user a 2–3 line summary of the verdict and the path to the report.
