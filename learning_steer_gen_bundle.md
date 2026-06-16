# Learning: Steer + Generate Bundle

Concepts from bundling steer input with generate actions as a unified UI primitive.

---

- **compound action** (UX pattern): two related controls (steer input + generate button) grouped visually so the user understands they're a unit. Showed up as `GenRow` — always rendered together, no toggle.

- **ephemeral vs persistent steer** (state model): ephemeral steer (`useLocalSteer`) lives only for one generation call and is never saved; persistent steer (`useSteer`) writes to `books.steers` and persists across sessions. Both satisfy the same `UseSteer` interface, so `GenRow` works with either.

- **prop threading** (architecture tradeoff): to avoid passing `steer` through 4 component levels (StudioStage → BeatSheet → Carousel → BeatModal → PageRow), PageRow uses a local ephemeral steer instead. Works because per-beat steer is naturally one-shot.

- **proposal vs auto-apply** (UX pattern): instead of immediately overwriting the current beat when AI returns a result, show the result as a "Proposed" card the user explicitly accepts or dismisses. Showed up when removing `useEffect` auto-apply in `PageRow`.

- **chosen-card** (UI convention): a Panel with accent border containing the current committed value (editable). Showed up as the beat's chosen state in PageRow replacing a plain textarea.

- **early return removal** (React anti-pattern fix): initial hero states in Foundation NodeSub/CastSub and Spine were early returns that hid the steer input. Moved steer inline below the Hero so it's always visible.

- **cascade prop** (design concern): steer needed to reach BeatsStep from StudioStage. Added `steer: UseSteer` to BeatsStep and SpineStep props; StudioStage stops rendering the top-level `<SteerField>` for those steps.
