# Agent guidance system — interview-first discovery, three-state objective

**Status:** ratified 2026-07-13 (owner + decision-maker session). This is an EXECUTABLE plan for an
implementing agent. Decisions below are final — do not relitigate them; if a step is impossible as
written, stop and report rather than substituting a different design.

## Why (one paragraph)

Today's guidance measures only tree completeness: `currentObjective` (dna-journey twins) walks
premise → foundations → structure → scenes → draft and always prescribes "mint the next artifact."
Two failure modes: (1) on a fresh book the right move is **elicitation** — interview the author to
extract the book in their head — not "generate logline options"; (2) the objective is injected into
every turn even when the author typed a concrete ask, polluting intent. Fix: a **discovery regime**
(interview rung + a durable vision document) and a **three-state objective injection policy**.

## Ratified decisions (do these, in this shape)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Where the vision document lives | `books.brief.vision` — a new jsonb section inside the existing `brief` column. **No DB migration.** |
| D2 | How the agent writes it | New **non-terminal** tool `update_vision`: direct write (no proposal/review), shallow per-section merge, logged as a visible step. Rationale: it records the author's own words, not agent invention. |
| D3 | Where the interview lives in the journey | New FIRST substep of the **premise** stage: Interview → Seed → Premise. Visible in the journey UI. Grandfathered done for existing books (see gate below). Skippable client-side. |
| D4 | Objective injection policy | Three-state, **interactive mode only**: concrete ask → OMIT `<current_objective>` entirely; Next-nudge (`context_follow_objective=true`) → inject; empty ask → inject. **AUTO mode always injects** (the objective is auto's work queue — omitting it breaks full-book builds). |
| D5 | Vision rendering blast radius | `briefContext()` renders vision ONLY behind a new opt `vision: true`. Only book-agent's `threadSystem` passes it in v1. Every other call site (prose gen, evaluate, expand…) keeps byte-identical prompts. |
| D6 | Proactive opener | NO server-initiated turns. The existing scripted greeting + "next step" card in `AgentRail.tsx` carries the interview kickoff (it already sends `isNextStep: true`). |
| D7 | Signature change | `currentObjective(nodes, { bookSlug?, brief? })` and `stageSubsteps(key, nodes, brief?)` — brief is optional; absent brief + grandfather clause keeps old call sites safe. Both twins + parity test updated together. |

## The vision schema (D1)

Add to the `Brief` interface (BOTH copies — `supabase/functions/_shared/brief.ts` and the web twin;
grep `interface Brief` under `apps/web/src` to find it):

```ts
/** The interview's artifact: everything the author has in their head, captured section by
 *  section during discovery. Free text per section. compiled_at marks the interview done. */
export interface BriefVision {
  characters?: string;      // who they have in mind — names, roles, sketches
  world_setting?: string;   // place, time, rules, atmosphere
  plot_points?: string;     // anything they already know happens
  themes_aims?: string;     // what the book is FOR — aims, arguments, feelings to land
  influences?: string;      // comps, authors, tones to echo or avoid
  constraints?: string;     // non-negotiables (POV, content lines, length, structure)
  open_questions?: string;  // what the author is still unsure about
  notes?: string;           // anything that fits nowhere else
  compiled_at?: string;     // ISO timestamp — set by update_vision {compiled:true}; the done-gate
  skipped?: boolean;        // author skipped the interview (client-side gesture)
}
// on Brief:  vision?: BriefVision;
```

## Phases — do them in order; each ends with a verification gate

### Phase 1 — Brief type + renderer (foundation)

1. Add `BriefVision` + `Brief.vision` to `supabase/functions/_shared/brief.ts` and the web Brief type.
2. In `briefContext(brief, opts)` add `opts.vision?: boolean` (default false). When true and
   `brief.vision` has any filled section, append after the existing lines:
   `- Vision (the author's own intent, captured in interview — honor it as ground truth):` then one
   indented `  - <Section label>: <text>` line per non-empty section (skip `compiled_at`/`skipped`).
3. **Gate:** `cd supabase && deno check functions/book-agent/index.ts` clean; run the web typecheck
   `cd apps/web && npx tsc -p tsconfig.app.json` (bare `tsc` is a no-op in this repo) clean; confirm
   with a quick unit-style check that `briefContext(x, {})` output is byte-identical to before for a
   brief WITH a vision (the flag defaults off — this is D5's byte-stability guarantee).

### Phase 2 — Journey twins: interview rung + recipe (the semantic core)

Files: `supabase/functions/_shared/dna-journey.ts` and `apps/web/src/features/dna/lib/dnaJourney.ts`.
These are parity-locked twins — make the changes **verbatim identical** in both, then update
`apps/web/src/features/dna/lib/novelDna.parity.test.ts` to pass a brief through both copies.

1. `stageSubsteps(key: StageKey, nodes: DnaNode[], brief?: Brief | null)`: in the `premise` branch,
   prepend an `interview` spec before `seed`:
   ```ts
   const seedDone = /* existing seedDone expr */;
   const visionDone = !!(brief?.vision?.compiled_at || brief?.vision?.skipped) || seedDone; // grandfather: past seed ⇒ interview moot
   return resolveSeq([
     { key: "interview", label: "Interview", done: visionDone, ready: true },
     { key: "seed", label: "Seed", done: seedDone, ready: visionDone, manual: true },
     { key: "premise", label: "Premise", done: accepted(premise) && premiseFilled(premise), ready: seedDone },
   ]);
   ```
   `stageComplete` / `buildJourney` are **unchanged** (the stage gate stays seed+premise; interview
   only moves the "now" pointer inside the stage — existing books cannot regress).
2. `currentObjective(nodes, opts: { bookSlug?: string; brief?: Brief | null })`: pass `opts.brief`
   into the `stageSubsteps` call. No other logic change.
3. Add `STEP_RECIPE.interview` (verbatim, both twins):
   ```
   interview: "INTERVIEW the author — do NOT generate story content yet. Your job this step is to get the book out of their head into the brief's vision document: the characters they have in mind, the world/setting, plot points they already know, what the book is FOR (aims, themes, the feeling it should land), influences/comps, non-negotiables, and what they're still unsure of. Ask 2–3 focused questions at a time (never a wall of questions), reflect their answers back in your own words, and ideate WITH them — offer directions when they're blank, name what's strong when they're vague. After EVERY exchange that surfaces something new, call update_vision with just the sections that changed — capture as you go, don't batch it for the end. When the vision has real substance across most sections and the author signals they're ready (or has nothing to add), summarize the whole vision back in a few lines, get their yes, then call update_vision with compiled: true — the journey then advances to the seed on its own. If the author says skip the interview, tell them they can skip it from the journey strip, or capture whatever one line they give you and compile."
   ```
4. **Gate:** parity test green (`cd apps/web && npx vitest run src/features/dna/lib/novelDna.parity.test.ts`),
   plus `dnaJourney.test.ts` green (extend it: fresh book + no brief ⇒ now-step is `interview`;
   fresh book + `vision.compiled_at` ⇒ now-step is `seed`; book with accepted seed + no vision ⇒
   interview shows `done` — the grandfather case).

### Phase 3 — Three-state objective injection (the pollution fix)

File: `supabase/functions/book-agent/context.ts` (`threadSystem`).

1. It already receives `auto`, `authorAsk`, `followObjective`, and the book row (extend the select
   to keep `brief` — it's already selected). Pass `brief` into `currentObjective(liveNodes,
   { bookSlug: String(bookId), brief: b?.brief ?? null })`.
2. Replace the unconditional objective block with the policy:
   ```ts
   const injectObjective = auto || followObjective || !authorAsk.trim();
   ```
   and gate the `<current_objective>` entry in `blocks` on `injectObjective && liveObjective?.trim()`.
   When injected via `followObjective`, keep the existing note text; when injected because the ask
   is empty, same. When OMITTED, add nothing (no one-line status — full omission is the decision).
3. Pass `{ vision: true }` to the `briefContext` call inside `threadSystem` so the vision grounds
   every agent turn (D5's single v1 adoption site).
4. **Gate:** `deno check` clean. Manual: a turn with a typed ask must NOT contain
   `<current_objective>` in the logged prompt (check `ai_calls` request for the turn); a Next-nudge
   turn must contain it. Auto-mode turn must always contain it.

### Phase 4 — `update_vision` tool

Files: `supabase/functions/book-agent/tools.ts`, `exec-tools.ts`, `prompts.ts`.

1. `tools.ts` — add to `SHARED_TOOLS`:
   ```ts
   {
     name: "update_vision",
     description: "Capture what the author just told you into the brief's durable vision document (their characters-in-mind, setting, known plot points, aims, influences, constraints, open questions). Direct write, no review — this records THEIR words, so stay faithful: capture, don't invent or embellish. Pass ONLY the sections that changed; each replaces that section wholesale (carry forward anything worth keeping — the current vision is in your <brief> block). Set compiled: true only at the end of the interview, after the author confirms your summary — it marks the interview done and advances the journey. This is a read-class tool: batch it with other reads; it does not end your turn.",
     input_schema: {
       type: "object",
       properties: {
         characters: { type: "string" }, world_setting: { type: "string" },
         plot_points: { type: "string" }, themes_aims: { type: "string" },
         influences: { type: "string" }, constraints: { type: "string" },
         open_questions: { type: "string" }, notes: { type: "string" },
         compiled: { type: "boolean", description: "true = interview complete (author confirmed)." },
       },
     },
   },
   ```
2. `exec-tools.ts` — handle `t.name === "update_vision"` in `execTool` (non-terminal, like
   `read_node`): fetch `books.brief` fresh, shallow-merge the provided string sections into
   `brief.vision` (only keys present in input; ignore empty strings), set
   `vision.compiled_at = new Date().toISOString()` when `input.compiled === true`, write the whole
   brief back with `.update({ brief })`, push a step `{ t: "write", label: "Captured the vision: <joined section names>" }`
   (if the `AgentStep` union in `shared.ts` has no `write` variant, reuse `t: "read"` — do NOT
   invent a new step type without checking `StepBubble` in the web rail renders it), and return
   `"ok — vision updated (sections: …)"` as the tool_result content.
3. `prompts.ts` — in `SYSTEM_THREAD`'s tool guidance, add one line: during the interview step,
   capture author answers with `update_vision` as you go; it's the only direct write you have and
   it is for THEIR words only.
4. **Gate:** `deno check` clean. Deploy `book-agent` (standing auth: `supabase functions deploy
   book-agent`) and drive one real interview exchange on a scratch book; verify `books.brief.vision`
   fills and a step appears in the rail.

### Phase 5 — Client: thread the brief + interview UX

Files: `apps/web/src/features/dna/components/AgentRail.tsx`, `DnaOverview.tsx`,
`tree/panels.tsx`, `lib/agentThread.ts`, `lib/dnaJourney.ts` call sites.

1. Grep `currentObjective(` and `stageSubsteps(` under `apps/web/src` and pass the book's `brief`
   at every call site (all already have the book row or can get it from their existing props/queries
   — if one genuinely can't, leave it brief-less and note it: the optional param keeps it safe).
2. `AgentRail.tsx`: the `objectiveKey` → copy maps (`NEXT_STEP_MESSAGE`, `STEP_TEACH`) gain an
   `interview` entry. Suggested copy — next-step card: `"Interview me about my book."`; teach line:
   `"Before we build anything, I'll interview you — your characters, world, plot points, aims — and
   save it all to the book's vision so every later step honors it."` Keep the greeting logic as-is
   (`needsIdea` still precedes everything; the interview rung takes over once an idea exists).
3. Skip affordance (D3): wherever the journey substeps render (grep `stageSubsteps` usages in
   `DnaOverview.tsx` / `tree/panels.tsx` — the JourneyStrip lives there), when the `interview`
   substep is `now`, show a small "skip" action that writes `brief.vision.skipped = true` via the
   existing books-update path (same pattern the brief editor uses; find it with grep
   `update.*brief` under `apps/web/src`). Realtime on `books` will refresh the derivation
   (refresh-is-noop standard — don't add a manual refetch).
4. **Gate:** `npx tsc -p tsconfig.app.json` clean; full web tests
   (`npx vitest run`) — expect the pre-existing unrelated failure noted in the worklog, nothing new.

### Phase 6 — End-to-end verification + wrap

1. Scratch book, empty tree, brief with just genre+idea: rail greeting shows; "next step" card says
   the interview line; clicking it starts an interview turn (objective present since `isNextStep`);
   two Q&A exchanges produce `update_vision` calls (steps visible, brief.vision fills); saying
   "that's everything" produces a summary + `compiled: true`; the next-step card advances to Seed
   on its own (live re-derivation — no reload).
2. Same book: type a concrete ask ("make the villain funnier") — inspect the `ai_calls` row for
   that turn: NO `<current_objective>` block, vision present in `<brief>`.
3. An auto-mode run on any drafted book still carries `<current_objective>` every turn.
4. Existing book past seed: journey shows Interview as done (grandfather), nothing regresses.
5. Run `/wrap`: worklog entry `[ship]`, promote to `pm/STATE.md`, stamp.

## Gotchas the executor must not trip

- **Twin parity is a hard invariant** — any dna-journey edit lands in BOTH files, byte-equivalent
  logic, and the parity test must exercise the new `brief` param. Never edit one twin.
- **Prompt byte-stability** — `briefContext` output for existing call sites must not change by a
  single byte (the `vision` opt defaults off). This protects prompt caches and evals.
- **`prompts.ts` `SYSTEM_THREAD` is prompt-cached per run** — additions are fine (cache re-primes),
  but keep the tool line short; the interview technique itself lives in `STEP_RECIPE.interview`
  (injected via the objective) — not in the system prompt.
- **Don't touch auto-mode injection** — D4's omission applies only when `!auto && !followObjective
  && authorAsk` is non-empty.
- **`update_vision` is non-terminal** — it must NOT end the turn (not a proposal). It runs in
  `execTool` and the loop chains normally.
- **Steps rendering** — before adding a new `AgentStep.t` variant, check `StepBubble` in
  `AgentRail.tsx` handles it; unknown variants may render blank.
- **Deploy** — after Phases 3–4, redeploy `book-agent` (standing authorization exists). No DB
  migration anywhere in this plan.
