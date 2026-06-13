# Learning — AI tools dedup + scan (2026-06-13)

Concepts encountered while consolidating the AI edge-function codebase.

- **DRY (Don't Repeat Yourself)** — principle: every piece of knowledge has one authoritative place.
  - Here: ~18 copies of Claude-response text extraction, 12 of JSON extraction, 5 of `tiptapToText`, 4 of `parseOptions` collapsed into 3 shared helpers.

- **Chokepoint / single source of truth** — one function all callers route through, so a fix lands everywhere at once.
  - Here: `textFromClaude` in `claude.ts` (already the chokepoint for the API call itself); `extractJsonBlock`/`parseJsonOptions` in the new `_shared/json.ts`.

- **Prompt-cache parity (byte-for-byte)** — Anthropic caches a prompt prefix; one changed byte = cache miss + possibly different model output.
  - Here: the constraint that kept me out of `briefContext`/prompt text — I only touched response *parsing* and *formatting*, never the bytes sent to the model.

- **Tolerant / lenient parsing** — accept slightly-malformed input instead of failing (models wrap JSON in ```fences``` or stray prose).
  - Here: `extractJsonBlock` prefers a fenced block, else slices first `{`/`[` to last `}`/`]`. Adopted the more-robust object|array form that had drifted into only `foundations-core`.

- **Re-export** — `export { x }` after `import { x }` so a module exposes a name it doesn't own.
  - Here: `generate-unit-core` re-exports `tiptapToText` from `words.ts` so `generate-book`'s import keeps working unchanged.

- **Dead code** — code that exists but is never reached/imported.
  - Here: `words.ts` already had the canonical `tiptapToText` but *nothing imported it*; consolidation made it live.

- **Latent bug / silent failure** — wrong code that doesn't throw, just quietly does the wrong thing.
  - Here: `revise-outline` filtered threads on `t.id`, but the query never `select`ed `id` → `undefined` → scoped revisions silently got zero threads. Surfaced only by the type checker.

- **Structural typing** — TypeScript matches types by shape, not by name.
  - Here: `deno check` flagged `Property 'id' does not exist on ThreadLite` because the interface's shape lacked `id` — the shape, not a declared name, caught the bug.

- **Generic variance (covariance/contravariance)** — whether `Container<A>` is assignable to `Container<B>` when `A`/`B` relate.
  - Here: the noise errors (`SupabaseClient<…"public"…>` not assignable to `<…never…>`) are a version-skew variance mismatch in supabase-js generics — pre-existing, ignored.

- **Magic string** — a bare literal repeated in code instead of a named constant.
  - Here: `"claude-haiku-4-5-20251001"` in 3 spots → exported `DEFAULT_LOW_MODEL`.

- **Map-reduce** — split work into parallel slices (map), then combine (reduce).
  - Here: `evaluate-core` splits the *report* (not the book) across parallel calls that each read the whole manuscript, then a verdict call synthesizes — to dodge the worker wall-clock.

- **LLM-as-judge** — use a model to score another model's output against its instructions.
  - Here: `judge.ts` (the `ai_call_evals` judge) and `beat-core`'s `pickBestBeat` (a model picks the strongest of N candidate beats).

- **Centralized authorization** — one gate function every protected entry point calls, so the access rule can't drift.
  - Here: `hasEditAccess` in `_shared/access.ts` (promoted from generate-book's `canEdit`) replaced the inline `book_access` "accepted" check copied into 16 functions. Owner short-circuits a now-needless query.

- **Short-circuit evaluation** — stop as soon as the result is known (`A && B` skips B if A is false).
  - Here: `hasEditAccess` returns `true` immediately when `ownerId === userId`, skipping the DB round-trip the old inline check always ran.

- **Verification gap** — claiming "done" without a way to prove it.
  - Here: no `deno` initially → installed it; learned the repo can't `deno check` cleanly without `nodeModulesDir:"auto"` (no committed deno.json), and that `EdgeRuntime` is a Supabase-injected global absent in bare Deno.
