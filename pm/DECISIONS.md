# DECISIONS — append-only log

> One entry per consequential call: **date · decision · why · what it replaced.** Newest first.
> Full architecture decision records live in `docs/adr/` — link them from here.
> A decision belongs here if someone six weeks from now might ask "wait, why is it like this?"

## Log

### 2026-07-10 — Squashed 135 migrations into one baseline dump; `supabase start` now bootstraps from empty
`supabase start`/`db pull` had never worked from an empty database: the earliest migration
(`20250127000000_create_page_chats.sql`) already assumed `public.pages` existed, but no migration in
the 135-file chain ever created it (or most other core tables, or the `vector`/`pg_net` extensions
they depend on). The base schema was set up directly on the hosted project — dashboard/manual SQL —
before this repo adopted migration-file discipline, and was never captured. Every migration replayed
fine on the REMOTE project (which already had the base tables) but could never replay on a fresh one,
so local Docker DB parity has probably never existed here.

**Fix:** `supabase db dump --linked --schema public` (schema-only, no data — pg_dump talks straight to
Postgres, independent of migration replay, so it isn't blocked by the same gap it's fixing) captured
the schema AS IT ACTUALLY EXISTS today. The 135 old files moved to `supabase/migrations_archive/` (git
`mv`, history preserved, not deleted); the dump became the one new migration,
`20260710140000_baseline_schema_dump.sql`, with `CREATE EXTENSION IF NOT EXISTS "vector"`/`"pg_net"`
added at the top (needed for a `pages.embedding` column and `net.http_post` trigger calls — schema
dumps don't capture extension activation, and no archived migration ever did either). Verified live:
`supabase start` bootstraps clean, `supabase functions serve` serves all 19 functions against it, and
a full request through the local gateway → edge fn → local Postgres → `callLLM` → the `claude-local`
shim → real `claude -p` → response round-tripped correctly end to end.

**Caveat, not yet acted on:** the remote project's own `supabase_migrations.schema_migrations` table
still has all 135 old versions recorded as applied; this new baseline's version has never been pushed.
Before the next `supabase db push`, someone must run
`supabase migration repair 20260710140000 --status applied --linked` to mark it applied without
executing it remotely (every object already exists there) — deliberately left undone here since it
mutates the shared/production project's migration bookkeeping, not something to do silently as a side
effect of a local dev-experience fix.

### 2026-07-10 — Provider is an explicit setting, not a naming convention; DeepSeek's own API satisfies the escape clause
Shipped `ai_provider` (`auto|anthropic|openrouter|deepseek|mulerouter`) in `admin_settings`, read at
the `callLLM` chokepoint. **Replaces** routing-by-model-id-shape (a `/` meant OpenRouter, a `deepseek`
prefix meant DeepSeek) plus an env-gated MuleRouter takeover that fired whenever `MULE_ROUTER_API_KEY`
existed — routing policy smeared across a string prefix and the presence of a secret, unchangeable
without editing code or deleting a key.

Design call: the setting is a **preference with fallback, not a mandate**. `wireModelFor(provider, model)`
is a capability matrix; a host that can't serve a model is skipped and the model falls back to its native
host. This is load-bearing, not politeness: `DIGEST_MODEL` and `IMAGE_PROMPT_MODEL` are pinned to
`qwen/qwen3-235b-a22b` regardless of tier, so a *mandating* switch set to `deepseek` would 404 the
continuity digest on every page render. `auto` reproduces the old order exactly → no behaviour migration.

**This amends the entry directly below.** That decision parked the agent role on Anthropic "until either
a router forwards a thinking bound or agent calls move off-worker." Probing `api.deepseek.com` directly
(deepseek-v4-flash, `max_tokens: 3000`): `reasoning_effort: "low"` cut reasoning 860 → 406 tokens, and
reasoning **counts inside `max_tokens`** (`finish_reason: "length"` at exactly 3000). Both bounds Anthropic
gives us. DeepSeek's direct API is therefore the first *cheap* host with a boundable agent loop — the escape
clause is satisfied, and `reasoningParamsFor(…, "deepseek")` now emits `reasoning_effort`. Not yet exercised
on a live full-book build; that's Now#1's job. Active config: `ai_provider=deepseek`, `ai_model_tier=deepseek-v4`.

Also logged `ai_calls.provider`: `model` records what the caller *asked for*, and the same id is servable by
three hosts, so without the column the switch is unfalsifiable — the first green e2e test proved nothing.
A spend switch you can't observe isn't a spend switch. Incidental finding: `deepseek-chat` no longer names a
model — it is a silent alias for `deepseek-v4-flash`.

### 2026-07-09 — Amendment: qwen3.7-plus reasoning is unboundable via routers; fix verified on Anthropic path
Follow-up to the same-day timeout decision below. Both fixes deployed; live result: **17
post-deploy book-agent turns, 0 timeouts** (was ~37% error rate) with `max_tokens: 5000` on the
sonnet tier. But controlled probes (hard planning prompt, n=2–3 per condition) falsified the
"map the effort param" half for qwen: MuleRouter's `/vendors/openai` facade silently drops
`reasoning_effort`, `reasoning:{effort}`, `thinking_budget` and `enable_thinking` (all ~7.4k
completion tokens / 200–390s, indistinguishable from baseline), and OpenRouter ignores
`reasoning:{effort}` for this model; qwen's thinking also does NOT count against `max_tokens`.
The mapping ships anyway (documented intent, harmless, works the day a router forwards it).
Operative decision: **the agent role belongs on an Anthropic tier** (current default) until
either a router forwards a thinking bound or agent calls move off-worker like prose. Also
flagged operationally: OpenRouter credits exhausted — `dna-expand-digest` (qwen3-235b, no Mule
equivalent) failing 100% with 402 during live renders; needs top-up or a model re-point.
Details: `doc_1783607491000.md`.

### 2026-07-09 — book-agent timeouts root-caused to dropped effort param; fix plan set
~37% of book-agent calls were dying at the 140s abort in streaks of 2–3 (each billed — abort
doesn't stop provider-side generation). `ai_calls` evidence: latency tracks output tokens
(~55 tok/s → the timer fits ~7k generated tokens vs `max_tokens: 8000`), not input — 70k-token
prompts prefilled fine in ~20s while a 25k-token prompt timed out 3× on identical retries. Root
cause: the `anthropicToOpenAI()` adapter in `_shared/llm.ts` drops `output_config`/`thinking`,
so the `effort:"medium"` bound book-agent sends never reaches qwen on the MuleRouter path — it
only ever worked on the Anthropic path (silent contract break; the "too much context" hypothesis
was falsified, transcript compaction is working as designed). Agreed fix order: (1) map effort →
OpenAI-side `reasoning:{effort}` in the adapter, (2) lower agent `max_tokens` to ~5000 to fit
the timer, (3) degrade retries instead of replaying verbatim. Analysis of record:
`doc_1783599238000.md`. Replaces nothing — first principled account of these timeouts.

### 2026-07-09 — DNA UI self-explanatory pass ratified as Next, comprehensive scope
User request (two screenshots: raw schema labels in Tree, raw lint rule-ids in Analytics) to make
the whole DNA Studio self-explanatory. Audit showed the gap is mostly **discoverability**, not
missing content — plain-English copy already exists for node kinds and journey stages but is
hover-only; Analytics/lints is the one place with a real content gap (no why/fix copy) plus a
`dangling_ref` field-clarity gap. Ranked as a new **Next** item (not bumped into Now, which was
already at its 2-item WIP limit) — offered scoped-vs-comprehensive and Now-vs-Next as explicit
choices; user chose **comprehensive (all 6 tabs)** and **Next** rather than folding a smaller
slice into the in-flight Monetization rails v1 item. Rationale for rank: NORTH_STAR §9 explicitly
includes intuitiveness as a ranking axis, and it directly de-risks R1 (a paid studio with a
cryptic Analytics tab reads as unfinished). Audit + phased design live in
`docs/dna-ui-self-explanatory.md`; Analytics tab (first slice) has a full implementation design
as of this entry, not yet built.

### 2026-07-09 — 45 legacy books left stranded off the DNA tree (deliberate)
`migrateBookToDna` (legacy brief/foundations/spine/pages → `book_nodes`) lost its only UI trigger
when the old DnaStudio "Migrate" button was deleted in the 2026-07-03 one-studio consolidation.
Before deleting the now-orphaned function (builder loop iter 3), checked the DB: **45 books**
still have real pages + foundations/spine but zero `book_nodes` rows — this was their only path
onto the DNA tree, and none exists now. Flagged to the user with the count; explicit call was to
delete the function anyway rather than keep it unwired or rebuild the entry point. Why it matters:
those 45 books cannot reach the Studio surface without new migration code being written from
scratch — this was a conscious tradeoff, not an oversight, if anyone asks later why they're stuck
on the old rail.

### 2026-07-09 — Monetize ASAP: revenue track unhooked from M2 (owner directive)
GTM.md promoted from "thinking surface" to **committed plan v1**. The old sequencing gate ("no
pricing page before M2, paid tier = M4") is narrowed: it now guards only **generation** pricing
(R3). The mature Writing pillar (R1 Pro subscription) and the import→structure wedge (R2 per-unit)
monetize immediately — their quality doesn't depend on clearing M1, and R2's prose is the user's
own. Replaces: the blanket "no GTM before M2" stance. Monetization rails v1 takes ROADMAP Now
slot 2; both marketing and product build lists live in GTM.md.

### 2026-07-09 — Live full-book build re-exercise promoted to Now
ROADMAP had both Now slots free with the highest-leverage item (re-testing §v1/§v4 agent-loop
fixes on a live "build all") sitting as a footnote, while EPUB Layer B and REVALIDATE_SECRET —
both real but adjacent to M1 — held the two ranked Next slots. Promoted the live-build
re-exercise to Now; it tests M1's bar ("one self-generated book read end-to-end") directly.

### 2026-07-09 — All work routes through the PM via a firehose + curated view
Added `pm/WORKLOG.md` (append-only, one entry per task, **never read into an agent session** —
write-only, zero context cost) as the raw catalogue, feeding the curated STATE/ROADMAP/DECISIONS.
The `/wrap` command is the end-of-task chokepoint (catalogue → promote → stamp); a Stop hook
(`.claude/hooks/pm-worklog.sh`) enforces it so cataloguing never relies on memory (nudges once per
dirty, uncatalogued change-set, idempotent via a gitignored sentinel). Why it matters: the old
rule "after any ship, update STATE" was discipline-only and STATE tracks *projects*, not *tasks* —
there was no place to catalogue task-level work without bloating the curated files or context.
This is event-sourcing: cheap appends to the log, a hand-curated projection above it.

### 2026-07-09 — Recovered a day of unmerged work (`dna/structure-miner`)
Branch diverged from `main` 2026-07-08 same day `pm/` was created, carried out the live
agent-loop exercise (found + fixed §v2/§v3, found §v1/§v4) and shipped Structure Miner
R1/R2 — but was never merged, so `main`'s `pm/STATE.md`/`ROADMAP.md` kept describing both
as not-started. Caught by routine `/pm` drift check. Why it matters: a branch with its own
`pm/` edits can silently outrun `main`'s — check `git log --all` for stale branches with
`pm/` commits during drift checks, not just `main`'s log.

### 2026-07-08 — PM knowledgebase created (this folder)
Roadmap/state/GTM/decisions live in `pm/` as versioned markdown, separate from `docs/` design
specs. Three-hats review model (owner/PM/builder). Replaces: state scattered across memories,
docs, and chat history.

### 2026-07-03 — One studio: the tree is the only surface
Vanilla `/dna` studio deprecated; DnaTreePage is the single Studio surface (Overview ports in as
tree landing mode). Why: two half-surfaces blurred the "one job per screen" rule. Do not resurrect
DnaStudio.

### 2026-07-01 — Autopilot retired, folded into agent auto-accept
Whole-book build = the agent's auto-accept mode (propose_expansion loop), not a separate
autopilot engine. Why: one AI surface, one loop; two drivers drifted.

### 2026-06-30 — DNA substrate pivot (the anchor decision)
Build Studio + six per-layer chat rails **deleted**. The `book_nodes` DNA tree + one AgentRail
agent are the single substrate and single AI surface. Why: per-layer surfaces multiplied drift
and context loss; the tree is the source of truth, everything else is a projection.

### 2026-06 (standing) — Prose escapes the edge worker
Prose generation streams client-side via a same-origin proxy (Vercel fn / Vite middleware)
because the Supabase free-plan worker dies at ~150s (was killing ~54% of prose calls). Any
long-running generation must respect this ceiling or stream off-worker.

### 2026-06 (standing) — Model stack = OpenRouter cheap tier
Active generation tier is Qwen/DeepSeek via OpenRouter (Anthropic-shaped calls, converted).
Why: cost discipline (NORTH_STAR §7); premium models reserved for evals. Benchmark found
cheap ≈ premium on tight beats.

### 2026-06 (standing) — Structure as render
`books.outline` / the DNA tree is the artifact; pages are a deliberate `reconcile()` render.
Why: cheap JSON edits, no page-soup as truth. (See also `docs/adr/0001-public-nextjs-private-spa.md`
for the two-app split.)

### (standing) — UI is a live projection of server state
Refresh must be a no-op; subscribe via Realtime, never fetch-once. Product-wide standard.

### (standing) — Every AI activity is a durable server-owned task
Task row + self-chain + watchdog; unified stop chokepoint. New AI surfaces must join this
pattern, not invent their own lifecycle.
