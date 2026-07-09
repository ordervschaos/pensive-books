#!/bin/sh
# PM SessionStart hook.
#
# Deterministically injects the current priorities into every session's context, so "Claude knows
# what we're working on" stops depending on the model recalling an auto-memory pointer. Emits the
# ROADMAP.md "Now" section verbatim, plus a staleness nudge when STATE.md's snapshot date is more
# than STALE_DAYS old (the ~weekly three-hats review is otherwise held only by human memory — the
# exact failure mode this PM system exists to kill).
#
# Output contract: SessionStart hooks add `hookSpecificOutput.additionalContext` to the session.
# Fails OPEN (emits nothing) on any error — a broken hook must never wedge session start.

set -u

STALE_DAYS=7

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$ROOT" ] || exit 0
ROADMAP="$ROOT/pm/ROADMAP.md"
STATE="$ROOT/pm/STATE.md"
[ -f "$ROADMAP" ] || exit 0

# --- extract the "## 🔵 Now" section (up to the next "## " heading) ------------
NOW_SECTION="$(awk '
  /^## / {
    if (inNow) exit
    if ($0 ~ /Now/) { inNow=1; print; next }
  }
  inNow { print }
' "$ROADMAP" 2>/dev/null)"

[ -n "$NOW_SECTION" ] || exit 0

# --- staleness of the curated view --------------------------------------------
STALE_NOTE=""
if [ -f "$STATE" ]; then
  SNAP="$(grep -m1 'Snapshot date' "$STATE" 2>/dev/null | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -n1)"
  if [ -n "$SNAP" ]; then
    SNAP_S="$(date -j -f "%Y-%m-%d" "$SNAP" +%s 2>/dev/null || date -d "$SNAP" +%s 2>/dev/null)"
    NOW_S="$(date +%s 2>/dev/null)"
    if [ -n "$SNAP_S" ] && [ -n "$NOW_S" ]; then
      AGE=$(( (NOW_S - SNAP_S) / 86400 ))
      if [ "$AGE" -gt "$STALE_DAYS" ]; then
        STALE_NOTE="⏳ STATE.md snapshot is ${AGE} days old (> ${STALE_DAYS}) — consider a \`/pm review\` (three-hats pass + git drift check) before pulling new work."
      fi
    fi
  fi
fi

# --- assemble content ---------------------------------------------------------
CONTENT="PM — current priorities (from pm/ROADMAP.md; the pm/ folder is the operational source of truth, /wrap catalogues each task):

${NOW_SECTION}"
[ -n "$STALE_NOTE" ] && CONTENT="${CONTENT}

${STALE_NOTE}"

# --- emit as JSON additionalContext (pure-shell escape: \\, ", newline) --------
ESCAPED="$(printf '%s\n' "$CONTENT" | awk '
  BEGIN { ORS="" }
  { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); if (NR > 1) printf "\\n"; printf "%s", $0 }
')"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ESCAPED"
exit 0
