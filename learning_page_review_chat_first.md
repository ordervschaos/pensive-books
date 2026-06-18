# learning_page_review_chat_first

Concepts encountered while cleaning AI actions out of PageReview.tsx for the chat-first studio.

## Concepts

- **Chat-first studio** — architectural pattern where AI generation lives in a persistent side-rail (chat), and the center pane is a near-manual editor. Showed up as the reason to remove `DurableReviser`/`DurableOptions`/`ProseNodePanel` from the center and replace them with static read-only prose + calm pointer text.

- **Resolution ladder** — the objective → beat → prose hierarchy per page; each level gates the next (beat unlocks prose, beat unlocks scene). Showed up as the `LevelCard` stack in PageReview; beat-gate for prose and scene is kept even after AI removal.

- **Read-only prose rendering** — displaying content for reading without editing affordances. Used `ReactMarkdown` inside a `prose` Tailwind class block to mirror `ProseNodePanel`'s own display style, without wiring up any write/revise actions.

- **Empty-state pointer** — a calm text hint redirecting the user to where the action lives ("write it in the editor on the right →"). Replaces AI buttons with zero interaction cost. Showed up in both beat (empty) and prose (empty/no-beat) states.

- **Beat-gating** — locking a downstream level (scene, prose) until its upstream prerequisite (beat) exists. Preserved unchanged: `beatExists` prop drives `SceneLevel`; prose `LevelCard` checks `beat.trim()`.

- **Optimistic UI** — updating local state before server confirms, then reconciling on error. Showed up in `SceneLevel.remove` (scenes filtered immediately, re-fetched on failure).

- **Autosave on blur** — persisting edits when the user leaves a field rather than on a save button. Kept for both `saveObjectiveText` (on objective textarea blur) and `saveBeatText` (on beat textarea blur).

- **`busy` state narrowing** — TypeScript discriminated union `"objective" | null` instead of `"objective" | "beat" | null`; narrowed after removing the beat AI path so the type matches what's actually reachable.

- **`transforms` (ladder)** — helper that calls AI to derive a beat from an objective (`objectiveToBeat`). Import and usage removed entirely once `planBeat` was deleted.

- **Durable task UI components** (`DurableReviser`, `DurableOptions`, `ProseNodePanel`) — React components that wire up Supabase Realtime-watched task rows for long-running AI calls. All three removed from PageReview center; they remain in the right-rail context.
