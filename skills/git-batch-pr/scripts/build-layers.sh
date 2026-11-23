#!/usr/bin/env bash
# build-layers.sh — materialise one branch per layer from a verified plan, with
# one atomic commit per file. It validates ownership and commit counts after each
# layer and refuses to use `git add -A` on a feature branch.
#
# usage:
#   build-layers.sh --plan plan.fixed.tsv --messages messages.tsv
#                   --branches branches.tsv [--base origin/main]
#                   [--snapshot _batch-source] [--out /tmp/batch-pr-flow/commits]
#                   [--dry-run]
#
# branches.tsv: one `NN<TAB>branch-name` per line, bottom to top.
set -euo pipefail

base="origin/main"
snapshot="_batch-source"
plan=""
messages=""
branches_file=""
out_dir="/tmp/batch-pr-flow/commits"
dry_run=0
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
atomic="${ATOMIC:-$HOME/.agents/skills/git-atomic-commit/scripts/atomic-commits.sh}"

while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="${2:-origin/main}"; shift ;;
    --snapshot) snapshot="${2:-_batch-source}"; shift ;;
    --plan) plan="${2:-}"; shift ;;
    --messages) messages="${2:-}"; shift ;;
    --branches) branches_file="${2:-}"; shift ;;
    --out) out_dir="${2:-}"; shift ;;
    --dry-run) dry_run=1 ;;
    --help|-h) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -n "$plan" ] && [ -n "$messages" ] && [ -n "$branches_file" ] || {
  echo "build-layers: --plan, --messages and --branches are required" >&2
  exit 2
}

repo=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not inside a git repository" >&2; exit 2; }
cd "$repo"

[ -f "$atomic" ] || atomic=$(find "$HOME" -name atomic-commits.sh -print -quit 2>/dev/null || true)
[ -n "$atomic" ] && [ -f "$atomic" ] || { echo "build-layers: atomic-commits.sh not found" >&2; exit 2; }

out_abs=$(node -e 'console.log(require("node:path").resolve(process.argv[1]))' "$out_dir")
case "$out_abs" in
  "$repo"/*)
    echo "FAIL  --out must be outside the repo (use \$BATCH/commits); got $out_abs" >&2
    exit 2
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL  working tree must be clean (commit the snapshot first)" >&2
  git status --porcelain >&2
  exit 1
fi

git rev-parse --verify -q "$base" >/dev/null || { echo "FAIL  base ref '$base' not found" >&2; exit 1; }
git rev-parse --verify -q "$snapshot" >/dev/null || { echo "FAIL  snapshot ref '$snapshot' not found" >&2; exit 1; }

node "$script_dir/plan-commits.mjs" --plan "$plan" --messages "$messages" --out "$out_dir" --branches "$branches_file"

layers=()
branches=()
while IFS=$'\t' read -r layer branch; do
  layer="${layer//[[:space:]]/}"
  branch="${branch//[[:space:]]/}"
  [ -z "$layer" ] && continue
  [[ "$layer" == \#* ]] && continue
  layers+=("$layer")
  branches+=("$branch")
done < "$branches_file"

[ "${#layers[@]}" -gt 0 ] || { echo "FAIL  no branches in $branches_file" >&2; exit 1; }

last_layer=0
for layer in "${layers[@]}"; do
  n=$((10#$layer))
  if [ "$n" -le "$last_layer" ]; then
    echo "FAIL  branches.tsv must be strictly bottom-to-top (got $layer after $(printf '%02d' "$last_layer"))" >&2
    exit 1
  fi
  last_layer=$n
done

if [ "$dry_run" = "1" ]; then
  prev="$base"
  for i in "${!layers[@]}"; do
    n="${layers[$i]}"
    echo "dry-run: ${branches[$i]} from $prev ($(grep -c . "$out_dir/commits-$n.txt") commits)"
    prev="${branches[$i]}"
  done
  exit 0
fi

prev="$base"
for i in "${!layers[@]}"; do
  n="${layers[$i]}"
  branch="${branches[$i]}"
  commits="$out_dir/commits-$n.txt"

  if git show-ref --verify --quiet "refs/heads/$branch"; then
    echo "FAIL  branch '$branch' already exists; delete it or pick another name" >&2
    exit 1
  fi

  echo ""
  echo "════════ layer $n → $branch (parent $prev) ════════"
  git switch -q -c "$branch" "$prev"

  live_commits="$out_dir/commits-$n.live"
  deleted_commits="$out_dir/commits-$n.deleted"
  : > "$live_commits"
  : > "$deleted_commits"

  while IFS=$'\t' read -r path message; do
    [ -z "${path:-}" ] && continue
    if git cat-file -e "$snapshot:$path" 2>/dev/null; then
      git checkout "$snapshot" -- "$path"
      printf '%s\t%s\n' "$path" "$message" >> "$live_commits"
    else
      printf '%s\t%s\n' "$path" "$message" >> "$deleted_commits"
    fi
  done < "$commits"
  git reset -q

  # atomic-commits.sh requires an existing path, so deletions get their own
  # one-file commits here (same guarantee, different staging path).
  while IFS=$'\t' read -r path message; do
    [ -z "${path:-}" ] && continue
    git rm -q --ignore-unmatch -- "$path"
    staged=$(git diff --cached --name-only | grep -c . || true)
    if [ "$staged" -ne 1 ]; then
      echo "FAIL: deletion of $path staged $staged files (expected 1)" >&2
      exit 1
    fi
    HUSKY=0 git commit -q -m "$message"
  done < "$deleted_commits"

  if [ -s "$live_commits" ]; then
    HUSKY=0 bash "$atomic" "$live_commits"
  fi

  actual="$(git diff --name-only --no-renames "$prev" "$branch" | sort)"
  planned="$(cut -f1 "$commits" | sort)"
  if [ "$actual" != "$planned" ]; then
    echo "FAIL: layer $n diverges from its plan" >&2
    diff <(printf '%s\n' "$planned") <(printf '%s\n' "$actual") >&2 || true
    exit 1
  fi

  count="$(git rev-list --count "$prev..$branch")"
  expected="$(grep -c . "$commits")"
  if [ "$count" -ne "$expected" ]; then
    echo "FAIL: layer $n has $count commits, expected $expected" >&2
    exit 1
  fi

  bad=0
  for commit in $(git rev-list "$prev..$branch"); do
    files=$(git show --name-only --format='' "$commit" | grep -c . || true)
    [ "$files" -eq 1 ] || { echo "FAIL: $commit touches $files files" >&2; bad=1; }
  done
  [ "$bad" -eq 0 ] || exit 1

  echo "OK layer $n: $count commits, $(printf '%s\n' "$actual" | grep -c .) paths"
  prev="$branch"
done

echo ""
echo "All layers built. Top branch: $prev"
