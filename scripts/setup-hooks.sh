#!/bin/bash
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SCRIPTS_DIR="$REPO_ROOT/scripts"

# Install pre-push hook
cat > "$HOOKS_DIR/pre-push" << 'EOF'
#!/bin/bash
exec "$(git rev-parse --show-toplevel)/scripts/pre-push.sh"
EOF

chmod +x "$HOOKS_DIR/pre-push"
chmod +x "$SCRIPTS_DIR/pre-push.sh"

echo "Git hooks installed."
