#!/usr/bin/env bash
# check-edge-functions — deno check over every real edge fn (skips _shared/, which has no
# index.ts of its own). Requires `deno` locally. Uses _shared/deno-ambient.d.ts to silence the
# EdgeRuntime-not-found false positive (that global only exists in Supabase's deployed runtime).
set -euo pipefail
cd "$(dirname "$0")/../supabase/functions"

shim="_shared/deno-ambient.d.ts"
fail=0
out="$(mktemp)"
for dir in */; do
  fn="${dir%/}"
  [ "$fn" = "_shared" ] && continue
  [ -f "$fn/index.ts" ] || continue
  if deno check --no-lock "$shim" "$fn/index.ts" >"$out" 2>&1; then
    echo "ok:   $fn"
  else
    echo "FAIL: $fn"
    cat "$out"
    fail=1
  fi
done
rm -f "$out"
exit $fail
