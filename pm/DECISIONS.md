# DECISIONS — append-only log

> One entry per consequential call: **date · decision · why · what it replaced.** Newest first.
> Full architecture decision records live in `docs/adr/` — link them from here.
> A decision belongs here if someone six weeks from now might ask "wait, why is it like this?"

## Log

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
