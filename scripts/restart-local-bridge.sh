#!/usr/bin/env bash
# restart-local-bridge — fully restart the local claude-local bridge that the book-agent edge
# function talks to in dev. Two moving parts:
#   1. claude-local-shim  (host :8788)         — runs the model calls on your laptop's `claude` CLI
#   2. supabase functions serve (edge :54321)  — the edge runtime; reaches the shim at
#                                                host.docker.internal:8788 via CLAUDE_LOCAL_URL
# A dead edge-runtime is what surfaces in the app as "book-agent 503" (Kong has no upstream).
#
# Usage:  pnpm bridge:restart   (or: bash scripts/restart-local-bridge.sh)
# Logs:   .bridge-shim.log, .bridge-serve.log  (both gitignored via *.log)
set -uo pipefail
cd "$(dirname "$0")/.."

SHIM_PORT="${CLAUDE_LOCAL_SHIM_PORT:-8788}"
FN_URL="http://127.0.0.1:54321/functions/v1/book-agent"
ENV_FILE="supabase/functions/.env"
SHIM_LOG=".bridge-shim.log"
SERVE_LOG=".bridge-serve.log"

echo "→ stopping existing bridge processes…"
pkill -f 'scripts/claude-local-shim.mjs'      2>/dev/null && echo "  killed shim"  || echo "  no shim running"
pkill -f 'supabase functions serve'           2>/dev/null && echo "  killed serve" || echo "  no serve running"
sleep 1

# Preflight: the edge runtime is a Docker container — the rest of the Supabase stack must be up.
if ! docker ps --format '{{.Names}}' | grep -q supabase_kong; then
  echo "✗ Supabase stack is not running. Start it first:  pnpm functions:start" >&2
  exit 1
fi
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE missing — the shim bridge needs CLAUDE_LOCAL_URL from it." >&2
  exit 1
fi

echo "→ starting claude-local-shim on :$SHIM_PORT …"
nohup node scripts/claude-local-shim.mjs > "$SHIM_LOG" 2>&1 & disown

echo "→ starting supabase functions serve …"
nohup supabase functions serve --env-file "$ENV_FILE" > "$SERVE_LOG" 2>&1 & disown

# ── Health: shim listening, then edge fn reachable (any non-503 = upstream is alive) ──
echo -n "→ waiting for shim "
for i in $(seq 1 15); do
  if curl -sf -o /dev/null "http://127.0.0.1:$SHIM_PORT/" 2>/dev/null \
     || lsof -iTCP:"$SHIM_PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then echo " up"; break; fi
  echo -n "."; sleep 1
  [ "$i" = 15 ] && { echo " ✗ shim never came up — see $SHIM_LOG"; exit 1; }
done

echo -n "→ waiting for edge runtime "
# 503/502/000 = no/booting upstream → keep polling. A real HTTP reply (401 expected on this
# unauthenticated ping, or any 2xx/4xx) means the worker is serving.
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FN_URL" \
         -H "content-type: application/json" -d '{}' 2>/dev/null)
  case "$code" in
    503|502|000) echo -n "." ;;
    *) echo " up (HTTP $code — 401 is expected here)"; break ;;
  esac
  sleep 2
  [ "$i" = 30 ] && { echo " ✗ edge runtime never served (last HTTP $code) — see $SERVE_LOG"; exit 1; }
done

echo "✓ bridge live: shim :$SHIM_PORT + book-agent edge fn. Retry the agent in the app."
