---
description: End-of-task ritual — catalogue the work in pm/WORKLOG.md and promote ships to the PM knowledgebase
---

# /wrap — catalogue this task, update the PM

Optional note from the user: `$ARGUMENTS`

Run this once when a unit of work is done. It routes all work through the PM in two layers:
**catalogue** (always) then **promote** (only what matters). Do the steps in order.

## 1. Catalogue — always

Prepend **one** entry to `pm/WORKLOG.md`, directly below the `<!-- NEWEST ENTRIES -->` marker.
Do **not** read the rest of the file — it is write-only; just prepend.

- Figure out what changed from `git status`, `git diff --stat`, recent commits, and this session.
- Pick one impact tag: `ship` · `decision` · `park` · `wip` · `chore`.
- Format (keep it to a handful of lines, plain language):

```
## <YYYY-MM-DD> — <one-line title> `[tag]`
- **What:** 1–2 lines on what was done and why.
- **Files/commits:** key paths (+ short SHAs if committed).
- **PM impact:** where it was promoted, or "none".
```

Get the date from `date +%Y-%m-%d`.

## 2. Promote — only if it matters

Reuse `/pm` rules. Mechanical truth-keeping applies directly; priority/strategy changes need the
author's ratification first (**AI proposes; the author owns** — propose, don't silently re-rank).

- `ship` → move/update the project's row in `pm/STATE.md`; free the Now slot in `pm/ROADMAP.md`;
  one `pm/DECISIONS.md` line if scope changed en route.
- `decision` → append a dated entry to `pm/DECISIONS.md` (newest first).
- `park` → mark the row `parked` in STATE with the reason; adjust ROADMAP.
- `wip` / `chore` → no promotion. Skip to step 3.
- Update the **snapshot date** on any curated file you touch.

## 3. Stamp — always, last

Run this so the Stop hook knows this change-set is catalogued and won't nudge again:

```
.claude/hooks/pm-worklog.sh stamp
```

If you decided the changes weren't worth cataloguing, running `/wrap` and reaching this stamp is
still the correct escape hatch — it acknowledges the change-set. (Or run the stamp line alone.)
