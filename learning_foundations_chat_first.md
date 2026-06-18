# Learning: Foundations Step — Chat-First Studio Rewrite

## Concepts encountered

- **Chat-first UI pattern**
  - *What it is:* Generation/AI surfaces live in a persistent side-rail chat; the center is a plain manual editor.
  - *How it showed up:* Moved all `useAIRun` / proposal / options / skeleton UI out of FoundationsStep into the ReviseChat rail. Center now only does create/edit/delete.

- **Near-manual editor**
  - *What it is:* A UI where the author can create and edit everything by hand; the AI is a collaborator, not a gatekeeper.
  - *How it showed up:* NodeSub, CastSub, TentpolesSub are all plain textarea/input editors with autosave-on-blur; no generate buttons.

- **Autosave on blur**
  - *What it is:* Persisting data when an input loses focus, not on a submit button.
  - *How it showed up:* Every textarea calls `pinNode` + `writeFoundations` in its `onBlur` handler, only if the value changed.

- **`pinNode` (pin semantics)**
  - *What it is:* A function that stamps a node as author-touched (`pinned: true`, `author_edited_at`), making it protected from AI overwrite.
  - *How it showed up:* Called in NodeSub's `handleBlur` whenever the author edits argument/ending/voice text.

- **Dual-use empty state**
  - *What it is:* Empty state shows a "go to chat" pointer AND a textarea so the author can also type directly — no dead ends.
  - *How it showed up:* NodeSub empty branch renders the chat pointer paragraph plus a soft Panel with a textarea below it; mirrors SpineStep pattern.

- **Pin toggle as AI lock**
  - *What it is:* Pinning a cast field or tentpole signals "do not overwrite" to the AI agent.
  - *How it showed up:* TentpoleCard shows "locked from AI" label on pinned cards; cast fields show a Pin icon with tooltip "Lock this field — the AI won't overwrite it". Tooltip wording updated from old "Pinned" to "locked from AI" to make the semantics legible.

- **Unified tentpole list (drop two-column split)**
  - *What it is:* Old UI had Pinned / Proposals columns because proposals came from the center AI. With proposals moving to chat, there's only one column.
  - *How it showed up:* TentpolesSub now renders all live tentpoles in a single `space-y-2.5` list; the old `grid-cols-2` / `pinnedCards` / `proposalCards` split is gone.

- **`writeFoundations` + `mirrorVoice` (dual-write)**
  - *What it is:* Voice exemplar is stored in `books.foundations.voice_exemplar` AND mirrored to `books.bible.voice_sample` for backwards compatibility with prose renderers.
  - *How it showed up:* `mirrorVoice` in FoundationsStep's voice save callback — kept exactly as before.

- **`CastLook` (appearance + portrait set)**
  - *What it is:* Per-character visual description + a set of AI-generated or uploaded reference portraits for scene coherence.
  - *How it showed up:* Kept verbatim inside CastSub; no changes — it has no AI-gen UI of its own (ImageGenStudio handles that separately).

- **`foundationsProgress` (completion check)**
  - *What it is:* Derives a `Record<FoundationsStepKey, boolean>` from a Foundations object to drive the progress strip dots.
  - *How it showed up:* Drives the sub-step pill strip (check icon + accent color when done).

- **Prop surface reduction**
  - *What it is:* Simplifying a component's props by removing features that moved elsewhere.
  - *How it showed up:* `beforeGen`, `steer`, `heroTitle`, `heroSub`, `blockedReason` (renamed `blocked`) removed or simplified; final Props shape is `{ bookId, foundations, onChanged }`.
