#!/usr/bin/env bash
# probe-workflow-push.sh — prove a real .github/workflows write without touching
# the batch working tree. It creates a throwaway worktree, commits ONE probe
# workflow with an exact-path `git add`, pushes it, deletes the remote branch and
# removes the worktree. It never uses `git add -A` and never commits in the main
# working tree.
#
# usage: probe-workflow-push.sh [--base origin/main] [--branch NAME] [--dry-run]
# exit: 0 workflow push works, 1 blocked/failed, 2 usage.
set -euo pipefail

base="origin/main"
branch="_batch-workflow-probe-$(date +%s)"
dry_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="${2:-origin/main}"; shift ;;
    --branch) branch="${2:-}"; shift ;;
    --dry-run) dry_run=1 ;;
    --help|-h) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

repo=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not inside a git repository" >&2; exit 2; }
cd "$repo"

if ! git rev-parse --verify -q "$base" >/dev/null; then
  echo "FAIL  base ref '$base' does not exist" >&2
  exit 2
fi

if [ "$dry_run" = "1" ]; then
  echo "dry-run: would push one probe workflow from $base to origin/$branch and delete it"
  exit 0
fi

probe_worktree=$(mktemp -d "${TMPDIR:-/tmp}/batch-workflow-probe.XXXXXX")
cleanup() {
  git worktree remove --force "$probe_worktree" >/dev/null 2>&1 || rm -rf "$probe_worktree"
}
trap cleanup EXIT

git worktree add --detach "$probe_worktree" "$base" >/dev/null

author_name=$(git config user.name || true)
author_email=$(git config user.email || true)
[ -n "$author_name" ] || author_name="batch-pr-flow probe"
[ -n "$author_email" ] || author_email="batch-pr-flow@example.invalid"

cd "$probe_worktree"
mkdir -p .github/workflows
cat > .github/workflows/batch-workflow-probe.yml <<'YAML'
name: batch-workflow-probe
on:
  workflow_dispatch:
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
YAML

# Exact path only: never a parent path, never -A.
git add -- .github/workflows/batch-workflow-probe.yml
git -c user.name="$author_name" -c user.email="$author_email" \
  commit -q -m "chore: batch workflow push probe"

# --no-verify isolates the credential check from the repo's pre-push hooks.
if git push --no-verify origin "HEAD:refs/heads/$branch" 2>/tmp/batch-workflow-probe.err; then
  echo "PROBE OK: workflow push works (branch $branch)"
  if ! git push --no-verify origin --delete "$branch" >/dev/null 2>&1; then
    echo "WARN: could not delete origin/$branch; remove it manually" >&2
  fi
  exit 0
fi

echo "PROBE FAILED: this transport cannot write .github/workflows" >&2
cat /tmp/batch-workflow-probe.err >&2 || true
echo "" >&2
echo "Use an account SSH key (ssh-add ~/.ssh/id_rsa) or a token with the workflow scope." >&2
echo "Repo deploy keys are blocked for workflow files." >&2
exit 1
