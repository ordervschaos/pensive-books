# Learning: Studio primitives (Pass 1 standardization)

Named concepts encountered while extracting reusable UI atoms for the AI-tools studio.

- **Design primitive / atom**
  - "Primitive" = the smallest reusable building block of a design system.
  - A small component (Eyebrow/Panel/ActionLink) that bakes in tokens so call sites compose instead of pasting class strings.
  - Here: added 4 to `studioUi.tsx`; converted ~6 step files to use them.

- **DRY (Don't Repeat Yourself)**
  - Each piece of knowledge has one authoritative representation.
  - We had ~38 copies of the accent-link button and ~30 eyebrow spans, all subtly disagreeing; collapsed to one source.
  - Here: `RunError` literally re-defined per file → moved to one export.

- **Single source of truth**
  - One canonical place a fact lives; everything else references it.
  - Eyebrow size/tracking/color now decided once, not re-decided per span.
  - Here: the robustness win — busy/disabled/error states can't drift between call sites.

- **Variant / prop-driven API**
  - One component, a `variant`/`tone` prop selects a bounded set of looks.
  - `Panel variant="solid|soft|dashed"`, `ActionLink tone="accent|muted|faint"`.
  - Here: keeps the component count low while covering the real cases seen in the code.

- **Composition over configuration**
  - Build UIs by nesting small components rather than one mega-component with many flags.
  - `Eyebrow` + `Panel` + `ActionLink` nest freely inside each step's bespoke layout.
  - Here: stateful/selected cards stayed bespoke; only their repeated insides were swapped.

- **tailwind-merge (twMerge)**
  - Resolves conflicting Tailwind utility classes so the *last* one wins.
  - Lets `Panel` ship a default `px-6 py-5` that a caller can override with `className="px-5 py-4"`.
  - Here: confirmed `cn()` wraps clsx + twMerge before relying on overrides for shade/padding.

- **Controlled vs uncontrolled inputs**
  - Controlled = React state drives `value`; uncontrolled = DOM holds it (`defaultValue` + read on blur).
  - `AutoTextarea` had to size in both modes: resize on `onInput` (typing) *and* every render (mount/value change).
  - Here: cast want/wound/lie are uncontrolled (`defaultValue`+`onBlur`); PageReview's beat/objective are controlled.

- **Eyebrow (typographic term)**
  - A small uppercase label sitting above a heading/section (the "kicker").
  - The `pv-mono uppercase tracking` labels throughout the studio.
  - Here: standardized as the `Eyebrow` component; a `pv-eyebrow` CSS class already existed but was barely used.

- **Token (design token)**
  - A named design value (color/space/font) referenced instead of a raw literal.
  - `hsl(var(--pv-accent))`, `--pv-surface-2`, defined in `packages/shared/src/styles/tokens.css`.
  - Here: primitives reference tokens so they theme with the Paper DS automatically.

- **Phased rollout**
  - Ship a large change in deliberate passes to bound risk and allow review.
  - Pass 1 = high-value pure-presentation atoms; Pass 2 = `RunningInline` + `FieldRow`.
  - Here: I converted the canonical instances and intentionally left tightly-tuned micro-links for Pass 2.
