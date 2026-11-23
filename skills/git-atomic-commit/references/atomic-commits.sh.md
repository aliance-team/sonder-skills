# atomic-commits.sh (embedded fallback copy)

If `scripts/atomic-commits.sh` is missing from this skill folder, write
the block below verbatim to `scripts/atomic-commits.sh` and `chmod +x` it.
This is a byte-for-byte copy of the bundled script, kept here so the
skill can self-heal from just this one reference file.

```bash
#!/bin/bash
set -euo pipefail

# ════════════════════════════════════════════════════════════════════════
# atomic-commits.sh — One commit per file, enforced.
#
# Works in any git repository. No project-specific assumptions.
#
# Usage:
#   bash atomic-commits.sh <commits.txt>
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
#   bash atomic-commits.sh /tmp/commits.txt
#
# Rules enforced:
#   - Refuses to run on protected branches (main/master)
#   - Exactly 1 file staged per commit
#   - If any entry is invalid or verification fails, abort before committing
#     anything further (no partial/half-applied commit sets past that point)
#   - Unstages cleanly on failure so the working tree isn't left mid-stage
# ════════════════════════════════════════════════════════════════════════

COMMITS_FILE="${1:-}"

if [[ -z "$COMMITS_FILE" ]]; then
  echo "ERROR: Usage: $0 <commits-file>"
  echo "  commits-file: path to a file with one 'filepath<TAB>commit message' per line"
  exit 1
fi

if [[ ! -f "$COMMITS_FILE" ]]; then
  echo "ERROR: File not found: $COMMITS_FILE"
  exit 1
fi

# Must be run inside a git repo.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: Not inside a git repository."
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

# Safety guard: never commit directly on a protected branch (main/master).
CURRENT_BRANCH=$(git symbolic-ref --short -q HEAD || true)
if [[ -n "$CURRENT_BRANCH" && ( "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ) && "${ATOMIC_COMMITS_ALLOW_PROTECTED:-0}" != "1" ]]; then
  echo "ERROR: Refusing to commit on protected branch '$CURRENT_BRANCH'."
  echo "       Create a branch first:  git switch -c <type>/<short-description>"
  echo "       (Override: ATOMIC_COMMITS_ALLOW_PROTECTED=1)"
  exit 1
fi

TOTAL=$(grep -c . "$COMMITS_FILE" || true)
echo "→ Processing $TOTAL atomic commit(s) from $COMMITS_FILE"
echo ""

COUNT=0
while IFS=$'\t' read -r file msg || [[ -n "${file:-}" ]]; do
  # Skip blank lines
  [[ -z "${file:-}" ]] && continue

  file="${file#./}"

  if [[ -z "$file" || -z "${msg:-}" ]]; then
    echo "ERROR: Invalid entry (expected 'path<TAB>message'): $file"
    exit 1
  fi

  if [[ ! -e "$file" ]]; then
    echo "ERROR: File does not exist: $file"
    exit 1
  fi

  # File must actually have changes (tracked-modified, staged, or untracked).
  STATUS=$(git status --porcelain -- "$file")
  if [[ -z "$STATUS" ]]; then
    echo "ERROR: No changes detected for: $file"
    echo "       Nothing to commit — check the path or your commits file."
    exit 1
  fi

  git add -- "$file"

  STAGED_COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
  if [[ "$STAGED_COUNT" -ne 1 ]]; then
    echo "ERROR: $STAGED_COUNT files staged (expected 1) after adding '$file'."
    echo "       This usually means the file expands into multiple paths, or"
    echo "       something else was already staged. Aborting — unstaging now."
    git restore --staged . >/dev/null 2>&1 || git reset HEAD -- . >/dev/null 2>&1
    exit 1
  fi

  git commit -m "$msg"
  COUNT=$((COUNT + 1))
  echo "  ✅ [$COUNT/$TOTAL] $file"
done < "$COMMITS_FILE"

echo ""
echo "✅ All $COUNT atomic commit(s) done."
```
