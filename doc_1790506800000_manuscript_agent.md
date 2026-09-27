# The manuscript agent, and why it stages instead of writes

You open a book at `/books/:slug/agent`. On the left, a chat. On the right, the book itself, one page at a time. You type "tighten the second paragraph of The Door." A few seconds later the paragraph on the right grows a red strike and a green run: the old clause, the new clause. Nothing in the database has moved yet. That is the whole idea, and everything else in this feature follows from it.

Here is the break it avoids. The Studio's agent works on the story's DNA, a tree that is *rendered* into pages. An agent that wrote straight into pages would be a second author with the same pen as you, and the two of you would write over each other: it rewrites a paragraph while you are mid-sentence in it, and whoever saves last wins. Nobody would be careless. The page would simply have two hands on it and no rule about whose is heavier.

The fix is one rule. The agent may only *propose*. Every change it wants lands in a list on its run row, as data (`book_agent_runs.proposals`), and the only code that ever writes a page or the book's title is in your browser, when you click. A proposal that sits in a list, waiting for a hand to move it, is called a **staged change**; the list of them is a **changeset**. The place you review it, with old text red and new text green, is a **diff**, and the smallest unit you can accept inside a paragraph, a run of changed words, is a **hunk**.

Why it matters here: because the diff is computed against the *live* page, not the page the agent saw. If you edit a paragraph after the agent proposed on it, your edit shows up as more red and green, honestly, instead of being silently overwritten by "accept all." The proposal carries a `before` snapshot for the record, but the canvas never trusts it. That single decision is what lets in-place editing and the agent work hand in hand.

```
  chat ──propose_changes──▶ proposals[] (staged)
                                │  you click ✓ (hunk / block / page / all)
                                ▼
                     resolve(liveText, after) ──▶ pages / books
```

## Where it sits

Two agents, two substrates. The Studio agent (`book-agent`) reads and proposes over `book_nodes`, the story tree. The manuscript agent (`manuscript-agent`) reads and proposes over `pages` and `books`, the book. They share one durable-run table (`book_agent_runs`, discriminated by `kind`), one AI chokepoint (`_shared/llm.ts`), one cancel path (`lib/stopRun`), one session-archive mechanism. The watchdog that revives a stalled run now looks at `kind` to know which function to poke. This is the reuse that made the feature affordable: a second agent cost a new tool belt and a new canvas, not a new runtime.

## The projection

Pages are TipTap JSON. The model never sees it. Both sides project a page to plain text: paragraphs separated by one blank line, `## ` headings, `- ` lists, `*italic*`, `**bold**`. The server's copy (`manuscript-agent/shared.ts`) and the client's (`lib/manuscriptText.ts`) must be byte-identical, because the server derives the agent's `before` from the same page the client re-projects; any drift would paint phantom diffs. Going back is the interesting half: `docFromBody` rebuilds a page from text but *reuses the original JSON node for every block whose text did not change*, so accepting a one-word fix leaves the rest of the page's formatting, ids and marks untouched. This is a **format-preserving inverse**.

## The diff engine

`lib/manuscriptDiff.ts` runs two **longest-common-subsequence** diffs: blocks first (the line level), then words inside a block that changed in place. A deleted block and an inserted block only pair up as "modified" when they are alike enough (a similarity threshold), so an unrelated rewrite reads as one red block and one green block, not word confetti. `resolve(diff, decisions)` is the single write formula: it returns the page's new text (live text with accepted hunks folded in) and the proposal's new text (rejected hunks dropped). When the two are equal, nothing is left to review and the change resolves into an "Accepted" card in the chat. State change, not erasure.

## What the smoke test taught

Three things, all found on a scratch book, none visible from the code.

The editor autofocuses on mount. A guard that said "don't take server updates while focused" therefore kept a stale pre-accept snapshot on screen, and one keystroke would have saved it back over the accepted hunk. The guard now keys on whether the editor has *diverged* from what it last agreed with the server, not on focus.

Realtime dropped two run-row updates in one session: the server had staged three changes and the tab sat on "thinking…". Realtime is a signal, not a ledger. While a turn is active the page now also polls the row every five seconds, and after every click that resolves a change it re-reads the row rather than waiting for its own write to echo back.

The cheap "name this chat" call ran on a reasoning model with a 30-token cap. Reasoning bills inside `max_tokens` on that tier, so the completion came back empty and every chat stayed untitled. Small caps on reasoning tiers are a trap; the cap is now 300 with low effort.

## Build on top

New change kinds go in the `ManuscriptChange` union (both mirrors), get validated in `exec-tools.ts`, written in `acceptChange`, and painted in `SidePanel`/`PageCanvas`. New smart chat units are result-blind tools that push an `action` step; `ChatStep` renders them and the page shell handles them. Page moves, merges and splits are the obvious next kinds. An auto-accept mode would be the Studio's watcher pattern over `acceptChange`.
