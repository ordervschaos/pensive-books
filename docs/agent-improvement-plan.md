# Agent improvement — implementation plan

> Derived from [`agent-improvement-analysis.md`](./agent-improvement-analysis.md), 2026-07-02.
> This plan sequences the findings, tags **ownership** (🧠 = needs judgment / architectural, kept
> in the main thread; 🤖 = mechanical / behavior-scoped, delegated to a background Sonnet agent),
> and states a success criterion per item. Ordering follows the analysis's own "Recommended order":
> the §1 root-cause port is the enabler for §1b/c, §2a/b/c.

> **Status (2026-07-02):** Phase 0 + P1.1 + P1.2 shipped to the working tree, reviewed.
> - **Phase 0** (§1a/§2d/§4c) — `deno check` clean (only the pre-existing `EdgeRuntime` baseline).
> - **P1.1** — `_shared/novel-dna.ts` edge twin (Deno-clean).
> - **P1.2** — `_shared/dna-journey.ts` (objective-derivation twin; `dnaHealth` omitted) + `threadSystem`
>   now recomputes `currentObjective` + `analysisText` from the LIVE tree each chain link (client
>   `analysis`/`objective` kept only as fallback). Sources `books.mode`; `bookSlug = String(bookId)`.
> - **Parity lock**: `novelDna.parity.test.ts` — 40 assertions across `validate`/lints/objective over prose
>   + picture modes, both fixtures. `pnpm typecheck` clean except one **pre-existing** `DnaTreePage.tsx:1708`
>   error (untouched file). tsconfig aliases the edge twins' `jsr:` type import to the installed npm package.
>
> - **P2.1** — beatsheet lint-then-repair in `dna-expand`: after the sanitizer, `validate()` the candidate
>   sheet (existing tree + candidate beats, beats-only), filter to beat-native rules (`uncaused_therefore`,
>   `empty_but`, `beat_connector`, `illegal_resolution`, `unresolved_game` — scene/tentpole-placement lints
>   excluded as beat-stage false positives), and on hits run ONE bounded repair call. Non-regressing (accept
>   the repair only if it doesn't raise the lint count) and best-effort (any failure keeps the original sheet).
>   Rule selection locked by `dnaBeatLints.test.ts`.
>
> - **P2.2** — plan-conformance verify: new `_shared/plan-gate.ts` (`judgeAgainstPlan`) judges a scene's prose
>   against its OWN DNA plan slice (value_shift, goal/outcome, establishes/needs, resolved-thread work) —
>   the causal edges ARE the verification context. `check_against_contract` gains a `check` param
>   (`plan`|`mandate`|`both`, default `both`); it builds the plan slice from the scene, resolves thread
>   ids→names, and reports both perspectives. Verified by `deno check` + inspection (the judge needs a live
>   model; `plan-gate` can't be vitest-imported — pulls `llm`/`task`, same as `mandate-gate`).
>
> - **P2.3** — enforced render→verify: `maybeInjectRenderVerify` at the top of `advance()` (auto mode only).
>   After an applied prose render (the render is the prior assistant turn; the client has written the prose and
>   resumed us), it runs the P2.2 plan-conformance judge on the rendered scene(s) and INJECTS the verdict into
>   the transcript before this turn's model call — verify is now a structural step the cheap model can't skip,
>   with an instruction to fix any FAIL first. Plan-only (mandate is book-level). Guarded (auto + last-assistant
>   -is-render + not-already-verified via `VERIFY_SENTINEL` + scene has prose+plan), best-effort (any error →
>   original transcript, loop never breaks), bounded (≤3 scenes/turn). Shared `planConformanceSummary` helper
>   used by both the tool and the auto-verify. Verified by `deno check` + inspection (needs a live model/run).
>
> **Phase 2 complete.** Next: P3 data-structure (§3b continuity-digest delta is independent + clean) and P4
> prompting (§4a batch edits; §4c model tuning on the seams). Note: §4c left `dna-expand:418` on
> `getActiveModels().high` (one shared `model` var feeds prose *and* the beatsheet; clean split → P4).

## Dependency map

```
§1 root cause: ship engine to edge  ──┬──► §1b/c live re-derivation (threadSystem)
  (novelDna.validate + dnaJourney)    ├──► §2c lint-then-repair beatsheet
                                      └──► §2b plan-conformance verify
§4c per-role model config ── independent
§1a scene drafted marker  ── independent
§2d field-aware search    ── independent
§3a/§3b/§3c/§3d data-structure ── ride alongside; §3b independent, rest interact with §1
```

---

## Phase 0 — delegated now (🤖 background Sonnet, independent of everything)

These need no new infrastructure and are behavior-scoped. Delegated as one serial batch to avoid
same-file (`book-agent/index.ts`) write conflicts.

### P0.1 — §4c per-role model config (plumbing, behavior-preserving)
- **Change:** in `supabase/functions/_shared/model-config.ts`, add a per-role resolver so callers can
  ask for `agentModel` / `structureModel` / `proseModel` instead of a single `high`. Every role
  **defaults to today's `high` string** — this commit changes no runtime behavior; it only creates
  the seams. Establishes the `DIGEST_MODEL`-style per-role pattern the doc calls for.
- **Consumers to re-point (keep behavior identical):** `book-agent/index.ts:298,731` (→ `agentModel`),
  `dna-expand/index.ts:418` (prose render → `proseModel`; beatsheet/structure call at `:580` →
  `structureModel`).
- **Success:** diff is pure plumbing; `getActiveModels()` still returns `{high, low}` for existing
  callers; new `modelForRole(role)` (or extended return) resolves to the same strings today.
- **Left for main thread (🧠):** the actual per-role *assignments* (which model wins prose vs JSON per
  tier) — that's a benchmark/quality judgment, tuned after the seams exist.

### P0.2 — §1a scene digest drafted marker (one line)
- **Change:** in `digestNode` (`book-agent/index.ts:855`), for `kind === "scene"` append a drafted
  marker to the digest line: `prose: "1,842w"` when `content.prose.words > 0`, else `undrafted`.
  Word count already lives at `content.prose.words` (written by `dnaExpand.ts:221`).
- **Success:** every scene digest line now answers "is this drafted?" at a glance; drafted scenes show
  the word count, undrafted show `undrafted`. No other digest fields change.

### P0.3 — §2d field-aware `search_nodes`
- **Change:** rewrite the `search_nodes` handler (`book-agent/index.ts:676`) to iterate each node's
  content **fields** (string values), match the needle per-field, and return `field: "…snippet…"`
  labels instead of a substring over `JSON.stringify(content)` (which leaks field names/JSON escapes).
- **Success:** a search for a motif returns `[id] scene · prose: "…the brass keyring…"` — the matching
  field is named, snippet is clean text (no `\"`/`{}` noise). Keep the 30-hit cap + `more` counter.

> Verification note: edge functions don't `deno check` cleanly locally (missing `EdgeRuntime` /
> remote-import types). The agent mirrors existing patterns, keeps diffs minimal, and the main thread
> reviews. No web-side (`novelDna`/`dnaExpand`) files are touched in Phase 0.

---

## Phase 1 — the enabler (🧠 main thread)

### P1.1 — §1 root cause: ship the pure engine to the edge
- `novelDna.ts` (`validate`, meters) + `dnaJourney.ts` (objective/step derivation) are pure,
  dependency-light TS. Port them to a Deno-importable `_shared` module (or the `dna-schema.json`
  artifact + golden-test pattern already used for `NODE_SCHEMA`), so `threadSystem()` can recompute
  live from the tree.
- **New files only** (`_shared/…`) — deliberately does **not** edit `book-agent/index.ts` yet, so it
  can land in parallel with Phase 0.
- **Success:** a golden test proves the edge port and the browser engine return identical
  `validate()` output for a fixture book; module imports under Deno.

### P1.2 — §1b/c live re-derivation in `threadSystem`
- With P1.1 landed: `threadSystem()` (`book-agent/index.ts:1157`) recomputes objective + drafted map +
  lints from the **live tree every chain link**, instead of reading the frozen `context_objective` /
  `context_analysis` snapshots. `autoContinue` stops carrying stale `TARGET NODE: scene 14`.
- **Success:** in an auto run, after scene 14 renders, the next turn's system prompt names scene 15 as
  target and shows refreshed lints — verified by log/trace, not by transcript memory.

---

## Phase 2 — the first eval-loop teeth (🧠 main thread, after Phase 1)

### P2.1 — §2c lint-then-repair on the beatsheet
- After the sanitizer (`dna-expand/index.ts:590-612`) drops orphans/dupes, run the (now edge-available)
  lints over the candidate sheet; on errors, **one bounded repair call** listing the violations.
- **Success:** a sheet that previously shipped a silent `dangling_promise` now either repairs it or
  surfaces it — no silent degradation.

### P2.2 — §2b plan-conformance verify mode
- `check_against_contract` gains a mode that loads the scene's **own plan slice** (`value_shift`,
  `establishes`, `threads`, `register`) and verdicts prose per field — using the scene's DNA edges as
  the verification context.

### P2.3 — §2a enforced read-repair chain
- In auto mode, the server chain runs the contract check after an applied prose render **structurally**
  (render→verify→fix), not as a recipe the cheap model may skip.

---

## Phase 3 — data-structure health/cost (🧠, can interleave)

- **§3b** ✅ SHIPPED — continuity-digest delta storage (`dna-expand`): `prose_digest` now stores this page's
  DELTA (`line` + bounded ledger/impressions snapshot) instead of the full `value` accumulator; `buildProseDigest`
  reconstructs `pages[]` from the deltas on read. O(n) storage, not O(n²). Hash basis unchanged (still hashes the
  in-memory `accum`), so cache-chain invalidation is byte-identical to before; `DIGEST_VERSION` 2→3 retires old
  full-accumulator entries. Verified by a standalone simulation (reconstruction == naive oracle; fresh read = 0
  re-folds; O(1)/node storage).
- **§3a** transcript per-message rows / compaction (schema + Realtime; higher risk).
- **§3c** ✅ SHIPPED — state-key canonicalization. New pure `canonicalizeKey(key, known)` in the engine (+twin,
  parity-locked): snaps an open-vocabulary key to a near-duplicate already in use (edit-distance ≤ 2, min
  length ≥ 6) so `redemption_fund`/`redemption_funds` don't split the causal DAG. Wired into the `dna-expand`
  beatsheet as a deterministic two-pass (fold establishes into a canonical set → snap needs onto it) BEFORE
  the P2.1 lint, so the fix doesn't depend on the repair model. Scenes inherit the canonical keys via §3d.
  Tested (`dnaBeatLints.test.ts` + parity).
- **§3d** ✅ SHIPPED — `realizeScenesFromBeat` (web `dnaExpand.ts`) now distributes the beat's causal state by
  role: `needs` (consumed at entry) → FIRST scene, `establishes` (produced when the turn lands) → LAST scene
  (co-located with `grounds_in`/`resolves`), instead of piling both on scene 0. Single-scene beats keep both
  (first === last). Makes the P2.2 plan-conformance check accurate per scene. Covered by `dnaExpand.test.ts`.
  (Full *per-key* semantic distribution across middle scenes would need the scenes-generation LLM + a DB
  schema-config change — deferred; the middle "develop" scene's plan is its value_shift.)

## Phase 4 — remaining prompting (🧠)

- **§4a** auto mode batches independent edits into one call (fewer cache-miss cycles).
- **§4b** beatsheet truncation-aware continue/repair (or per-act generation).
- **§4c (tuning)** assign the real per-role models on the P0.1 seams.

---

## Ownership summary

| Item | Owner | Depends on |
|------|-------|-----------|
| P0.1 §4c plumbing | 🤖 Sonnet | — |
| P0.2 §1a marker | 🤖 Sonnet | — |
| P0.3 §2d search | 🤖 Sonnet | — |
| P1.1 engine→edge | 🧠 main | — |
| P1.2 re-derivation | 🧠 main | P1.1 |
| P2.1 beatsheet repair | 🧠 main | P1.1 |
| P2.2 plan-conformance | 🧠 main | P1.1 |
| P2.3 read-repair chain | 🧠 main | P1.1, P2.2 |
| P3.* data structure | 🧠 main | §3b none; rest P1.1 |
| P4.* prompting | 🧠 main | P0.1 for §4c tuning |
