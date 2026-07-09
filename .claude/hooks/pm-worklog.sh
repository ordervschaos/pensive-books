#!/bin/sh
# PM worklog Stop hook.
#
# Two modes:
#   (no arg, reads Stop-hook JSON on stdin) → if there is uncatalogued work — either uncommitted
#      working-tree changes, OR commits made since the last stamp that never touched
#      pm/WORKLOG.md — block the stop once and nudge Claude to run /wrap.
#   `stamp`  → record the current change-set as catalogued (called by /wrap's last step).
#
# The sentinel (`.claude/.pm-wrap-state`, gitignored) stores TWO lines:
#   line 1: a hash of `git status --porcelain`  (the working-tree fingerprint)
#   line 2: the HEAD commit sha at stamp time    (the committed-work baseline)
# Old single-line sentinels are auto-detected (line1 == line2) and treated as "no HEAD baseline",
# so the committed-work check simply stays off until the next stamp re-writes both lines.
#
# Two independent things can be uncatalogued:
#   (a) WORKING TREE — the tree is dirty and its fingerprint differs from the stamped one.
#   (b) COMMITS — HEAD advanced past the stamped baseline via commit(s) that (i) touched files
#       outside pm/ (real work, not just PM bookkeeping) and (ii) never touched pm/WORKLOG.md
#       (so the catalogue commit itself, and pure /pm curated-file commits, are correctly exempt).
# Either one fires the nudge. This is what closes the "committed everything, clean tree, walked
# past the hook" hole that a plain `git status --porcelain` emptiness check missed.
#
# Idempotency: `stamp` records the current (fingerprint, HEAD). A state matching the sentinel, or
# a clean tree with no new real commits, exits silently — exactly one nudge per uncatalogued
# change-set. `stop_hook_active` guards the immediate re-fire. Fails OPEN on any error/ambiguity
# (e.g. a rebased baseline that is no longer an ancestor) — never blocks.

set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$ROOT" ] || exit 0
SENTINEL="$ROOT/.claude/.pm-wrap-state"

fingerprint() {
  git -C "$ROOT" status --porcelain 2>/dev/null | shasum 2>/dev/null | awk '{print $1}'
}
head_sha() {
  git -C "$ROOT" rev-parse HEAD 2>/dev/null
}

# --- stamp mode ---------------------------------------------------------------
if [ "${1:-}" = "stamp" ]; then
  { fingerprint; head_sha; } > "$SENTINEL" 2>/dev/null || true
  exit 0
fi

# --- hook mode ----------------------------------------------------------------
INPUT="$(cat)"

# Already continuing because of a stop hook → don't nag a second time.
case "$INPUT" in
  *'"stop_hook_active":true'*) exit 0 ;;
esac

PORC="$(git -C "$ROOT" status --porcelain 2>/dev/null)"
CUR_FP="$(fingerprint)"
CUR_HEAD="$(head_sha)"

SEEN_FP=""
SEEN_HEAD=""
if [ -f "$SENTINEL" ]; then
  SEEN_FP="$(head -n1 "$SENTINEL" 2>/dev/null)"
  SEEN_HEAD="$(tail -n1 "$SENTINEL" 2>/dev/null)"
  # Old single-line sentinel: both reads return the same line → no HEAD baseline.
  [ "$SEEN_FP" = "$SEEN_HEAD" ] && SEEN_HEAD=""
fi

uncatalogued=0

# (a) uncommitted working-tree changes not yet catalogued
if [ -n "$PORC" ] && [ "$CUR_FP" != "$SEEN_FP" ]; then
  uncatalogued=1
fi

# (b) real commits since the stamped baseline that never touched pm/WORKLOG.md
if [ "$uncatalogued" = "0" ] && [ -n "$SEEN_HEAD" ] && [ -n "$CUR_HEAD" ] && [ "$CUR_HEAD" != "$SEEN_HEAD" ]; then
  # Only reason about a linear advance; anything else (rebase/amend) fails open.
  if git -C "$ROOT" merge-base --is-ancestor "$SEEN_HEAD" "$CUR_HEAD" 2>/dev/null; then
    RANGE="$SEEN_HEAD..$CUR_HEAD"
    NONPM="$(git -C "$ROOT" log --format=%H "$RANGE" -- . ':(exclude)pm/' 2>/dev/null)"
    WL="$(git -C "$ROOT" log --format=%H "$RANGE" -- pm/WORKLOG.md 2>/dev/null)"
    if [ -n "$NONPM" ] && [ -z "$WL" ]; then
      uncatalogued=1
    fi
  fi
fi

[ "$uncatalogued" = "0" ] && exit 0

cat <<'JSON'
{"decision":"block","reason":"Uncatalogued work: there are uncommitted changes and/or commits since the last catalogue that pm/WORKLOG.md has not been updated for. Before ending, run the /wrap ritual — prepend one dated entry to pm/WORKLOG.md (with an impact tag: ship/wip/decision/park/chore), then promote ship/decision/park to pm/STATE.md / ROADMAP.md / DECISIONS.md, then stamp. If these changes are not worth cataloguing, running /wrap and reaching its stamp step is still the correct acknowledgement."}
JSON
exit 0
