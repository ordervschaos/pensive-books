# Vision → Structure — making the built book fulfill the author's vision

**Status:** ratified 2026-07-13. Sequel to `docs/agent-guidance-system.md` (interview + vision doc,
now implemented). This is an EXECUTABLE plan for an implementing agent: decisions are final — do not
relitigate; if a step is impossible as written, stop and report rather than substituting.

## Why (one paragraph)

The interview now captures the author's vision at `books.brief.vision`, and the book-agent sees it
every turn — but the ENGINE does not: `dna-expand`'s derivation passes (contract, beatsheet, premise,
logline, generic targets) render the brief WITHOUT the vision, so the structure that gets generated
— controlling idea, dramatic question, ending, cast, relationships, threads, tentpoles, meters — is
derived from genre conventions alone, not from what the author actually said. And nothing ever
checks the finished structure BACK against the vision. Fix: (a) feed the vision forward into every
derivation, (b) turn the vision's concrete promises into nodes the existing lints already enforce,
(c) add a fulfillment audit that closes the loop. This is the generate↔verify duality: the vision
becomes a contract that grounds generation AND gets verified against.

## What already exists (build on it, don't rebuild it)

- `brief.vision` + `VISION_SECTIONS` renderer behind `briefContext(brief, { vision: true })`
  (`_shared/brief.ts`) — currently adopted ONLY by book-agent's `threadSystem`.
- `dna-expand` contract target (`supabase/functions/dna-expand/index.ts` ~line 1027): compiles the
  brief → tentpoles + seeded meters (with `target` curves) + voice constraints. Client persists via
  the review channel.
- Meter verify machinery in the novelDna twins: `meterSeries` (plan readings with carry-forward),
  `targetGap`, and the `target_drift` / `read_gap` lints. **The cascade the user described —
  "how each act/beat/scene should rate" — is the `target` curve + these lints. It exists.**
- `tentpole_unplaced` lint: a declared tentpole not realized by any beat/scene flags. This is the
  enforcement mechanism we reuse for the author's promised plot points (D2).
- Threads are minted during the beatsheet pass; arc/relationship health lints (`dead_arc`,
  `static_relationship`) exist; obligation ledger enforces open promises get paid.
- `check_against_contract` (book-agent `exec-tools.ts` ~line 138): the LLM-as-judge read-tool
  pattern to mirror for the vision audit.

## Ratified decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Vision reaches the engine | EVERY `briefContext(...)` call inside `dna-expand/index.ts` gains `vision: true` (grep them all — logline, premise, beatsheet, contract's ctx, the generic target builder). This deliberately widens the previous plan's D5 from book-agent-only to the whole derivation engine. All other call sites (prose pipeline, evaluate, judges) stay untouched. |
| D2 | Author plot points become TENTPOLES | Contract v2 emits tentpoles from TWO sources: genre conventions (as today) AND the vision's `plot_points`/`themes_aims` (the author's own promised moments). Add optional `source?: "genre" \| "vision"` to tentpole content (jsonb — no migration). The existing `tentpole_unplaced` lint then enforces "the author's promised moments get scheduled" for free. |
| D3 | Meter palette | Extend `MeterKind` with `"mystery" \| "violence" \| "levity"` (both novelDna twins + the `METER_KINDS` whitelist in dna-expand + any client kind enumerations). "Sexual content" is NOT a new meter kind — it is the existing `heat` axis; the brief's `content_type` mandate stays the hard CEILING, the heat meter's target curve is the SHAPE over time. "Lightness" = `levity`. |
| D4 | Contract v2 scope | Meters go from "1–3 genre axes" to "2–5 axes the GENRE and the VISION jointly demand", target curves shaped by the vision's stated pacing intents where given. Derivation sources become BRIEF + MANDATE + VISION. Still one pass, still author-approved via the existing review channel, still idempotent against the existing registry. |
| D5 | Fulfillment check | A new **non-terminal** book-agent read tool `audit_vision` (LLM-as-judge, mirroring `check_against_contract`'s implementation shape): compares the vision section-by-section against a digest of the current foundations + structure, returns covered / partial / missing verdicts with concrete gaps. NO deterministic lint over free text — the audit is agent-run at recipe checkpoints, and the agent proposes fixes for gaps through the normal proposal channel. |
| D6 | No journey changes | No new stages or substeps. The nudging rides existing machinery: upgraded `STEP_RECIPE` texts + the audit checkpoints. (The ladder churn isn't worth it; the contract rung already exists.) |
| D7 | Vision is a living document | The author does NOT need to "finalize" the vision to advance (compile just closes the interview rung). `update_vision` is already in `SHARED_TOOLS` (available every stage); add one system-prompt line telling the agent to capture NEW author revelations back into the vision at ANY stage. |
| D8 | Sufficiency rubric is tier-1 craft, defined ONCE | The definition of "the structure is enough to fulfill the vision" lives as a distilled-KB const `VISION_RUBRIC` in a new `_shared/vision-craft.ts` (same tier-1 pattern as `story-shapes.ts`). BOTH consumers embed it verbatim: the `audit_vision` judge's system prompt AND a new `vision-fulfillment` skill in `agent-skills.ts` (so the agent can reason with the rubric conversationally, not only via the tool). One definition of "sufficient", not two — the same principle as `target_drift`'s band being the one definition of "on-genre". |
| D9 | Interview craft becomes a STATE-injected skill | New `vision-interview` skill in `agent-skills.ts`, injected by BOOK STATE, not ask triggers: during discovery (vision neither compiled nor skipped AND no non-seed node exists — the exact mirror of the journey's interview gate), `threadSystem` injects it on EVERY turn regardless of what the author typed, and suppresses ask-triggered skills (mid-interview, "protagonist" must not drag in character-craft's node-editing playbook). Fixes the shipped D4 hole: the author's interview ANSWERS are concrete messages, so the objective — and `STEP_RECIPE.interview` inside it — vanished on exactly the turns where the interview happens. Recipe stays as the objective's workflow line; the skill carries the deeper elicitation technique. |

## Phases — in order; each ends with a verification gate

### Phase 1 — Meter palette (small, foundational)

1. `MeterKind` in BOTH twins (`supabase/functions/_shared/novel-dna.ts` ~line 224 and
   `apps/web/src/features/dna/lib/novelDna.ts`): add `"mystery" | "violence" | "levity"`.
2. `METER_KINDS` whitelist in `dna-expand/index.ts` (~line 1053): add the same three.
3. Grep `MeterKind\|"heat" | "comedy"\|meter.*kind` across `apps/web/src` for any UI that
   enumerates kinds (pickers, dashboards, badge colors) and extend mechanically. The meters
   dashboard plots by name/scale, so new kinds should render without work — verify, don't assume.
4. **Gate:** web typecheck (`cd apps/web && npx tsc -p tsconfig.app.json` — bare `tsc` is a no-op),
   `deno check` on dna-expand, parity test green
   (`npx vitest run src/features/dna/lib/novelDna.parity.test.ts`).

### Phase 2 — Vision reaches the engine (D1, D2, D4)

File: `supabase/functions/dna-expand/index.ts`.

1. Add `vision: true` to every `briefContext(...)` call in the file (grep `briefContext(` — there
   are ~4+; do them all, including the generic-target ctx builder).
2. Contract v2 — amend the `target === "contract"` system prompt (~line 1044):
   - Sources line becomes: *"Derive ONLY from the BRIEF, the MANDATE, and the VISION (the author's
     own captured intent — when the vision speaks, it OUTRANKS genre convention; the story-so-far is
     orientation, not a source of new plot)."*
   - Deliverable 1 (TENTPOLES) becomes two-source: *"3–6 obligatory genre moments AND every concrete
     moment the vision's plot points promise (mark each with source: 'genre' or 'vision'). A vision
     promise is a tentpole even if the genre doesn't demand it."*
   - Deliverable 2 (METERS): *"2–5 numeric axes the brief AND vision jointly demand"*, palette named
     as `tension/heat/comedy/mystery/violence/levity/affect/value/custom`, and: *"where the vision
     states pacing intent ('slow burn', 'one brutal midpoint scene', 'keeps it light until the
     end'), shape that meter's target keyframes to encode it."*
   - Output schema line: tentpoles gain `"source": "genre"|"vision"`; meters' kind enum gains the
     three new kinds.
3. Post-parse handling: carry `source` through the tentpole mapping (default `"genre"` when
   absent); the client persist path (`apps/web/src/features/dna/lib/dnaExpand.ts` — grep
   `contract`) writes content verbatim, so verify `source` survives to the node and fix if the
   client strips unknown keys.
4. **Gate:** `deno check` clean; deploy `dna-expand` (standing auth); on a scratch book with a
   filled vision, run the contract from the rail and verify (a) a vision-stated plot point appears
   as a `source:"vision"` tentpole, (b) a vision-stated pacing intent shows in some meter's target
   curve, (c) re-running is still idempotent (existing registry dedupe holds).

### Phase 3 — Recipes speak vision (D6, D7)

Files: BOTH dna-journey twins (`_shared/dna-journey.ts` + `lib/dnaJourney.ts`) — verbatim-identical
edits (parity test runs `currentObjective` over both, so any divergence fails loudly). Then
`book-agent/prompts.ts`.

1. `STEP_RECIPE` upgrades (append to the existing strings, don't rewrite them):
   - `pillar`: append *" Ground every option in the VISION's themes/aims section — the controlling
     idea should be recognizable as the author's own argument, sharpened."*
   - `contract`: append *" The contract also compiles the VISION: the author's promised plot points
     become tentpoles and their pacing intents shape the meter target curves — so run it once the
     vision has substance, and mention to the author what it will pin."*
   - `cast`: append *" Cover every character the VISION names before inventing new ones; give each
     want / need / wound / lie (that quartet IS the arc). Pull relationships and locations from the
     vision's own sections too."*
   - `beats`: append *" After the beat sheet lands, call audit_vision and propose fixes for
     anything the vision promised that the structure doesn't yet deliver."*
   - `cast` checkpoint too: append to `cast` (after the arc sentence): *" When the core cast is in,
     call audit_vision to catch vision characters/relationships still missing."*
2. `prompts.ts` (`SYSTEM_THREAD`): one line near the update_vision guidance: *"The vision is a
   LIVING document — when the author reveals something new at ANY stage (a character detail, a
   pacing wish, an ending change), capture it with update_vision in the same turn."*
3. **Gate:** parity test green; `dnaJourney.test.ts` green; `deno check` clean.

### Phase 3b — `vision-interview` skill, state-injected (D9)

Files: `_shared/agent-skills.ts`, `book-agent/context.ts`.

1. `agent-skills.ts` — add the skill (keep `triggers` minimal; state injection is the real channel):
   ```ts
   {
     name: "vision-interview",
     description: "interviewing the author to capture their vision — elicitation technique for the discovery phase",
     triggers: [/\b(interview|vision|my\s+(book|story|idea)\s+is|what\s+i\s+(have|want)\s+in\s+mind)\b/i],
     body: `You are in DISCOVERY: the book lives in the author's head, and your job is to get it out — not to generate. Technique:
   - FUNNEL each thread: open ("what draws you to this story?"), then follow up on the specific ("you said betrayal — who betrays whom, and does the reader see it coming?"), then confirm by reflecting it back in YOUR words before capturing. Author's-words-first: capture what they SAID, tagged loosely to sections; never launder it into genre boilerplate.
   - 2–3 questions per turn, max. Lead with the section that's emptiest AND closest to their last answer — chase their energy, not your checklist order.
   - CONCRETE beats ABSTRACT: "what's a scene you can already see?" outworks "what are your themes". When they give an abstraction ("it's about grief"), ask for the image that carries it.
   - When they're BLANK, offer 2–3 directions to react to (reacting is easier than inventing) — but mark your offers as yours; if they adopt one, capture it as theirs only after they say yes.
   - When they RAMBLE, don't interrupt the gold: capture everything, then reflect the 2–3 strongest things back and ask which is load-bearing.
   - DISAGREEMENTS with craft (a flat protagonist, stakes that can't escalate) get ONE gentle flag during discovery — note it in open_questions, don't relitigate. The interview is for THEIR book, not your fixes.
   - Every exchange that surfaces something new → update_vision the same turn (only changed sections). End-game: when most sections have substance and their answers start repeating, summarize the whole vision back, get the yes, compile.`,
   },
   ```
2. `context.ts` (`threadSystem`) — state-based injection replacing the ask-triggered set during
   discovery. After the `matchedSkills` line, mirror the journey's interview gate exactly:
   ```ts
   // D9 (docs/vision-to-structure.md): discovery is a STATE, not an ask — mid-interview answers are
   // concrete messages, so ask-triggered skills mismatch (they'd inject node-editing craft) and the
   // objective (with the interview recipe) is omitted. While discovering, the interview skill rides
   // every turn and ask-triggered skills are suppressed.
   const discovering = !b?.brief?.vision?.compiled_at && !b?.brief?.vision?.skipped
     && !liveNodes.some((n) => n.kind !== "seed");
   const interviewSkill = AGENT_SKILLS.find((s) => s.name === "vision-interview");
   const effectiveSkills = discovering && interviewSkill ? [interviewSkill] : matchedSkills;
   ```
   (import `AGENT_SKILLS` beside `matchSkills`; build `skillBriefs` + `groundingLabels` from
   `effectiveSkills`.) The fresh-book predicate MUST match the journey twins' grandfather gate —
   if that gate reads differently today (it shipped as "any non-seed node exists"), copy ITS
   expression, don't paraphrase.
3. **Gate:** `deno check` clean; deploy `book-agent`. On a fresh scratch book mid-interview, answer
   with "my protagonist is a lighthouse keeper" and verify in the `ai_calls` request: the
   `<skill_briefs>` block contains vision-interview and NOT character-craft. After compiling the
   vision, the same message injects character-craft again (discovery over).

### Phase 4 — `audit_vision` tool + the sufficiency rubric (D5, D8)

Files: NEW `supabase/functions/_shared/vision-craft.ts`, `_shared/agent-skills.ts`,
`book-agent/tools.ts`, `book-agent/exec-tools.ts`.

0. Create `_shared/vision-craft.ts` exporting the rubric (verbatim — this IS the craft document):
   ```ts
   // vision-craft — tier-1 distilled craft: the ONE definition of "the structure fulfills the
   // vision". Embedded verbatim by BOTH the audit_vision judge (exec-tools) and the
   // vision-fulfillment skill (agent-skills). Edit here, never fork a copy.
   export const VISION_RUBRIC = `Sufficiency = every vision commitment has a STRUCTURAL CARRIER, and that carrier is SCHEDULED, not just declared. Judge section by section:
   - CHARACTERS: every vision-named character has a node with the full arc quartet (want / need / wound / lie). The protagonist's arc must trace the premise shape's movements. Named-but-flat (a node with just a name/role) = partial.
   - RELATIONSHIPS: every vision-named bond has a relationship node — and if the vision implies the bond MOVES (rivals→lovers, trust→betrayal), it needs a carrier for the movement (an arc thread or an owned meter), not just the node.
   - PLOT POINTS: every promised moment has a tentpole (source:"vision") AND at least one beat that realizes it (realizes_tentpole). Declared-but-unplaced counts as missing in effect — the tentpole_unplaced lint is the enforcement.
   - AIMS / THEMES: the pillar's controlling_idea argues the vision's aim in the author's own direction; the ending delivers that argument on the page; the dramatic_question prices it as a cost ("can she X without losing Y"), not a topic.
   - MYSTERIES / PROMISES: every setup or mystery the vision opens has a thread with BOTH anchors scheduled — a setup beat and a payoff beat. Open-ended-on-purpose must be marked waived, not left dangling.
   - PACING INTENTS: every stated intent ("slow burn", "keep it light until the midpoint", "one brutal scene") has a meter whose target curve encodes it, and beats carry readings that track that curve — a clean target_drift is the pass bar.
   - SETTING: the vision's world rules and places exist as world_fact / location nodes AND scenes ground in them (grounds_in). A location no scene ever visits is partial.
   - CONSTRAINTS: every non-negotiable appears in the mandate / voice constraints, and no beat or scene plan violates it.
   Verdict per section: covered / partial / missing. Every gap MUST name its fix — the tool and the node ("propose_node_ops: add an arc thread for Mara→Josef, setup at beat 4"). And coverage without causality is NOT sufficiency: a promised moment parachuted into a beat that nothing upstream earns (no connector/needs chain) is partial, not covered.`;
   ```
1. `_shared/agent-skills.ts` — add a `vision-fulfillment` skill: import `VISION_RUBRIC`;
   `triggers: [/\b(vision|fulfill|sufficien|audit|covers?\s+(my|the)|what\s+i\s+(asked|wanted|said)|match(es)?\s+(my|the)\s+(idea|vision|intent))\b/i]`;
   body = one intro line ("How to judge — and fix — whether the built structure delivers the
   author's captured vision. Run audit_vision for the systematic sweep; use this rubric when
   reasoning about any single gap:") + `VISION_RUBRIC`.
2. `tools.ts` — add to `SHARED_TOOLS`:
   ```ts
   {
     name: "audit_vision",
     description: "Judge whether the book's current foundations and structure FULFILL the author's vision (the brief's vision document). Returns a section-by-section verdict — covered / partial / missing — with the concrete gaps (a vision character with no node, a promised plot point no beat delivers, a stated pacing intent no meter targets, an aim the controlling idea ignores). Run it at checkpoints (after foundations are in, after the beat sheet lands) or when the author asks whether the book matches what they wanted. It's a read: batch it with other reads; then PROPOSE fixes for real gaps — don't just report them.",
     input_schema: { type: "object", properties: {
       focus: { type: "string", description: "Optional: one vision section or question to audit deeply instead of the full sweep." },
     } },
   }
   ```
3. `exec-tools.ts` — handle `t.name === "audit_vision"` mirroring `check_against_contract`'s shape
   (same model role, same non-terminal return): fetch `books.brief`; if `brief.vision` has no
   filled section, return `"(no vision captured — run the interview or update_vision first)"`.
   Otherwise build the judge prompt: system = a one-line judge role + `VISION_RUBRIC` (imported
   from `_shared/vision-craft.ts` — D8: never restate the rubric inline); user = (a) the rendered
   vision sections (reuse `VISION_SECTIONS` from `_shared/brief.ts`), (b) a compact digest of
   pillar (controlling idea + ending), premise (dramatic question), characters
   (name/role/want/need/wound/lie), relationships, threads (name/kind/promise + anchor status),
   tentpoles (name/source + placed-or-not), meters (name/kind + whether target exists), and
   act/beat one-liners — reuse the digest helpers in `book-agent/context.ts` if exportable, else a
   local compact serializer. Judge output: per-section `covered|partial|missing` + gap bullets
   each naming its fix, returned verbatim as the tool_result text. Log the step as `{ t: "read", label: "Audited the structure against the vision." }`
   (or the step variant Phase-4-of-the-previous-plan used for update_vision — match it).
4. **Gate:** `deno check` clean; deploy `book-agent`; on the scratch book, ask the rail "does this
   match my vision?" and verify (a) the `vision-fulfillment` skill brief injects (the ask hits its
   triggers), (b) the tool runs and the verdict cites a real planted gap (add a vision character
   with no node before testing), (c) the agent follows with a proposal naming the fix.

### Phase 5 — Client sweep

1. Grep `STEP_TEACH\|NEXT_STEP_MESSAGE` in `AgentRail.tsx`: refresh the `contract` entry's copy to
   mention the vision ("compiles your vision + genre into pinned promises and pacing targets"), and
   confirm no entry is needed for audit (it's not a rung — D6).
2. Meters dashboard (`/dna/meters` — grep `meters` under `features/dna/pages`): verify new kinds
   render; tentpole UI: surface `source:"vision"` if a badge is cheap (one conditional — skip if
   it's more than that; not load-bearing).
3. **Gate:** `npx tsc -p tsconfig.app.json` clean; `npx vitest run` — no NEW failures.

### Phase 6 — End-to-end + wrap

1. Fresh scratch book → interview 2–3 exchanges (vision gets characters, a plot point, "keep it
   light until the dark midpoint") → compile → pillar options visibly argue from the vision's aims
   → contract: vision plot point lands as a `source:"vision"` tentpole; a `levity` meter exists
   with a curve dipping at the midpoint → cast rung covers the vision's named characters →
   beatsheet → agent runs audit_vision unprompted (the beats recipe) and proposes a fix for any
   missing promise → `target_drift`/`tentpole_unplaced` lints fire on planted violations
   (`<story_analysis>` shows them).
2. Confirm prose-pipeline prompts are byte-unchanged (no `vision: true` outside dna-expand +
   book-agent — grep to prove it).
3. Redeploy both fns (already done per-phase); `/wrap`: worklog `[ship]`, promote, stamp.

## Gotchas the executor must not trip

- **Twin parity is a hard invariant** — MeterKind and STEP_RECIPE changes land in BOTH copies,
  byte-equivalent; the parity test catches recipe drift, nothing catches MeterKind drift except
  review — check it twice.
- **Contract idempotence** — the existing-registry dedupe block must keep working; vision tentpoles
  re-emitted on every run would multiply. Test the re-run in Phase 2's gate.
- **`audit_vision` is non-terminal** — it must chain like a read, never end the turn.
- **Don't touch the prose pipeline** — `vision: true` goes into dna-expand and (already) book-agent
  ONLY. The brief→mandate propagation spec (`docs/brief-mandate-propagation.md`) is separate,
  parked work; do not fold it in.
- **`content_type` stays the heat ceiling** — the heat meter's target curve never overrides the
  mandate's content bound; the curve shapes WITHIN the ceiling. Don't reword mandate text.
- **Worker clock** — contract v2's prompt grows (vision text); it runs one call under
  `max_tokens: 3000` with a 140s signal — fine, but don't raise max_tokens "for richer output."
- **Deploy** — `dna-expand` after Phase 2, `book-agent` after Phases 3–4 (standing authorization).
  No DB migration anywhere in this plan.
