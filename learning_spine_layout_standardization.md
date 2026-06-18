# Learning: Prose Editor Rail Layout Standardization

## Concepts encountered

- **Three-region flex layout (header / scroll / composer)**
  - Literally: a vertical flexbox split into three zones with distinct overflow behavior
  - A CSS pattern where a fixed-height container uses `flex flex-col h-full` to let one region grow/scroll while the others stay anchored
  - Showed up as the shell of `ReviseChat` (and now `ProseEditor`): `shrink-0` header + `min-h-0 flex-1 overflow-y-auto` middle + `shrink-0` bottom

- **`shrink-0`** (Tailwind / CSS `flex-shrink: 0`)
  - Literally: "do not shrink this flex child"
  - Prevents a flex item from compressing when siblings compete for space
  - Used on the header and composer so they hold their natural height regardless of the scroll region's content

- **`min-h-0`** (CSS `min-height: 0`)
  - Browsers default flex items to `min-height: auto`, which prevents them from shrinking below their content height
  - Setting `min-h-0` breaks that floor so `flex-1` + `overflow-y-auto` can actually scroll instead of expanding the parent
  - Critical on the middle region — without it the scroll region would push past the rail boundary

- **`flex-1`** (Tailwind / CSS `flex: 1 1 0%`)
  - Makes the element grow to fill all remaining space not claimed by `shrink-0` siblings
  - Applied to the scroll region so it fills the gap between header and composer exactly

- **`overflow-y-auto`**
  - Shows a vertical scrollbar only when content overflows the element's bounded height
  - Enabled on the scroll region so long step feeds / done reports don't burst out of the rail

- **Layout-only refactor**
  - A code change that reorganizes JSX structure and CSS classes without touching state, handlers, props, or business logic
  - The entire task was this pattern: wrap existing JSX in new `<div>` regions and swap the root container's class

- **Rail (UI pattern)**
  - A vertically-oriented sidebar panel that flanks a main content area; fills the parent's height
  - Both `ReviseChat` and `ProseEditor` render in `StudioEditorRail`'s `h-full` aside; the three-region layout is what lets them fill it cleanly
