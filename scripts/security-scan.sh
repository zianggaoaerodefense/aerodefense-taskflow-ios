#!/usr/bin/env bash
# =============================================================================
# Daily Workflow Management App — Security Scan Script
# =============================================================================
# Scans the repository for common secret patterns and sensitive data.
# Run this before open-source release and as part of your development workflow.
#
# Usage: bash scripts/security-scan.sh
#
# This script uses grep/ripgrep to look for patterns — it is not a replacement
# for a dedicated secret scanner like gitleaks or trufflehog. Use both.
# =============================================================================

set -o pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

FINDINGS=0

warn_finding() {
  echo -e "${RED}[FINDING]${NC} $1"
  FINDINGS=$((FINDINGS + 1))
}

info() {
  echo -e "${YELLOW}[INFO]${NC} $1"
}

pass() {
  echo -e "${GREEN}[CLEAN]${NC} $1"
}

# Determine grep command (prefer ripgrep)
if command -v rg &> /dev/null; then
  GREP="rg -n --no-heading"
  GREP_IGNORE="--glob '!node_modules/**' --glob '!*.lock' --glob '!.git/**' --glob '!dist/**' --glob '!build/**'"
else
  GREP="grep -rn"
  GREP_IGNORE="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude='*.lock'"
fi

echo "Daily Workflow Management App — Security Scan"
echo "=============================================="
echo ""

# -------------------------------------------------------------------------
# 1. Known secret token prefixes
# -------------------------------------------------------------------------
echo "--- Checking for known secret patterns ---"

scan_pattern() {
  local description="$1"
  local pattern="$2"
  local exclude_files="$3"

  # Use eval to handle the glob patterns in GREP_IGNORE
  if command -v rg &> /dev/null; then
    result=$(rg -n --no-heading "$pattern" . \
      --glob '!node_modules/**' \
      --glob '!*.lock' \
      --glob '!.git/**' \
      --glob '!dist/**' \
      --glob '!build/**' \
      --glob '!scripts/security-scan.sh' \
      2>/dev/null || true)
  else
    result=$(grep -rn "$pattern" . \
      --exclude-dir=node_modules \
      --exclude-dir=.git \
      --exclude-dir=dist \
      --exclude-dir=build \
      --exclude='*.lock' \
      --exclude='security-scan.sh' \
      2>/dev/null || true)
  fi

  if [ -n "$result" ]; then
    warn_finding "$description"
    echo "$result" | head -20
    echo ""
  else
    pass "$description"
  fi
}

scan_pattern "GitHub tokens (ghp_)" "ghp_[a-zA-Z0-9]{36}"
scan_pattern "GitHub OAuth tokens (gho_)" "gho_[a-zA-Z0-9]{36}"
scan_pattern "OpenAI API keys (sk-)" "sk-[a-zA-Z0-9]{20,}"
scan_pattern "Anthropic API keys (sk-ant-)" "sk-ant-[a-zA-Z0-9\-]{20,}"
scan_pattern "Slack bot tokens (xoxb-)" "xoxb-[a-zA-Z0-9\-]+"
scan_pattern "Slack user tokens (xoxp-)" "xoxp-[a-zA-Z0-9\-]+"
scan_pattern "AWS access keys (AKIA)" "AKIA[A-Z0-9]{16}"
scan_pattern "Google API keys (AIza)" "AIza[0-9A-Za-z\-_]{35}"

# -------------------------------------------------------------------------
# 2. Real Supabase project references
# -------------------------------------------------------------------------
echo ""
echo "--- Checking for real Supabase project references ---"

# Check for the specific project ref that was in the original .env.example
# (This script itself is excluded from the scan since it legitimately references the pattern)
KNOWN_PROJECT_REF="yeoptggqtxdulhhwfbgk"
if command -v rg &> /dev/null; then
  result=$(rg -n "$KNOWN_PROJECT_REF" . \
    --glob '!node_modules/**' --glob '!*.lock' --glob '!.git/**' \
    --glob '!scripts/security-scan.sh' \
    --glob '!scripts/sanity-check.sh' \
    2>/dev/null || true)
else
  result=$(grep -rn "$KNOWN_PROJECT_REF" . \
    --exclude-dir=node_modules --exclude-dir=.git --exclude='*.lock' \
    --exclude='security-scan.sh' --exclude='sanity-check.sh' \
    2>/dev/null || true)
fi

if [ -n "$result" ]; then
  warn_finding "Real Supabase project ref found — replace with placeholder (e.g. 'your-project-ref')"
  echo "$result"
  echo ""
else
  pass "No references to known real Supabase project refs"
fi

# -------------------------------------------------------------------------
# 3. Naming: product name check
# -------------------------------------------------------------------------
echo ""
echo "--- Checking for deprecated product naming ---"

if command -v rg &> /dev/null; then
  result=$(rg -ni "CTO workflow|cto_workflow" . \
    --glob '!node_modules/**' --glob '!*.lock' --glob '!.git/**' \
    --glob '!scripts/security-scan.sh' \
    --glob '!docs/SECURITY.md' \
    --glob '!docs/OPEN_SOURCE_RELEASE_CHECKLIST.md' \
    2>/dev/null || true)
else
  result=$(grep -rni "CTO workflow\|cto_workflow" . \
    --exclude-dir=node_modules --exclude-dir=.git --exclude='*.lock' \
    --exclude='security-scan.sh' --exclude='SECURITY.md' --exclude='OPEN_SOURCE_RELEASE_CHECKLIST.md' \
    2>/dev/null || true)
fi

if [ -n "$result" ]; then
  warn_finding "Found 'CTO workflow' naming in non-documentation files — replace with 'Daily Workflow' or 'Daily Workflow Management'"
  echo "$result"
  echo ""
else
  pass "No 'CTO workflow' naming found in source files"
fi

# -------------------------------------------------------------------------
# 4. Service role key patterns
# -------------------------------------------------------------------------
echo ""
echo "--- Checking for service role key patterns ---"

if command -v rg &> /dev/null; then
  result=$(rg -ni "service_role_key\s*=\s*eyJ|SUPABASE_SERVICE_ROLE_KEY\s*=\s*eyJ" . \
    --glob '!node_modules/**' --glob '!*.lock' --glob '!.git/**' \
    2>/dev/null || true)
else
  result=$(grep -rni "service_role_key.*=.*eyJ\|SUPABASE_SERVICE_ROLE_KEY.*=.*eyJ" . \
    --exclude-dir=node_modules --exclude-dir=.git --exclude='*.lock' \
    2>/dev/null || true)
fi

if [ -n "$result" ]; then
  warn_finding "Possible service role key value found in files"
  echo "$result"
  echo ""
else
  pass "No service role key values found in files"
fi

# -------------------------------------------------------------------------
# 5. .env files committed to git
# -------------------------------------------------------------------------
echo ""
echo "--- Checking git for committed .env files ---"

if git -C . rev-parse --git-dir > /dev/null 2>&1; then
  committed_env=$(git ls-files | grep -E '(^|/)\.env$' || true)
  if [ -n "$committed_env" ]; then
    warn_finding ".env files are tracked by git"
    echo "$committed_env"
    echo ""
    info "Remove with: git rm --cached <file> && git commit"
  else
    pass "No .env files tracked by git"
  fi
fi

# -------------------------------------------------------------------------
# 6. JWT patterns in example files
# -------------------------------------------------------------------------
echo ""
echo "--- Checking .env.example files for real JWT values ---"

for env_example_file in $(find . -name ".env.example" -not -path "*/node_modules/*" 2>/dev/null); do
  # A real JWT has 3 base64-encoded sections. Placeholder 'your-supabase-anon-key' is not a JWT.
  jwt_found=$(grep -E "eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+" "$env_example_file" 2>/dev/null || true)
  if [ -n "$jwt_found" ]; then
    warn_finding "$env_example_file contains what looks like a real JWT — replace with a placeholder"
    echo "$jwt_found"
    echo ""
  else
    pass "$env_example_file looks clean (no JWT values)"
  fi
done

# -------------------------------------------------------------------------
# 7. Real email addresses
# -------------------------------------------------------------------------
echo ""
echo "--- Checking for real email addresses ---"

if command -v rg &> /dev/null; then
  emails=$(rg -n "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" . \
    --glob '!node_modules/**' --glob '!*.lock' --glob '!.git/**' \
    --glob '!*.md' \
    2>/dev/null | grep -v "example\.\|example\.com\|example\.org\|example\.internal\|@types\|npm" || true)
else
  emails=$(grep -rn "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" . \
    --exclude-dir=node_modules --exclude-dir=.git --exclude='*.lock' --exclude='*.md' \
    2>/dev/null | grep -v "example\.\|example\.com\|@types\|npm" || true)
fi

if [ -n "$emails" ]; then
  info "Possible email addresses found (review — may be legitimate):"
  echo "$emails" | head -20
  echo ""
else
  pass "No suspicious email addresses found in non-markdown files"
fi

# -------------------------------------------------------------------------
# 8. Internal URLs
# -------------------------------------------------------------------------
echo ""
echo "--- Checking for internal/corporate URLs ---"

if command -v rg &> /dev/null; then
  internal_urls=$(rg -n "https?://[a-zA-Z0-9.-]+\.(internal|corp|intranet)" . \
    --glob '!node_modules/**' --glob '!*.lock' --glob '!.git/**' \
    --glob '!scripts/security-scan.sh' \
    2>/dev/null | grep -v "example\.internal\|localhost\|127\.0\.0\.1" || true)
else
  internal_urls=$(grep -rn "https://[a-zA-Z0-9.-]*\.\(internal\|corp\|intranet\)" . \
    --exclude-dir=node_modules --exclude-dir=.git --exclude='*.lock' \
    --exclude='security-scan.sh' \
    2>/dev/null | grep -v "example\.internal\|localhost\|127\.0\.0\.1" || true)
fi

if [ -n "$internal_urls" ]; then
  warn_finding "Internal/corporate URLs found — review before public release"
  echo "$internal_urls"
  info "Note: 'example.internal' is a safe placeholder. Only real corporate hostnames are a concern."
  echo ""
else
  pass "No internal/corporate URLs found"
fi

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo ""
echo "============================================="
if [ "$FINDINGS" -gt 0 ]; then
  echo -e "${RED}$FINDINGS finding(s) require attention before open-source release.${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Fix each finding above."
  echo "  2. Run this script again to verify."
  echo "  3. Also run: gitleaks detect --source . (if installed)"
  echo "  4. Also run: cd app && npm audit"
  exit 1
else
  echo -e "${GREEN}No critical findings. Scan passed.${NC}"
  echo ""
  echo "Recommended additional checks:"
  echo "  - gitleaks detect --source . --verbose"
  echo "  - trufflehog git file://. --only-verified"
  echo "  - cd app && npm audit"
  exit 0
fi
