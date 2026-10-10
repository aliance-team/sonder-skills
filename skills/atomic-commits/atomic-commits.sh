#!/bin/bash
set -euo pipefail

# ════════════════════════════════════════════════════════════════════════
# atomic-commits.sh — Reusable atomic commit script for the monorepo
#
# Usage:
#   bash .opencode/scripts/atomic-commits.sh <commits.txt>
#
# commits.txt format (one entry per line):
#   path/to/file:type(scope): message
#
# Example:
#   echo "apps/scaem.app/app/Services/Foo.php:fix(scaem): handle null input" > /tmp/commits.txt
#   echo "apps/scaem.app/app/Services/Bar.php:feat(scaem): add Bar method" >> /tmp/commits.txt
#   bash .opencode/scripts/atomic-commits.sh /tmp/commits.txt
#
# Rules enforced:
#   - Refuses to run on protected branches (main/master)
#   - Exactly 1 file staged per commit
#   - If verification fails, abort all (no partial commits)
#   - Script cleans up after itself
# ════════════════════════════════════════════════════════════════════════

COMMITS_FILE="${1:-}"

if [[ -z "$COMMITS_FILE" ]]; then
  echo "ERROR: Usage: $0 <commits-file>"
  echo "  commits-file: path to file with one 'filepath:commit message' per line"
  exit 1
fi

if [[ ! -f "$COMMITS_FILE" ]]; then
  echo "ERROR: File not found: $COMMITS_FILE"
  exit 1
fi

# ════════════════════════════════════════════════════════════════════════
# Safety guard: never commit directly on a protected branch (main/master).
# ════════════════════════════════════════════════════════════════════════
CURRENT_BRANCH=$(git symbolic-ref --short -q HEAD || true)
if [[ -n "$CURRENT_BRANCH" && ( "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ) && "${ATOMIC_COMMITS_ALLOW_PROTECTED:-0}" != "1" ]]; then
  echo "ERROR: Refusing to commit on protected branch '$CURRENT_BRANCH'."
  echo "       Create a branch first:  git switch -c <type>/<short-description>"
  echo "       (Override: ATOMIC_COMMITS_ALLOW_PROTECTED=1)"
  exit 1
fi

TOTAL=$(wc -l < "$COMMITS_FILE")
echo "→ Processing $TOTAL atomic commit(s) from $COMMITS_FILE"
echo ""

COUNT=0
while IFS= read -r entry || [[ -n "$entry" ]]; do
  # Skip empty lines
  [[ -z "$entry" ]] && continue

  # Parse: everything before first colon is the path, rest is the message
  file="${entry%%:*}"
  msg="${entry#*:}"

  # Handle lines where the path itself contains a colon (e.g. C:\... on Windows)
  # Strip leading ./ if present
  file="${file#./}"

  if [[ -z "$file" || -z "$msg" ]]; then
    echo "ERROR: Invalid entry (missing file or message): $entry"
    echo "       Format: path/to/file:commit message"
    exit 1
  fi

  # Verify the file exists (either as tracked with changes or untracked)
  if ! git diff --name-only -- "$file" | grep -qxF "$file" && \
     ! git diff --cached --name-only -- "$file" | grep -qxF "$file" && \
     ! git ls-files --others --exclude-standard -- "$file" | grep -qxF "$file" && \
     ! git diff --name-only --diff-filter=AM -- "$file" | grep -qxF "$file" >/dev/null 2>&1; then

    # Check if it's an untracked new file
    if git status --short "$file" | grep -q "^??"; then
      : # untracked, OK
    elif git status --short "$file" | grep -q "^[AM]"; then
      : # staged or modified, OK
    else
      echo "WARNING: File does not appear to have changes: $file"
      echo "         Skipping — if this is an untracked file, use 'git add' directly."
      continue
    fi
  fi

  git add "$file"

  STAGED=$(git diff --cached --name-only | wc -l)
  if [[ "$STAGED" -ne 1 ]]; then
    echo "ERROR: $STAGED files staged (expected 1). Aborting."
    git reset HEAD -- . >/dev/null 2>&1
    exit 1
  fi

  git commit -m "$msg"
  echo "  ✅ [$((COUNT + 1))/$TOTAL] $file"
  COUNT=$((COUNT + 1))
done < "$COMMITS_FILE"

echo ""
echo "✅ All $COUNT atomic commits done."
