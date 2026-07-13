# DNA Architecture — Challenge Brief

> **Purpose:** hand this to an independent model (or a fresh session) to red-team the DNA
> architecture. Written to inform without anchoring — the system as built comes first, our own
> self-assessment comes last. Ground truth is the code; this doc is a map, not the territory.

---

## 0. Instructions for the reviewer

1. Read §1–4 only. Form your own view of the architecture's biggest structural risk before
   reading further.
2. Then read §5 (our internal self-assessment) — check it against what you found. Where you agree,
   say so briefly and move on; spend your effort on what §5 **doesn't** cover.
3. Answer §6 directly — those are the specific questions we don't have confident answers to.
4. Output wanted: ranked structural risks (not style nits), each with a concrete failure scenario;
   flag any load-bearing assumption that, if wrong, invalidates a large part of the design.
5. You have permission to conclude "this is overbuilt" or "this is underbuilt" — no sunk-cost
   deference expected.

---

## 1. The bet

> With enough **structure** — a DNA — and a way to **hydrate** it with AI and **grow** more
> structure from it, a book can be generated that a person will simply read.

- Structure = a typed tree (`seed → premise → pillar → act → beat → scene → prose`). The tree is
  the source of truth; pages are a *render* of it, never edited directly by generation.
- The falsifiable bar (**read-through test**): can the target reader read a generated book
  end-to-end with **no edit-reflex**? Current baseline (2026-06): **~4 pages** before the author's
  editor-reflex kicks in. That number has not been re-measured since a batch of agent-loop fixes
  landed (2026-07-09) — re-running it is the top current priority.
- Primary user/first reader: a single solo builder, judging their own generated output. Nobody
  else's taste has been tested against this system yet.
- Non-goals (deliberate): not a general free-write chatbot; not maximizing prose volume; not a
  craft tutorial; not "more editing tools" as the fix if output isn't readable.

---

## 2. The system as built

**The seam.** One feature (`book_nodes` + a handful of side tables) is private; the rest of the app
touches it through exactly two contracts: `books` row in (brief/foundations/canon/craft_notes),
rendered `pages` out. Render is a deliberate author gesture — the agent cannot cross the seam itself.

**The tree (genotype).** A single self-similar node tree, one strict parent law:
`seed(L0, singleton) → premise(L1, singleton) → pillar(L2, singleton) → act(L3) → beat(L4) → scene(L5)`,
plus entity kinds (character, relationship, tentpole, world_fact, location, thread, game, meter,
voice_profile) hanging off the pillar hub-and-spoke. Every node carries an authorship plane
(`source`: authored/derived/instrument · `status` · `locked`).

**The journey.** Five gated stages (premise → foundations → structure → scenes → draft), each
locked until the prior is complete. Generation is **one-shot per rung** — `dna-expand` explicitly
produces one authoritative value, not candidates to choose among.

**The driver.** One tool-using agent per book (`book-agent`). Two exits per generation: land as
reviewable "phantom" ops the author applies/discards, or (if auto-accept is armed) auto-land with
the agent picking its own options — walking the whole ladder unattended, checkpointing tree
versions as it goes. Auto-mode choices are journaled as decision forks.

**Linters (10 families).** Structural/causal/dead-field validated deterministically; vertical-fit,
shape, brief/premise-fit, and cold-read flags come from paid LLM "read" passes. **Only a few are
enforced as invariants** (setup-before-payoff, single-claim tentpoles/games, causal refs resolve);
most are warn-only and require a human to act on them.

**Ledgers.** Pure derivations over the tree: continuity/fact ledger, entity registry, promise/
obligation debt, causality DAG (`needs`/`establishes`, free-text keys, string-matched), meter series
(planned vs. observed). Nothing is stored below `book_nodes`.

**The verify loop.** After generation, LLM "read" passes produce observed traces; `traceDiff`
compares observed vs. planned and can flag a gap for the agent to fix. This exists for structure
and prose separately; there is no single closed generate→eval→revise loop wired end-to-end — the
$0.33/book "editor's read" eval and the DNA expand path are still separate pieces.

**Staleness.** Derived, not stored: `inputHash` re-stamps on edit, descendants compute stale on
read (never auto-clobbered). Locks inject verbatim into every downstream pass.

**Cost/latency constraints that shaped the design:**
- Supabase edge workers die at ~150s wall clock — this is *why* prose generation was moved to a
  client-driven browser stream (`prepare` + off-worker fetch) instead of staying server-side.
- Active model tier is a cheap OpenRouter/DeepSeek stack, not a frontier model, chosen for
  per-book cost (~$0.33 baseline at the eval stage). Docs note cheaper tiers "may comply less"
  with binding contract fields (heat/length/genre) — mitigated by injecting the MANDATE verbatim
  at every step, not verified per-call.
- Observed live cost pattern (2026-07-08 run): each agent turn re-sends 43–46K input tokens for
  144–1,184 output tokens; the tree-block context is the cache-miss driver, paid every turn.
- The whole-book build is currently **client-driven** — closing the browser tab freezes an
  in-progress auto-build. No headless/server driver exists yet.

---

## 3. Data model (for grounding, not analysis)

| Table | Role |
|---|---|
| `books` | entry contract: brief, foundations, canon, craft_notes, auto-mode flag |
| `book_nodes` | the tree — single source of truth |
| `book_agent_runs` | durable agent run state (resumable via self-chain) |
| `book_agent_sessions` | archived chat threads |
| `book_tree_versions` | linear save points (whole-tree snapshots, not per-node history) |
| `pages` | exit projection — render target, never agent-edited directly |
| `ai_calls` | every LLM call logged through one chokepoint |

---

## 4. Explicit constraints on critique

Treat these as fixed, not up for relitigation (they're product/business decisions, not
architecture defects) — critique *within* them:
- Solo-builder-as-first-reader is the current success bar; it has not scaled to other readers yet.
- Cost ceiling is real: the model stack is cheap-tier by design; suggestions requiring a
  frontier-model-per-call cost profile need to say so explicitly.
- The Supabase edge 150s ceiling is a platform constraint, not a design choice.

---

## 5. Our internal self-assessment (read after forming your own view)

From an existing internal critique (`docs/dna-studio-analysis.md`), condensed:

| Weakness | Why it caps quality |
|---|---|
| **No candidate+judge / best-of-n anywhere** | Every rung is one authoritative sample. The schema guarantees *well-formed*, not *surprising* — the modal story for a premise, told correctly. Called the biggest ceiling. |
| **No closed eval→revise loop** | The $0.33 editor's-read eval and DNA generation are separate pieces; nothing auto-chains write→eval→revise→re-eval. |
| **Most lints warn, few are enforced** | Sagging middle, dangling promise, ungrounded climax can all render — the system sees it, doesn't act. |
| **Causality DAG is lexical, not semantic** | `needs`/`establishes` are free-text keys, string-matched. Catches "and-then" drift; doesn't catch a limply-satisfied key, a near-duplicate key that fails to link, or weak vs. strong turns. |
| **One-shot compounds upstream error** | An off-key pillar or generic premise flows downhill uncorrected; nothing auto-gates "is this premise good?" |
| **Subtext/texture unplanned** | Beats plan *what happens*, not "said vs. meant" — the prose model invents subtext from scratch. |
| **Breadth over depth in foundations** | Many entity kinds generated one-shot each; no author-taste pruning step before the beat sheet schedules everything. |

Open engineering backlog (`docs/agent-improvement-remaining.md`): per-turn token cost dominated by
a cache-missing tree block (batching fix proposed, not shipped); agent-run transcript is
rewritten whole per turn (O(n²) DB writes on long runs); the "build all" flow is browser-tab-driven
with no headless/resumable driver.

---

## 6. Specific questions we want challenged

1. **Is the bottleneck actually structure?** The read-through baseline stalls at ~4 pages on
   *edit-reflex*, not confusion. Does that point at prose craft/voice as the real ceiling, making
   much of the structural machinery (11 node kinds, causality DAG, obligation ledger, 7 separate
   LLM "read" verifiers) disproportionate to the failure it's meant to fix?
2. **Is tree-as-source-of-truth-plus-render buying its complexity?** What would break if the agent
   instead free-edited prose directly against a lighter continuity ledger (a la the pre-DNA
   generations this replaced)? Name the specific failure the tree structure prevents that a
   simpler model wouldn't.
3. **Is the node-tree-as-context design cache-hostile by construction?** Every agent turn re-sends
   the mutating tree block (43–46K input tokens, mostly cache-miss). Is there an architecture
   (e.g., stable context + append-only delta) that wouldn't pay this every turn, or is this
   inherent to "the tree is truth, injected fresh"?
4. **Does auto-accept converge?** The agent picks its own options and walks the whole ladder
   unattended with no closed eval gate forcing quality pressure. What's the failure mode if it
   runs long — quality drift, error compounding, or does the invariant layer actually bound it?
5. **Given no best-of-n exists anywhere, is "the modal story" really the ceiling** — or is it
   prose-model capability (the active tier is cost-optimized, not frontier), and would a
   candidate+judge pass on a weak base model just produce a better-selected mediocre draft rather
   than fix the real gap?
6. **What's the single load-bearing assumption that, if false, most of this doesn't matter?**
   (Candidate: "more structure → more readable." Is there a cheaper way to have tested that before
   building the full ladder?)

---

## 7. Where to verify claims in this doc

- Engine (pure): `apps/web/src/features/dna/lib/novelDna.ts`, `dnaJourney.ts`, `dnaSchema.ts`
- Edge generation: `supabase/functions/dna-expand/index.ts`
- Agent loop: `supabase/functions/book-agent/index.ts`
- Full technical map with diagrams: `docs/dna/architecture.md`
- Product bar / hypothesis: `docs/NORTH_STAR.md`
- Prior self-critique (source for §5): `docs/dna-studio-analysis.md`
- Live-run findings (cost pattern, driver gaps): `docs/agent-improvement-remaining.md`
