# Learning: State Axis — Three Ledgers for Story Generation

## Concepts encountered

- **Resolution ladder**
  - Literal: a hierarchy of increasing detail/resolution
  - What it is: top-down decomposition — brief → spine → objectives → beats → prose; each rung refines the previous
  - In this task: the existing generation pipeline; vertically perfect, horizontally stateless

- **State axis**
  - Literal: a second dimension that runs parallel to the ladder, flowing forward in time
  - What it is: data that accumulates as the story progresses (character state, causality, open loops) and feeds each new step
  - In this task: the missing half — without it you get "and then... and then..." instead of a story

- **Character ledger**
  - Literal: a running account of each character's inner and outer inventory
  - What it is: per-character struct tracking want/wound/believes/knows/feels/has, updated at each beat
  - In this task: needs to be seeded at `spine-to-objectives` and updated in `objective-to-beat`, stored in `pages.metadata.character_states`

- **Character arc (as a diff)**
  - Literal: arc = the path; diff = the difference between two states
  - What it is: the arc of a character is the difference between their initial state object and their final state object
  - In this task: made computable if character state is a structured object updated per beat

- **Causality constraint (therefore/but rule)**
  - Literal: logical connective between beats
  - What it is: Trey Parker/Matt Stone's rule — story beats must connect with "therefore" or "but", never "and then"
  - In this task: enforced in the `objective-to-beat` prompt by passing the preceding beat and requiring a causal or conflictual connection

- **Episodic drift**
  - Literal: episodes = self-contained; drift = gradual divergence
  - What it is: the AI-fiction failure mode where each scene is internally fine but globally unconnected — "and then" plots
  - In this task: the root cause of incoherence the causality constraint directly kills

- **Value flip (McKee's scene rule)**
  - Literal: a value at stake changes polarity within a unit
  - What it is: every scene must move a value (safe/endangered, ignorant/aware) from one state to the other; a beat that flips nothing gets rejected
  - In this task: added as a constraint in the beat prompt — beats must identify a value and resolve it differently than they found it

- **Promise/payoff ledger (open loops)**
  - Literal: a promise is a setup; payoff is the resolution; ledger = running record
  - What it is: tracks every narrative setup (planted question, foreshadowing, gun on a mantel) with its intended resolution page; page-turners are mechanically managed open loops
  - In this task: threads already planned in `spine-to-objectives`, but never injected into renders; need status tracking (planned/setup_written/paid_off)

- **Context packaging**
  - Literal: assembling a package of context for the renderer
  - What it is: the act of deciding what information flows into each AI call — prose coherence is a context-assembly problem, not a generation problem
  - In this task: `buildUnitContext()` in `generate-unit-core.ts` is the insertion point for all new state

- **Snowflake method (Randy Ingermanson)**
  - Literal: start from a simple shape and recursively add detail, like a snowflake
  - What it is: a story-writing method that decomposes from premise → paragraph → page; adds character sheets as a parallel track
  - In this task: the existing ladder is isomorphic to Snowflake; the character ledger is the parallel track Ingermanson explicitly prescribes

- **Scene & Sequel (Dwight Swain)**
  - Literal: scene = active conflict; sequel = reactive recovery
  - What it is: every beat has a goal/conflict/disaster (scene) followed by a reaction/dilemma/decision (sequel); gives each beat an engine
  - In this task: referenced as the structural engine behind beats — beats should be written as scene+sequel pairs, not just summaries

- **Ephemeral cache control (Anthropic API)**
  - Literal: ephemeral = short-lived; cache control = instruction to the API on what to cache
  - What it is: the `cache_control: { type: "ephemeral" }` field on message blocks tells Anthropic to cache that block across calls with the same content; the stable prefix is cached, the variable part (current page) is not
  - In this task: the `stablePrefix` / `variablePart` split in `generate-unit-core.ts` exists specifically to maximize cache hits; new state (character states, open loops) must go in `variablePart` to preserve this

- **Self-chaining edge function**
  - Literal: a function that re-invokes itself for the next unit of work
  - What it is: Supabase edge functions have a ~150s wall-clock cap; `generate-book` works around this by writing one page per invocation and then fire-and-forgetting a call to itself for the next
  - In this task: character state flows naturally between pages because each invocation reads fresh state from the DB before proceeding
