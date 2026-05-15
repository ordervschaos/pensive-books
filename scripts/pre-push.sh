#!/bin/bash
set -e

echo ""
echo "Running pre-push checks..."
echo ""

# TypeScript typecheck
echo ">> Typechecking web..."
corepack pnpm --filter @pensive/web typecheck

echo ""

# Tests
echo ">> Running tests..."
corepack pnpm --filter @pensive/web test:run

echo ""

# Lint
echo ">> Linting..."
corepack pnpm --filter @pensive/web lint

echo ""
echo "All checks passed. Pushing..."
echo ""
