# Learning: UI Consolidation — Shared Primitives

Concepts from extracting repeated UI patterns into a shared component library.

---

- **design token / CSS custom property**: a named variable (`--pv-accent`, `--pv-surface-2`) holding a style value; all components reference it so a theme change propagates everywhere. Showed up as `hsl(var(--pv-accent))/45` in every "chosen" card — the six-plus repetitions were the signal to extract.

- **structural deduplication** (refactoring strategy): finding identical or near-identical JSX trees repeated across files and extracting them into a single component with props for the varying parts. Showed up as the motivation for this entire task.

- **variant prop pattern**: passing a `variant` string (e.g. `"chosen" | "solid" | "soft" | "dashed"`) to a base component so callers name the intent, not the implementation. Added `variant="chosen"` to `Panel`; all six sites now use `<Panel variant="chosen">` rather than repeating the two CSS class strings.

- **PickButton**: a "toggle-to-confirm" button with two visual states: filled (selected/chosen) and outlined (available to pick). The selected state disables the button (`disabled={selected}`) so it's purely informational once picked. Used in NodeSub chosen candidates, and passed as a building block into OptionCard.

- **OptionCard**: a composite card component — `Panel` shell + a standard header row (`Eyebrow label | PickButton + optional X`). The children slot holds arbitrary content. This is a **slot pattern** (children prop), not a full render-prop pattern — callers own the body, the component owns the chrome. Used for cast proposals, spine route proposals, and argument/ending/voice candidates.

- **CollapsedRow**: a compact, single-line summary of a non-active candidate once a selection is made. Trades the full card for a truncated `label · text · switch · X` strip. Showed up in NodeSub (argument/ending/voice) where only the chosen candidate needs full display.

- **slot pattern** (React): passing `children` (or named render props) so a parent component can define structural chrome while the caller fills in content. OptionCard uses `children` as the body slot. Contrast with a **data prop pattern** where the parent controls all rendering.

- **tree shaking** (implicit): by consolidating six copies of the same CSS string into one component, future changes to the "chosen" style need one edit in `studioUi.tsx` rather than hunting across six files. A form of DRY at the style layer.

- **import footprint**: after consolidation, consuming files removed custom inline button JSX and plain `<div>` shells, replacing them with named imports. SpineStep lost its explicit `<X>` usage (now inside OptionCard) — removing it from lucide imports was a side-effect that proved the consolidation was real.

- **type annotation vs structural typing**: `useLocalSteer(): UseSteer` had an explicit return type annotation pointing to an unimported type. Dropping the annotation lets TypeScript infer the compatible shape, which is idiomatic for private helpers — explicit annotations are for public API surfaces.
