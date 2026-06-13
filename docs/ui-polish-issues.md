# UI Polish Issues — Book Creation + AI Studio Flow

Tested: June 13 2026 · localhost:8080 · fresh book "UI Test Flow Book"  
Session 1: Book creation → Set Intention → Book detail → Brief → Foundations → Spine → Outline (timeout)  
Session 2: Edit flows — Brief edit, Foundations sub-tabs (all 5), Spine route-switching, revise action  
Session 3: Fixes applied (see bottom of each issue for ✓ FIXED status)

---

## 1. Book Creation (`/books/new`)

### 1a. Color tone picker cut off
The color swatches ("OR PICK A TONE") are below the fold on a standard viewport. First-time users may not discover them without scrolling.

### 1b. No CTA label differentiation for empty books
"Continue reading PAGE 1" appears on a book with **0 pages**. The label should be "Start writing" or "Add first page" — "Continue reading" implies existing content.

---

## 2. "Set Your Intention" Modal (6-step wizard)

### 2a. "Skip this" button retains maroon active state
After clicking "Skip this" to advance a step, the **next step** renders with "Skip this" already showing the maroon pressed/active background. It's a stuck `:active` CSS state being carried into the new render. Affects steps 4, 5, 6.

---

## 3. Book Detail Page

### 3a. "Manuscript 0" tab badge is ambiguous
The `0` after "Manuscript" looks like an unread badge. It is actually the page count. Consider using a different pattern (e.g., `Manuscript · 0 pages` on hover, or just hide the count when zero).

### 3b. `/books/[id]/build` direct URL is blank
Navigating directly to the `/build` subroute renders only the navbar — no content. If this URL is meant to be a deep-link destination it needs a redirect or a proper render; if not, it should 404 cleanly.

---

## 4. AI Studio — General (all steps)

### 4a. "View archived pages" bleeds into AI tools tab
The Manuscript tab's "View archived pages" button renders at the absolute bottom of **every** Build Studio step. It doesn't belong in the AI tools context.

### 4b. "THE BOOK · MAP" widget is unfinished
The widget at the bottom of the left navigator shows:
- `50% · 0 gaps` (updates to `100%` once Spine is approved)
- `● set  ○ empty  obj · beat · prose`

The labels are developer-facing and unexplained. "obj · beat · prose" means nothing to a first-time user. Either design this into a proper progress indicator with a label/tooltip, or hide it until it's ready.

---

## 5. Brief Step

### 5a. Genre double-entry
When "Fantasy" is selected in "Set Your Intention", it arrives in Brief as:
- The **Fantasy pill** selected (dark filled) — correct
- **"Fantasy" also typed** into the "Or type your own…" text field — redundant

The pill selection and the custom text input hold the same value simultaneously. Selecting a pill should clear the text field (and vice versa).

### 5b. Two ambiguous save actions
Inside the Creative brief card: **"Save brief"** (bottom right of card).  
Below the card: **"Approve & continue"**.  
The distinction is unclear. "Save" without approving, vs. save and move on — but nothing explains the difference at a glance.

### 5c. "2 of 6 filled" counter opaque
The counter shows how many fields have data but doesn't tell the user *which* are unfilled. A visual indicator on each unfilled field label would be more actionable.

---

## 6. Foundations Step — Sub-tab Inconsistencies

### 6a. "Skip" availability is inconsistent across sub-tabs
| Sub-tab | Skip available? |
|---------|----------------|
| ARGUMENT | ✓ "skip — use AI default" |
| ENDING | ✓ "skip — use AI default" |
| CAST | ✗ Must run AI (no escape hatch) |
| TENTPOLES | ✗ But has separate manual-entry path |
| VOICE | ✓ "skip — use AI default" |

CAST stands out — users who don't want AI-drafted characters have no way to bypass the "Draft the cast" step without manually adding via the subtle "+ add character" link.

### 6b. "+ add character" is too subtle
The manual character entry path is lowercase italic text `+ add character` below the AI button. It reads like a footnote, not a peer option.

### 6c. No auto-collapse of unchosen candidates
After selecting an argument, the other two candidates remain fully visible with no interaction affordance. The stage fills up with content the user dismissed. Consider collapsing them to a single-line summary on selection.

### 6d. All argument cards labeled "CANDIDATE"
Three identical "CANDIDATE" labels with no A/B/C or 1/2/3 distinction. Makes it impossible to refer to them verbally ("I want the second one") or skim quickly.

### 6e. Sub-tab dot-separator looks raw
The `—` separator between ARGUMENT, ENDING, CAST, TENTPOLES, VOICE tabs looks like unrendered punctuation. If it's meant to be decorative, it needs more intentional spacing/styling. If it's meant to show sequential flow, arrows or step numbers would be clearer.

### 6f. "Approve the foundations & continue" vs "Approve & continue"
The Foundations gate button is longer than Brief's. Minor inconsistency — either all approve buttons should name the step ("Approve the brief & continue", "Approve the spine & continue") or none should.

---

## 7. Spine Step

### 7a. Labeling inconsistency with Foundations/Argument
- Argument options: all labeled **"CANDIDATE"**  
- Spine options: labeled **"ROUTE 1"**, **"ROUTE 2"**, **"ROUTE 3"**

The Spine approach (numbered) is clearer. Argument should use the same pattern.

### 7b. Action button label inconsistency
- Argument: **"Select"**  
- Spine: **"Take this route"** → changes to **"Switch to this route"** after selection  

Same core action, three different labels. Pick one pattern.

---

## 8. Outline Step

### 8a. Loading state shows "Stop / Restart" instead of "cancel"
Every other step in progress shows inline italic `"Proposing candidates... cancel"`. The Outline step shows **"Stop   Restart"** as separate buttons. Different pattern, different weight.

### 8b. "This run looks stuck." message
A timeout watchdog appears after ~90s showing:  
> *"This run looks stuck."* **Stop**   **Restart**

The copy is refreshingly honest but informal. Consider: *"Still working — taking longer than expected."* Also the watchdog triggers on the **first** run for a complex outline, which may be an appropriate but jarring first experience.

### 8c. Outline generation times out on free plan
The Supabase free-plan edge function dies at ~150s. Generating a full novel outline (many chapters × pages as objectives) likely exceeds this. Functional issue but appears as a UI failure.

---

---

## 9. Edit Flow — Cross-cutting Issues

### 9a. No staleness warning when editing an approved step
Editing the Brief (changing genre, saving) shows a success toast but **does not warn** that Foundations and Spine were built on the prior brief. The "APPROVED" badge on Brief remains unchanged. Same pattern on Foundations and Spine: switching a candidate or route on an approved step silently updates with no signal to the user that downstream AI steps may now be stale.

### 9b. "APPROVED" badge is not revoked on edit
After saving a changed brief, Brief still shows "APPROVED" in the step header. After switching a Foundations argument candidate or Spine route, both steps still show "APPROVED". The badge implies "this is current and complete", but after an edit it is stale.

### 9c. Foundations approved card label says "APPROVED" (double with button)
On ARGUMENT and ENDING sub-tabs, the approved candidate card has the word "APPROVED" as its label in the card header, AND a separate "✓ Approved" button on the same card. The word "APPROVED" appears twice. Spine's equivalent reads "✓ APPROVED ROUTE · PINNED" in one line — that's cleaner and should be the pattern.

### 9d. ARGUMENT and VOICE sub-tabs show identical content
Both sub-tabs render the same 3 prose candidates (SPARSE AND CLINICAL / HAUNTED LYRICISM / FRACTURED RECKONING) with a shared selection state. Switching a candidate in ARGUMENT also changes VOICE. If intentional (samples serve dual purpose), the UI needs to communicate this — a user visiting both tabs assumes they are making two separate decisions.

### 9e. Regenerate action has 3 different labels across sub-tabs
| Sub-tab | AI redo action label |
|---------|---------------------|
| ARGUMENT | `regenerate` |
| ENDING | `regenerate` |
| CAST | `redraft with AI` |
| TENTPOLES | `propose more` |
| SPINE | `re-route (this one is held)` |

Pick one verb. The parenthetical on Spine ("this one is held") is useful information — that pattern should be consistent across all steps.

### 9f. Character WANT/WOUND/LIE fields appear read-only
The character attribute fields in CAST show as plain text visually (no border, no background, no hover affordance), but are actually editable textboxes. A user has no visual cue they can click and edit inline. At minimum, show a hover state or placeholder on empty fields.

### 9g. Tentpole proposals have no explicit "kept" state post-approval
All 6 AI-generated tentpole proposals show identical `keep / revise / kill` buttons after Foundations approval. None are visually marked as "kept". The "6 moments on the board" counter counts all proposals by default. It's unclear which ones the AI will actually use.

### 9h. "revise →" placeholder truncates visually
The inline revision input on the Spine approved route is a small fixed-height box. The full placeholder "What should change? e.g. "make it colder, less wistful" — the rest is preserved." is cut off visually. The box needs to be taller or the placeholder should be shorter.

### 9i. "revise →" label appears twice on the same card
The trigger link on the card is "revise →" and the confirm button inside the expanded form is also "Revise →". Same label for two different states of the same control.

### 9j. Pinned card disappears during loading (both ARGUMENT and TENTPOLES)
When `regenerate` or `propose more` is triggered on a sub-tab with a pinned card, **the pinned card vanishes during the loading state** across both sub-tabs. Only the KILLED card (TENTPOLES only) persists during loading with strikethrough + restore. The user's pinned work is not visible during generation, directly contradicting the "(your approved text is held)" hint.

**Post-loading behavior diverges by sub-tab:**

| Sub-tab | After loading completes |
|---------|------------------------|
| ARGUMENT | Pinned reappears at **bottom**, labeled "APPROVED · YOURS · PINNED" — inverted: new unfamiliar content is at top, user's anchor at bottom |
| TENTPOLES | Pinned reappears at **top** ✓ — correct; old neutral cards preserved in place below it; new AI cards appended at bottom; killed card stays in KILLED section |

ARGUMENT has two bugs (disappear during load + inverted order after). TENTPOLES has one bug (disappear during load) but the post-load order is correct.

**Correct pattern for both**: During loading, show the pinned card at the top in a "held" state (dimmed, with a spinner below) so the user knows their content is safe. After loading, pinned stays top, new candidates below — which TENTPOLES already does correctly post-load.

---

## Summary by Priority

| # | Issue | Severity |
|---|-------|----------|
| 2a | "Skip this" stuck active state | Medium |
| 1b | "Continue reading" on 0-page book | Medium |
| 4a | "View archived pages" in wrong tab | Medium |
| 4b | "THE BOOK · MAP" unpolished widget | Medium |
| 5a | Genre double-entry (pill + text field) | Medium |
| 3b | `/build` route blank page | Medium |
| 6a | Skip inconsistency across Foundations sub-tabs | Low–Medium |
| 6c | Candidates don't collapse after selection | Low |
| 6d | All candidates labeled "CANDIDATE" (no numbering) | Low |
| 7a | CANDIDATE vs ROUTE 1/2/3 labeling inconsistency | Low |
| 7b | Select / Take this route / Switch to this route — 3 labels | Low |
| 8a | Stop/Restart vs cancel loading pattern | Low |
| 5b | Two ambiguous save actions in Brief | Low |
| 6f | Approve button copy inconsistency across steps | Low |
| 6e | Sub-tab separator `—` looks raw | Low |
| 3a | "Manuscript 0" badge ambiguity | Low |
| 6b | "+ add character" too subtle | Low |
| 8b | "This run looks stuck." tone/copy | Low |
| **Edit flows (session 2)** | | |
| 9a | No staleness warning when editing approved brief/step | Medium |
| 9b | "APPROVED" badge not revoked on post-approval edit | Medium |
| 9d | ARGUMENT and VOICE sub-tabs show identical shared content | Medium |
| 9c | Foundations card header says "APPROVED" twice (label + button) | Low |
| 9e | Regenerate action has 5 different labels across sub-tabs | Low |
| 9f | Character WANT/WOUND/LIE fields look read-only (invisible edit affordance) | Low |
| 9g | Tentpole proposals have no "kept" state post-approval | Low |
| 9h | "revise →" placeholder truncates in small input box | Low |
| 9i | "revise →" label appears twice (trigger + confirm) | Low |
| 9j | Pinned card disappears during regeneration, reappears last post-gen | Medium |
