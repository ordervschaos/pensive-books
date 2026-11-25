# Agentic writing: lessons from Dottr

2026-11-23. Compared the manuscript agent with `~/Code/dottr/dottr` (the current app,
not the archived versions). First slice implemented locally; deployment and a live model
check remain outstanding.

The strongest lesson is continuity between the conversation and the work: the assistant knows
what is open, names things consistently, and gives the person a direct path from an answer
to the thing it concerns. Pensive already has a useful word-level review canvas. Make that
canvas part of the conversation before adding more agent controls.

## What transfers

| Dottr pattern and source | Pensive opportunity |
| --- | --- |
| Send-time canvas context (`actions/canvas.py`, `agent.jsx`, map `agent_door.md` CVS) | “Tighten this page” should resolve to the page open when sent, even if the author navigates during the turn. |
| Document links and a shared object title (`doclinks.js`, `components/ai/object-line.jsx`) | Page references should open the manuscript beside the conversation; the composer and message receipt should use the same page name. |
| Reach the assistant from the working pages (`docs/where/agent.md`) | Authors should be able to ask from the regular editor without reconstructing context on a separate route. |
| Keep new work visible without taking over the person's view (`agent.jsx`, MKC/EVC) | Make a proposed page easy to open. Any future automatic opening should respect what the author is already reading and run only for fresh results. |
| Durable runs and between-step steering (`door/agent/agent.py`, AG2A/AG2B) | Let authors correct direction while the agent works; a dropped browser connection should not change the job. |
| Fold whole turns; keep personal preferences separately (RSM/MEM) | A long conversation needs bounded context, persistent author intent, and manuscript evidence with clear provenance. |

## Implemented first slice

- The composer names the open canvas: book details, an existing page, or a proposed new page.
- Every new message and answer carries only a typed target (kind and id). The edge function
  verifies page membership and archive state against the authorized book; new-page targets
  must be current `page_add` proposals. Names come from stored rows, not the request.
- The checked target and label are kept with the message step. A separate reference block
  in the transcript lets replay see the original send-time context; the standing-task echo
  excludes the metadata. Existing clients and historical messages still work without it.
- Message receipts link back to the original target while it exists. Navigating elsewhere
  does not retarget the receipt. Resolved proposals and deleted pages retain their words.
- New agent replies can use `[p3 “Title”](?page=123)` links. Only live page ids in this book
  become canvas links. Links retain the id through insertions, renames, and reordering.
  Older plain `p3` references stay plain: their original index cannot be safely reconstructed.
- Fresh chats offer relevant prompts for a page, a whole manuscript, or an empty book.
  A starter fills an editable draft before sending. The composer grows with the draft and
  Enter does not submit during input-method composition.

This remains a staging agent: the author reviews and accepts edits. Canvas context is an
anchor, not a restriction on explicit requests about other pages. It carries no page body;
the agent still reads current text with its tools.

## Recommended next work, in order

1. **Attach a passage from the editor.** Select text → Ask the agent. Show a removable quote
   and its page, using the same receipt pattern. Capture the document revision and a precise
   range; resolve against current text before editing. A selection that changed should be
   reported, not silently matched to a similar passage. Account for pending autosaves.
2. **Make the agent available beside the normal editor.** Preserve the current page when
   opening it and reuse the existing manuscript thread and review components. Authors should
   choose a writing task; the application can route story planning to Studio when appropriate.
   This does not require merging the DNA and manuscript data models.
3. **Finish the bounded-context work already designed.** The existing
   [context-budget proposal](../doc_1790512000000_context_budget.md) addresses a known
   whole-book failure. Enforce the budget and add content-hashed digests before broadening
   whole-book automation. Keep author preferences separate from observations about a draft.
4. **Allow steering between steps.** Queue an author's correction durably and acknowledge
   it immediately. Enforce a single writer per thread and idempotent tool execution before
   allowing new input during a run. Retain a visible Stop and reconnect from stored state.
5. **Strengthen the revision trail.** Pair accepted changes with recoverable versions and
   Undo. Bind proposals to the revision read, distinguish later author edits, and make
   “Accept all” explain conflicts before writing. Keep broad revisions deliberate until
   this recovery path exists.

## Validation and release

The manuscript suite has 40 passing tests, including target validation, foreign/archived pages,
proposal resolution, stable page links, send-time receipts, question answers, retry restoration,
and repeated optimistic messages. Web typecheck, scoped lint, edge `deno check`, and the web
production build pass. The local signed-in UI was inspected on scratch book 1467: moving from
book details to The Door updates the composer context.

Deploy the web app and `manuscript-agent` together. No database migration is needed. The local
UI currently uses the deployed function, so a live model check of this new prompt/protocol
has not been claimed. After deployment: send “tighten this page,” navigate to another page
while it runs, check the proposal targets the original, then follow its page link. Repeat
with an answer to an agent question and with an invalid/stale target.
