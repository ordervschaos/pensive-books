# Learning: Beats Step → Manual Editor (chat-first redesign)

## Concepts encountered

- **Chat-first UI pattern**
  - Name: AI generation moved out of the center stage into a sidebar chat
  - What: The center pane becomes a near-manual editor; the AI lives in the right rail (ReviseChat). The user talks to generate, not clicks in the center.
  - Here: BeatsStep/BeatSheet center stripped of per-page AI propose; ReviseChat layer="beats" is the AI surface.

- **Accordion editor**
  - Name: expandable list where each row opens in place
  - What: A UI list where clicking a row expands it inline, revealing a full editor without navigation.
  - Here: BeatSheet renders each beat page as a collapsible row; expanded row = full objective + beat textarea.

- **Autosave on blur**
  - Name: save-on-focus-loss
  - What: A form field that writes its value to the server automatically when the user tabs/clicks away, with no explicit Save button.
  - Here: `saveObj()` and `saveB()` are called on `onBlur` of the AutoTextarea fields in PageRow.

- **Drift pip / drift indicator**
  - Name: drift = objective changed after the beat was written; pip = small colored dot
  - What: A visual status badge (amber dot + "beat out of sync" label) that tells the author a saved beat no longer matches its objective. It's informational, not actionable in the center.
  - Here: `page.beat === "drift"` triggers `<Pip state="drift" />` in the accordion row header and a text label inside PageRow. Drift fix is removed from center; author asks the chat to re-plan.

- **Bulk build pipeline**
  - Name: whole-draft generate gesture
  - What: A single server-side job that plans beats for ALL gap pages at once (generate-book edge fn), then pauses for the author to approve before writing prose. Distinct from per-page AI propose.
  - Here: `runBulkBeats` / `runBulkProse` / `buildRow` (book_generations, kind="write_all") kept intact in BeatsStep. The Hero button and RunningCard/DoneStrip/RunningInline states all kept.

- **Cold-start empty state**
  - Name: the "nothing here yet" moment
  - What: When content is absent, a calm pointer text directs the user to the right place rather than presenting an AI generate button in the center.
  - Here: `!hasBeats && !buildActive && gapCount > 0` → "…or plan them in the editor on the right →" (mirrors SpineStep/FoundationsStep pattern).

- **Prop-driven discard affordance**
  - Name: controlled delete callback passed down
  - What: The parent owns the discard logic and passes `onDiscardAll` down to BeatSheet as an optional prop; BeatSheet renders a link only when the prop is present.
  - Here: BeatsStep passes `onDiscardAll={() => void discardAllBeats()}` to BeatSheet; BeatSheet renders `<ActionLink>discard all beats & prose, re-plan →</ActionLink>`.

- **Durable AI run (useAIRun)**
  - Name: server-owned task row that survives page refresh
  - What: A hook that creates/reattaches to a `ai_runs` row keyed by (bookId, kind, targetPageId). The run persists on the server; the client reattaches on reload.
  - Here: REMOVED from BeatSheet (per-page beat_candidates propose) and BeatsStep (cold-start beat_candidates). Generation now goes through ReviseChat edge fn only.

- **Panel variant="soft" vs "chosen"**
  - Name: studioUi Panel component visual modes
  - What: `soft` = low-contrast background for empty/editable fields; `chosen` = slightly highlighted for accepted/filled content.
  - Here: BeatSheet PageRow beat textarea now uses `variant={beat.trim() ? "chosen" : "soft"}` to visually distinguish empty vs filled beats.
