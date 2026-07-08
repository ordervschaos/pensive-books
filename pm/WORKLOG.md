# WORKLOG — append-only catalogue of work

> The **firehose**. Every completed unit of work lands here as one dated entry, newest first.
> Where `STATE.md`/`ROADMAP.md` are the *curated projection* (one row per project, ranked),
> this is the *raw event log* (one entry per task). Think event-sourcing: cheap appends here,
> a hand-curated read-model there.
>
> **This file is never read into an agent session — it is write-only.** It can grow forever at
> zero context cost. Don't summarize it, don't load it, don't rank it. Just append.
>
> Written by the **`/wrap`** ritual at the end of a task. Impact tags:
> `ship` (landed → promote to STATE) · `decision` (→ DECISIONS) · `park` (→ STATE/ROADMAP) ·
> `wip` (in progress, no promotion) · `chore` (housekeeping, no promotion).

<!-- NEWEST ENTRIES GO DIRECTLY BELOW THIS LINE (prepend, do not append at the bottom) -->

## 2026-07-09 — PM work-routing system: WORKLOG + /wrap + Stop hook `[decision]`
- **What:** Built the mechanism to route all work through the PM. New append-only firehose
  `pm/WORKLOG.md` (one entry per task, write-only — never loaded into context). New `/wrap`
  command as the end-of-task chokepoint: catalogue → promote ships/decisions to STATE/ROADMAP/
  DECISIONS → stamp. A Stop hook (`.claude/hooks/pm-worklog.sh`) enforces it — nudges once per
  dirty, uncatalogued change-set; idempotent via a gitignored fingerprint sentinel. Fixed a
  trailing-newline bug that made stamp/hook hashes never match.
- **Files/commits:** pm/WORKLOG.md, .claude/commands/wrap.md, .claude/hooks/pm-worklog.sh,
  .claude/settings.json (Stop hook), .claude/settings.local.json, .gitignore, pm/README.md
  (all uncommitted).
- **PM impact:** DECISIONS entry added (process/tooling change). No STATE product-board row —
  it's infra for how we work, not a product project.

## 2026-07-09 — Kindle settings: instruct user to whitelist hello@pensive.me `[ship]`
- **What:** Send-to-Kindle emails from hello@pensive.me were silently dropped by Amazon unless the
  user pre-approves the sender in their Personal Document Settings. Added an instructional card to
  the Kindle settings page (above the email/verification form) pointing the user to Amazon's Manage
  Your Content and Devices → Preferences → Personal Document Settings to add hello@pensive.me to
  their Approved Personal Document E-mail List.
- **Files/commits:** apps/web/src/pages/settings/KindleSettings.tsx (uncommitted).
- **PM impact:** none — minor UX fix on an already-shipped feature, not tracked as its own
  STATE/ROADMAP row.
