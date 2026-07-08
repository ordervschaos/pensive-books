# PM — the operating system for building Pensive

> **What this is.** The project-management knowledgebase for Pensive. Where `docs/NORTH_STAR.md`
> answers *why and when are we done*, and `docs/*.md` answer *how things work*, this folder answers
> **where are we, what's next, and what did we decide.** It is a living operational surface —
> stale PM docs are worse than none, so every file states its update rule.

## The files

| File | Question it answers | Update rhythm |
|---|---|---|
| [STATE.md](STATE.md) | What exists? What status is each project in? | When something ships, parks, or dies |
| [ROADMAP.md](ROADMAP.md) | What are we doing now / next / later? What's the milestone? | When priorities change (weekly-ish review) |
| [GTM.md](GTM.md) | How does this reach users and make money? | When strategy thinking advances |
| [DECISIONS.md](DECISIONS.md) | Why did we choose X? | Append-only, at decision time |
| [WORKLOG.md](WORKLOG.md) | What work was actually done, task by task? | Append-only, at end of every task (via `/wrap`) |

## Two layers: firehose vs. curated view

The files above split into two layers — the same shape as an event log feeding a materialized view:

- **WORKLOG.md is the firehose** — one entry per *task*, append-only, newest first. It is the
  raw catalogue of everything done. **It is never read into an agent session — write-only** — so
  it grows forever at zero context cost. Don't rank it, summarize it, or load it.
- **STATE / ROADMAP / DECISIONS are the curated view** — one row per *project*, ranked and
  pruned, read at session start. Only *significant* worklog entries (`ship`/`decision`/`park`)
  get **promoted** up into them.

**The `/wrap` command is the chokepoint that routes all work through the PM.** Run it at the end
of a task: it always appends the WORKLOG entry, then promotes ships/decisions/parks to the curated
files, then stamps the change-set. A **Stop hook** (`.claude/hooks/pm-worklog.sh`) enforces it —
if a session ends with a dirty tree that hasn't been catalogued, it nudges once (idempotent via a
gitignored sentinel; no loops). This is why cataloguing doesn't rely on anyone remembering.

Full architectural decision records live in `docs/adr/` — DECISIONS.md is the index + the
lighter-weight log for product/strategy calls that don't need a full ADR.

## The three hats

Every review pass looks at the same state through three lenses:

- **Business owner** — is this moving toward something people will pay for? Cost, wedge, moat,
  distribution. (GTM.md, NORTH_STAR §7.)
- **Product manager** — is this moving the North Star metric (read-through depth, generation
  ease, intuitiveness)? Is the roadmap ranked by that, not by what's fun? (ROADMAP.md, NORTH_STAR §2.)
- **Builder** — is this shippable, small, verifiable? What's the real status, including the
  unglamorous half-done parts? (STATE.md.)

A feature must survive all three hats to sit in **Now**.

## Status vocabulary (used everywhere)

`shipped` · `in-flight` (being built) · `next` (committed, not started) · `parked` (deliberate
pause, reason noted) · `retired` (superseded/deleted, kept for history)

## How to drive this (the interaction model)

**The files are the state; the conversation is the interface.** You don't fill forms — you talk
to Claude in a session, and the session reads/updates these files. Git is the audit log (every
change is a diff with history). A session-start memory points Claude here, so no ritual needed.

**`/pm` is the formal entry point** (`.claude/commands/pm.md`): `/pm` alone = three-hats review
with a git drift-check; or `/pm status` · `/pm shipped <thing>` · `/pm next` · `/pm gtm` ·
`/pm decision <text>`. Plain sentences work too — the command just makes the ritual one keystroke.

Entry points — say the thing, in plain words:

| You say (any phrasing) | What happens | Output |
|---|---|---|
| "what's the status?" / "where are we?" | Reads STATE + ROADMAP | Status report in chat |
| "X shipped" | Moves the row in STATE, frees a Now slot | Updated STATE.md (+ DECISIONS if scope changed) |
| "what should we build next?" | Ranks candidates against M1 → NORTH_STAR §2 | Recommendation + reasoning; ROADMAP edit once you ratify |
| "let's review" | Three-hats pass (owner/PM/builder) over STATE + ROADMAP | Findings + proposed re-rank; files updated on agreement |
| "let's strategize GTM" | Works GTM.md's open questions | Discussion → GTM.md advances from draft toward plan |
| "why is X like this?" | Checks DECISIONS.md / docs/adr/ | The recorded why (or flags that it was never logged) |
| "we decided Y" | Appends to DECISIONS.md | One dated entry, newest first |

You can also just open and edit the files directly (IDE, GitHub) — they're plain markdown you
own. Claude treats your edits as ground truth, never "corrects" them back.

**Division of labor:** Claude proposes, ranks, keeps files consistent, and remembers to update
them after ships. You ratify priorities, make the calls that land in DECISIONS.md, and are the
read-through judge. Same rule as the product: *AI proposes; the author owns.*

## Operating cadence

1. **After any ship:** update STATE.md (move the row, one line of what landed).
2. **Session start (when planning):** read ROADMAP.md → Now. If Now is empty or wrong, fix it
   before building.
3. **Review (roughly weekly):** three-hats pass over STATE + ROADMAP; prune, re-rank, log
   decisions.
4. **Never** route around these files — if reality disagrees with the doc, change the doc.
