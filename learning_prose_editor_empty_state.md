# Learning: Prose Editor Empty State Fix

## Concepts Encountered

- **Page-scoped vs. book-scoped mode (same component, two contexts)**
  - A single `ProseEditor` component handles both "Draft step / whole book" and "open a page / single page" by presence of `pageId` prop.
  - Showed up: action links at the bottom were guarded `if (pageId == null)`, so page mode had zero affordances — a blank composer with revision-flavored placeholder.

- **Empty-state affordance gap**
  - When the first thing a user is expected to do is click a button that doesn't exist yet, the feature silently fails. The page had the right UI structure (rail opened with ProseEditor) but was missing the primary CTA for the empty/first-write case.
  - Showed up: "write the next page" navigation landed on a page-scoped ProseEditor with no "write from beat" trigger, only a text composer the user didn't know to use.

- **Affordance vs. auto-trigger**
  - Auto-triggering an AI run on navigation would be aggressive (user might just be reviewing). A one-click chip is the right level — explicit intent, zero friction.
  - Showed up: added `ActionLink` chip "Write this page from its beat" that calls `start({ instruction: "Write this page from its beat." })` directly.

- **Placeholder text as a hint system**
  - Placeholder copy shapes the user's mental model of what the field is for. Revision-flavored placeholder ("Make this page colder…") misleads a user who hasn't written the page yet.
  - Showed up: updated placeholder to include `"Write this from the beat"` as the first example.
