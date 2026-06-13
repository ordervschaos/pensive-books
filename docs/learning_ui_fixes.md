# Learning: UI Polish Fixes — Build Studio + Book Detail Flow

## Concepts Encountered

- **`:active` CSS state bleed across re-renders**: When a button's `:active` state fires on click and React re-renders the same DOM node (e.g., dialog step advancing), the pseudo-class can stick visually because the browser hasn't received a pointer-up event from React's synthetic handler. Fix: `onMouseUp={(e) => e.currentTarget.blur()}` forces the element to lose focus/active state immediately. Shown in "Skip this" button across intake wizard steps.

- **Pill + text field dual representation**: Two controls bound to the same state field (genre pill + text input) show the same value simultaneously. The invariant: if a standard option is selected via pill, the custom text box should be empty (they're mutually exclusive). Fix: `value={SUGGESTIONS.includes(draft.field) ? "" : draft.field}`. Shown in genre field of both BriefIntakeSheet and BookBriefSection.

- **Tab isolation**: UI that's only relevant to one tab (e.g., "View archived pages") must be rendered inside that tab's conditional block, not outside it. When placed outside, it renders on all tabs — a bleed-through bug. Shown in BookDetails.tsx where archived pages link was outside the tab condtionals.

- **Conditional badge rendering**: A count badge (Manuscript · 5) with value 0 is ambiguous — it reads like an unread count, not a content count. Pattern: hide badges at zero or use a different state label. `{pages.length > 0 && <span>{pages.length}</span>}`.

- **Candidate collapse after selection**: When an AI proposes 3 candidates and the user picks one, the other two remain visible with no interaction affordance. Pattern: after selection, collapse non-selected to compact rows (label + truncated text + "switch" CTA). Reduces cognitive clutter. Implemented in FoundationsStep NodeSub.

- **Candidate ordering invariant**: After regeneration, a user's pinned card (their approved text not in new candidates) should appear at the TOP as the visual anchor, with new proposals below it. The opposite (pinned at bottom) forces the user to scroll past unfamiliar content to find their work. Moved pinned card rendering to before the candidates map in NodeSub.

- **Pinned card visibility during loading**: During AI generation, showing a dimmed "Held through generation" version of the pinned card in the loading state reassures the user their work is safe. Without it, the pinned card disappears and contradicts the "(held)" hint. Implemented in NodeSub's generating branch.

- **Invisible edit affordance**: Editable fields styled with `border-none bg-transparent` look read-only. Adding `border-b border-transparent hover:border-[soft]` gives a subtle underline hint on hover without changing the layout. Shown in CAST sub-tab WANT/WOUND/LIE fields (AutoTextarea).

- **Regenerate label consistency**: Using different verbs for the same conceptual action (`redraft with AI`, `regenerate`, `propose more`) across sub-tabs inflates the user's mental model. Normalizing to "regenerate" (with parenthetical context for meaningful distinctions) reduces that overhead. `propose more` kept for additive TENTPOLES (semantically distinct).

- **Approve button copy pattern**: All gate buttons should consistently name the step they approve: "Approve the brief & continue", "Approve the foundations & continue", etc. One inconsistency (Brief using "Approve & continue") makes the copy feel like a different kind of action.

- **Stale watchdog copy**: "This run looks stuck." is honest but informal. "Still working — taking longer than expected." is calmer and doesn't imply failure. Small copy change in RunControls.

- **Confirm button label disambiguation**: An inline revision flow has two "Revise →" labels: the trigger link and the confirm button inside the expanded form. Disambiguate: trigger = "revise →" (opens form), confirm = "Apply →" (submits instruction). Shown in DurableReviser.

- **Primary vs secondary action hierarchy**: In a list where the primary action is "add character" (creates something) and the secondary is "regenerate" (AI-assisted), making the primary action more visually prominent (accent color) and secondary action more muted (text-muted) matches conventional button hierarchy. Swapped in CastSub.

- **Autosave on blur vs explicit save button**: Removing an explicit "Save" button and saving on `onBlur` for text fields reduces cognitive friction — the user doesn't need to remember to save. Pill/toggle controls (no blur event) must call save immediately on click by computing the new value inline before calling `setDraft`, since `setState` is async and the save function would otherwise read stale state. Pattern: `const next = { ...draft, ...patch }; setDraft(next); doSave(next)`. Shown in BookBriefSection.

- **Async setState and immediate save**: When an event handler needs to both update state AND immediately persist the new value, `setState(patch)` is NOT yet reflected in subsequent synchronous code. Must derive the next value inline and pass it directly to the save function. Never call `save(draft)` right after `setDraft(newDraft)` — `draft` is still the old value until the next render.

- **Stale closure in React useEffect (deps discipline)**: If a `useEffect` has `onSave` in its closure but `onSave` is NOT in the deps array, the effect captures the `onSave` from the render when the effect LAST FIRED — not the current render. This is safe only if the effect re-runs (deps change) whenever `onSave` changes. In NodeSub, the effect fires when `run.run?.status` changes; at that point it captures the latest `onSave`. Risk: if `onSave` changes between effect runs (e.g., due to a background state update), the next fire would use a stale `onSave`. Mitigation: use `useRef` to always hold the latest callback.

- **Cross-contamination investigation vs data hygiene**: When two UI components show identical AI-generated content, the cause is often historical DB contamination (a prior code iteration wrote data to the wrong field) rather than a live code bug. Systematic analysis should trace: (1) backend output shape per step, (2) DB row `target_key` filtering at the Realtime layer, (3) `onSave` closure correctness, (4) React tree position of components. If all four check out, suspect stale DB data. Shown in 9d: ARGUMENT showing labeled (VOICE-style) candidates.

- **Skip vs generate — same action, different intent communication**: In a multi-step AI wizard, "skip — use AI default" and the primary "Generate" hero button can invoke the same backend action. The distinction is UX: the hero button says "I want to see proposals and choose," the skip link says "I don't want to engage, just give me something." For sub-steps where the AI output is auto-accepted (CAST), skip IS the same action — but the label manages user expectation. Shown in CAST sub-tab 6a fix.
