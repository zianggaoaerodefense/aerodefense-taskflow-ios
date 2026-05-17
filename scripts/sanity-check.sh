#!/usr/bin/env bash
# =============================================================================
# Daily Workflow Management App — Sanity Check Script
# =============================================================================
# Verifies that the development environment is set up correctly.
# Run this after following the setup guides to confirm everything is working.
#
# Usage: bash scripts/sanity-check.sh
# =============================================================================

set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
WARN=0
FAIL=0

pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS + 1)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; WARN=$((WARN + 1)); }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL + 1)); }

echo "Daily Workflow Management App — Sanity Check"
echo "============================================="
echo ""

# -------------------------------------------------------------------------
# Node.js
# -------------------------------------------------------------------------
echo "--- Node.js ---"
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -ge 18 ]; then
    pass "Node.js $NODE_VERSION (>= 18 required)"
  else
    fail "Node.js $NODE_VERSION is too old — version 18 or later is required"
  fi
else
  fail "Node.js not found — install from https://nodejs.org/"
fi

# -------------------------------------------------------------------------
# npm
# -------------------------------------------------------------------------
if command -v npm &> /dev/null; then
  pass "npm $(npm --version)"
else
  fail "npm not found"
fi

# -------------------------------------------------------------------------
# Expo CLI
# -------------------------------------------------------------------------
echo ""
echo "--- Expo ---"
if command -v expo &> /dev/null; then
  pass "expo CLI found: $(expo --version 2>/dev/null || echo 'installed')"
elif command -v npx &> /dev/null; then
  pass "npx available — can use 'npx expo' without global install"
else
  warn "expo CLI not found globally — use 'npx expo start' instead"
fi

# -------------------------------------------------------------------------
# app/ directory
# -------------------------------------------------------------------------
echo ""
echo "--- App directory ---"
if [ -d "app" ]; then
  pass "app/ directory exists"
else
  fail "app/ directory not found — are you in the repo root?"
fi

if [ -f "app/package.json" ]; then
  pass "app/package.json exists"
else
  fail "app/package.json not found"
fi

if [ -d "app/node_modules" ]; then
  pass "app/node_modules exists — dependencies installed"
else
  warn "app/node_modules not found — run: cd app && npm install"
fi

# -------------------------------------------------------------------------
# Environment variables
# -------------------------------------------------------------------------
echo ""
echo "--- Environment variables ---"

if [ -f "app/.env" ]; then
  pass "app/.env exists"

  SUPABASE_URL_VAL=$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' app/.env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
  SUPABASE_KEY_VAL=$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' app/.env | cut -d'=' -f2- | tr -d '"' | tr -d "'")

  if [ -z "$SUPABASE_URL_VAL" ] || [ "$SUPABASE_URL_VAL" = "https://your-project-ref.supabase.co" ]; then
    fail "EXPO_PUBLIC_SUPABASE_URL is not set or still a placeholder in app/.env"
  elif echo "$SUPABASE_URL_VAL" | grep -q "supabase.co"; then
    pass "EXPO_PUBLIC_SUPABASE_URL looks like a Supabase URL"
  else
    warn "EXPO_PUBLIC_SUPABASE_URL is set but doesn't look like a Supabase URL: $SUPABASE_URL_VAL"
  fi

  if [ -z "$SUPABASE_KEY_VAL" ] || [ "$SUPABASE_KEY_VAL" = "your-supabase-anon-key" ]; then
    fail "EXPO_PUBLIC_SUPABASE_ANON_KEY is not set or still a placeholder in app/.env"
  elif echo "$SUPABASE_KEY_VAL" | grep -q "^eyJ"; then
    pass "EXPO_PUBLIC_SUPABASE_ANON_KEY looks like a JWT"
  else
    warn "EXPO_PUBLIC_SUPABASE_ANON_KEY is set but doesn't look like a JWT"
  fi
else
  fail "app/.env not found — run: cp app/.env.example app/.env and fill in values"
fi

# -------------------------------------------------------------------------
# Security: no secrets in example files
# -------------------------------------------------------------------------
echo ""
echo "--- Security: .env.example files ---"

check_env_example() {
  local file="$1"
  if [ -f "$file" ]; then
    # Check that the URL is a placeholder
    if grep -qE "yeoptggqtxdulhhwfbgk" "$file" 2>/dev/null || grep -qE "supabase\.co.*eyJ" "$file" 2>/dev/null; then
      fail "$file appears to contain a real Supabase project URL or key — replace with placeholders"
    else
      pass "$file contains only placeholder values"
    fi
  fi
}

check_env_example ".env.example"
check_env_example "app/.env.example"

# -------------------------------------------------------------------------
# Security: no .env committed to git
# -------------------------------------------------------------------------
echo ""
echo "--- Security: committed files ---"

if git -C . rev-parse --git-dir > /dev/null 2>&1; then
  if git ls-files app/.env 2>/dev/null | grep -q "app/.env$"; then
    fail "app/.env is tracked by git — remove it: git rm --cached app/.env"
  else
    pass "app/.env is not tracked by git"
  fi

  if git ls-files .env 2>/dev/null | grep -q "^.env$"; then
    fail ".env is tracked by git — remove it: git rm --cached .env"
  else
    pass ".env is not tracked by git"
  fi
fi

# -------------------------------------------------------------------------
# Supabase CLI (optional)
# -------------------------------------------------------------------------
echo ""
echo "--- Supabase CLI (optional) ---"
if command -v supabase &> /dev/null; then
  pass "supabase CLI found: $(supabase --version 2>/dev/null)"
else
  warn "supabase CLI not found — optional for local development. Install: brew install supabase/tap/supabase"
fi

# -------------------------------------------------------------------------
# Migration files
# -------------------------------------------------------------------------
echo ""
echo "--- Migrations ---"
if ls supabase/migrations/*.sql 2>/dev/null | head -1 | grep -q ".sql"; then
  MIGRATION_COUNT=$(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
  pass "Found $MIGRATION_COUNT migration file(s) in supabase/migrations/"
else
  fail "No migration files found in supabase/migrations/"
fi

# -------------------------------------------------------------------------
# Edge Functions
# -------------------------------------------------------------------------
echo ""
echo "--- Edge Functions ---"
EXPECTED_FUNCTIONS=("agent-context" "agent-write" "agent-update-task" "create-agent-connection" "revoke-agent-connection")
for fn in "${EXPECTED_FUNCTIONS[@]}"; do
  if [ -f "supabase/functions/$fn/index.ts" ]; then
    pass "Edge Function: $fn"
  else
    fail "Edge Function missing: supabase/functions/$fn/index.ts"
  fi
done

# -------------------------------------------------------------------------
# LICENSE
# -------------------------------------------------------------------------
echo ""
echo "--- Legal ---"
if [ -f "LICENSE" ]; then
  pass "LICENSE file exists"
else
  warn "LICENSE file not found — add one before open-source release"
fi

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo ""
echo "============================================="
echo "Results: ${PASS} passed, ${WARN} warnings, ${FAIL} failed"
echo "============================================="
if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}Fix the failed checks before proceeding.${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}Review the warnings above.${NC}"
  exit 0
else
  echo -e "${GREEN}All checks passed.${NC}"
  exit 0
fi
