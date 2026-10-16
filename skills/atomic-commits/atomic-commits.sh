#!/bin/bash
set -euo pipefail

# ════════════════════════════════════════════════════════════════════════
# atomic-commits.sh — Reusable atomic commit script for the monorepo
#
# Usage:
#   bash skills/atomic-commits/atomic-commits.sh <commits.txt>
#
# commits.txt format (one entry per line, TAB-separated):
#   path/to/file<TAB>type(scope): message
#
# A tab delimiter (not colon) is used because commit messages routinely
# contain colons themselves (e.g. "fix(api): reject null token: 400").
#
# Example:
#   printf 'src/Foo.php\tfix(api): handle null input\n' > /tmp/commits.txt
#   printf 'src/Bar.php\tfeat(api): add Bar method\n' >> /tmp/commits.txt
#   bash skills/atomic-commits/atomic-commits.sh /tmp/commits.txt
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
  echo "  commits-file: path to file with one 'filepath<TAB>commit message' per line"
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
while IFS=$'\t' read -r file msg || [[ -n "$file" ]]; do
  # Skip empty lines
  [[ -z "$file" ]] && continue

  # Strip leading ./ if present
  file="${file#./}"

  if [[ -z "$file" || -z "$msg" ]]; then
    echo "ERROR: Invalid entry (expected 'path<TAB>message'): $file"
    echo "       Format: path/to/file<TAB>commit message"
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
