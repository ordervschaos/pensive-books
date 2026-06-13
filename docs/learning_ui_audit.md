# Learning: UI Audit Session — Build Studio Flow

## Concepts Encountered

- **UI Audit / Heuristic Evaluation**: Systematic walkthrough of a product to spot friction, inconsistency, and unfinished elements. Shown up as the task itself — walking each step of the flow and noting what breaks the mental model.

- **Active/Hover CSS state persistence**: CSS `:active` pseudo-class can "stick" visually if a component unmounts/remounts while the pointer is still down or if state isn't reset. Showed up in "Skip this" button carrying maroon fill into the next wizard step.

- **Loading state pattern (optimistic vs descriptive)**: Inline status text ("Proposing candidates... cancel") vs discrete buttons ("Stop / Restart") are two different patterns for showing async work in progress. Inconsistency spotted between Outline and all other steps.

- **Wizard / multi-step modal**: A sequential dialog where each step asks one question. The "Set Your Intention" 6-step modal is this pattern. Key concern: state (CSS active) should be reset between steps.

- **Gate / sign-off UX**: Intentional approval moment ("Approve & continue") that marks a checkpoint in a multi-stage AI workflow. Shown on every Build Studio step as the hand-off from review to commitment.

- **Auto-collapse of candidates**: After picking one option from a list, hiding or collapsing the unchosen options reduces cognitive clutter. Not implemented in Argument step — issue #6c.

- **Bleed-through UI (tab isolation bug)**: When a component renders content meant for one tab inside another tab's DOM subtree. "View archived pages" from Manuscript tab appearing in AI tools tab is this.

- **Edge function timeout**: Serverless functions have wall-clock time limits. Supabase free-plan ~150s. The Outline generation hit this limit, causing a functional failure that reads as a UI hang.

- **Watchdog / stale-run detection**: A timer that fires if a background task hasn't updated in N seconds, surfacing a "stuck?" message. The Build Studio has this — appears as "This run looks stuck." + Stop/Restart.

- **Candidate labeling / scanability**: When presenting multiple AI-generated options, numbering (ROUTE 1/2/3) aids verbal reference and scanning. Unlabeled "CANDIDATE" for all three argument options makes them indistinguishable.

- **Double-representation bug**: Same value stored in two UI controls simultaneously (pill selected + text field contains same text). Creates ambiguity about which is authoritative. Seen in Genre field of Brief.

- **Staleness / invalidation UX**: When a user edits an upstream artifact (e.g. the brief) that downstream AI steps were generated from, the UI should warn that those downstream steps may now be stale. Absence of this warning leaves the user with a false sense of coherence. Observed: editing the Brief post-approval shows no warning that Foundations/Spine are now potentially misaligned.

- **Approval badge decay**: A status badge ("APPROVED") should reflect the current state, not the state at last commit. If the user edits a step after approval without re-approving, the badge becomes misleading. Observed across Brief, Foundations, Spine.

- **Invisible edit affordance**: Editable fields styled without visual indication (no border, no background, no hover ring) look read-only. Users won't attempt to click them. Seen on character WANT/WOUND/LIE textboxes in CAST sub-tab.

- **Shared state across sibling views**: Two distinct UI sub-tabs (ARGUMENT and VOICE) can share the same underlying data and selection state. If unintentional, it's a bug; if intentional, the UI must communicate that the two views are a single decision, not two. Seen in Foundations ARGUMENT ↔ VOICE showing identical candidates.

- **Action verb proliferation**: The same conceptual action (ask AI to regenerate this section) surfaces under 5 different labels across sub-tabs (regenerate / redraft with AI / propose more / re-route). This inflates the user's mental model unnecessarily.

- **Inline revision pattern**: An affordance where clicking "revise" expands an inline text input asking "what should change?" — the AI then rewrites the artifact incorporating the delta. The confirm button is disabled until text is entered (good). Placeholder text can truncate in fixed-height boxes (bad). Seen on Spine approved route.

- **Additive vs replacement generation**: `propose more` appends new candidates to the existing list (old + new visible simultaneously). `regenerate` replaces all non-pinned candidates with fresh ones. These are distinct interaction models, and their post-loading card ordering should each be intentional. TENTPOLES (additive) puts pinned at top, old in middle, new at bottom — a clear layered history. ARGUMENT (replacement) puts new at top and pinned at bottom — inverted compared to what would feel anchored.

- **Killed card persistence across loading**: In TENTPOLES, a "killed" card (explicitly rejected with "NOT THIS" signal) persists visually during loading with strikethrough + restore affordance — the user can still undo before the next generation commits. Pinned cards do not get the same treatment (they disappear during loading despite being the user's strongest commitment). The asymmetry is a bug: the weaker signal (kill) persists; the stronger signal (pin) vanishes.
