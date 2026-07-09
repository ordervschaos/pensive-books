# DECISIONS — append-only log

> One entry per consequential call: **date · decision · why · what it replaced.** Newest first.
> Full architecture decision records live in `docs/adr/` — link them from here.
> A decision belongs here if someone six weeks from now might ask "wait, why is it like this?"

## Log

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
