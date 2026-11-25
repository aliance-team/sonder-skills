#!/usr/bin/env bash
#
# gitsync.sh
#
# Merge the latest main into one or more branches using isolated git worktrees.
# The primary working tree is never touched. Nothing is pushed unless --push is
# passed explicitly.
#
# Exit codes:
#   0  every branch merged, or was already up to date
#   1  at least one branch hit a conflict or error (that branch is left untouched)
#   2  usage error
#
set -uo pipefail

MAIN_REF="origin/main"
WORKTREE_ROOT="/tmp/opencode"
DO_PUSH=0
declare -a BRANCHES=()

usage() {
  cat <<'EOF'
Merge the latest main into one or more branches using isolated git worktrees.

Usage:
  gitsync.sh [options] <branch> [<branch> ...]

Options:
  --main <ref>            Main ref to merge in (default: origin/main)
  --worktree-root <dir>   Directory for temporary worktrees (default: /tmp/opencode)
  --push                  Push each successfully synced branch (explicit opt-in;
                          omit this to only print the push commands)
  -h, --help              Show this help

The primary working tree is never modified, and branches whose merge would
conflict are aborted and left untouched.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --main)          MAIN_REF="${2:?--main needs a value}"; shift 2 ;;
    --worktree-root) WORKTREE_ROOT="${2:?--worktree-root needs a value}"; shift 2 ;;
    --push)          DO_PUSH=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    -*)              echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    *)               BRANCHES+=("$1"); shift ;;
  esac
done

if [[ ${#BRANCHES[@]} -eq 0 ]]; then
  echo "error: no branches given" >&2
  usage >&2
  exit 2
fi

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "error: not inside a git work tree" >&2; exit 1; }

git worktree prune >/dev/null 2>&1
mkdir -p "$WORKTREE_ROOT"

echo "== fetch =="
git fetch origin --prune || { echo "error: git fetch failed" >&2; exit 1; }
echo "   $MAIN_REF = $(git rev-parse --short "$MAIN_REF")"

slugify() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '-' | tr -s '-'; }

# Print the path where a branch is checked out, or nothing.
checked_out_path() {
  git worktree list --porcelain | awk -v b="refs/heads/$1" '
    /^worktree / { wt = $2 }
    /^branch /   { if ($2 == b) print wt }'
}

declare -a RESULTS=()
rc=0

for branch in "${BRANCHES[@]}"; do
  echo
  echo "########## $branch ##########"

  if ! git show-ref --verify --quiet "refs/heads/$branch"; then
    if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      echo "  local branch missing — tracking origin/$branch"
      git branch --track "$branch" "origin/$branch" >/dev/null 2>&1 \
        || { echo "  ERROR: could not create local branch"; RESULTS+=("$branch|ERROR|create failed"); rc=1; continue; }
    else
      echo "  ERROR: branch not found locally or on origin"
      RESULTS+=("$branch|ERROR|not found"); rc=1; continue
    fi
  fi

  checkout="$(checked_out_path "$branch")"
  if [[ -n "$checkout" ]]; then
    echo "  ERROR: already checked out at $checkout — move that worktree to another branch first"
    RESULTS+=("$branch|ERROR|checked out at $checkout"); rc=1; continue
  fi

  before="$(git rev-parse "$branch")"

  if git merge-base --is-ancestor "$MAIN_REF" "$branch"; then
    echo "  UP-TO-DATE — $MAIN_REF is already an ancestor"
    RESULTS+=("$branch|UP-TO-DATE|$(git rev-parse --short "$before")")
    continue
  fi

  wt="$WORKTREE_ROOT/sync-$(slugify "$branch")"
  rm -rf "$wt"
  if ! git worktree add "$wt" "$branch" >/dev/null 2>&1; then
    echo "  ERROR: could not create worktree at $wt"
    RESULTS+=("$branch|ERROR|worktree add failed"); rc=1; continue
  fi

  # Bring the local branch level with its own remote first (fast-forward only).
  if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    if ! git -C "$wt" merge --ff-only "origin/$branch" >/dev/null 2>&1; then
      echo "  ERROR: local and origin/$branch diverged — reconcile manually"
      git worktree remove --force "$wt" >/dev/null 2>&1
      RESULTS+=("$branch|ERROR|local/remote diverged"); rc=1; continue
    fi
  fi

  merge_out="$(git -C "$wt" merge "$MAIN_REF" --no-edit 2>&1)"
  if [[ $? -ne 0 ]]; then
    conflicts="$(git -C "$wt" diff --name-only --diff-filter=U | tr '\n' ' ')"
    echo "  CONFLICT — merge aborted, branch left untouched"
    [[ -n "$conflicts" ]] && echo "        conflicting files: $conflicts"
    git -C "$wt" merge --abort >/dev/null 2>&1
    git worktree remove --force "$wt" >/dev/null 2>&1
    RESULTS+=("$branch|CONFLICT|$conflicts"); rc=1; continue
  fi

  after="$(git rev-parse "$branch")"
  summary="$(git diff --stat "$before" "$after" | tail -1 | sed 's/^ *//')"
  echo "  MERGED $(git rev-parse --short "$before") -> $(git rev-parse --short "$after")"
  [[ -n "$summary" ]] && echo "        $summary"
  git worktree remove --force "$wt" >/dev/null 2>&1
  RESULTS+=("$branch|MERGED|$(git rev-parse --short "$after")")
done

git worktree prune >/dev/null 2>&1

echo
echo "===== SUMMARY ====="
for r in "${RESULTS[@]}"; do
  IFS='|' read -r b s d <<<"$r"
  printf '  %-11s %-64s %s\n' "$s" "$b" "$d"
done

echo
if [[ $DO_PUSH -eq 1 ]]; then
  echo "===== PUSH ====="
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r b s d <<<"$r"
    [[ "$s" == "MERGED" ]] || continue
    echo "  pushing $b"
    git push origin "refs/heads/$b:refs/heads/$b" || rc=1
  done
else
  echo "===== PUSH (not executed — run these yourself) ====="
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r b s d <<<"$r"
    [[ "$s" == "MERGED" ]] || continue
    echo "  git push origin refs/heads/$b:refs/heads/$b"
  done
fi

exit "$rc"
