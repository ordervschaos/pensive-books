#!/bin/sh
# PM worklog Stop hook.
#
# Two modes:
#   (no arg, reads Stop-hook JSON on stdin) → if the working tree is dirty and this exact
#      change-set has not been catalogued, block the stop once and nudge Claude to run /wrap.
#   `stamp`  → record the current change-set as catalogued (called by /wrap's last step).
#
# Idempotency: the sentinel stores a hash of `git status --porcelain`. A clean tree, or a state
# that matches the sentinel, exits silently. `stop_hook_active` guards the immediate re-fire so
# there is exactly one nudge per uncatalogued change-set. Fails OPEN on any error — never blocks.

set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$ROOT" ] || exit 0
SENTINEL="$ROOT/.claude/.pm-wrap-state"

fingerprint() {
  git -C "$ROOT" status --porcelain 2>/dev/null | shasum 2>/dev/null | awk '{print $1}'
}

# --- stamp mode ---------------------------------------------------------------
if [ "${1:-}" = "stamp" ]; then
  fingerprint > "$SENTINEL" 2>/dev/null || true
  exit 0
fi

# --- hook mode ----------------------------------------------------------------
INPUT="$(cat)"

# Already continuing because of a stop hook → don't nag a second time.
case "$INPUT" in
  *'"stop_hook_active":true'*) exit 0 ;;
esac

# clean tree → nothing to catalogue
[ -z "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ] && exit 0

# Use the SAME fingerprint() as stamp mode so the bytes hashed are identical.
CUR="$(fingerprint)"
SEEN=""
[ -f "$SENTINEL" ] && SEEN="$(cat "$SENTINEL" 2>/dev/null)"
[ "$CUR" = "$SEEN" ] && exit 0   # this exact change-set already catalogued

cat <<'JSON'
{"decision":"block","reason":"Uncatalogued work: the working tree is dirty and pm/WORKLOG.md has not been updated for this change-set. Before ending, run the /wrap ritual — prepend one dated entry to pm/WORKLOG.md (with an impact tag: ship/wip/decision/park/chore), then promote ship/decision/park to pm/STATE.md / ROADMAP.md / DECISIONS.md, then stamp. If these changes are not worth cataloguing, running /wrap and reaching its stamp step is still the correct acknowledgement."}
JSON
exit 0
