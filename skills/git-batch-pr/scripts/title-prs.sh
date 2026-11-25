#!/usr/bin/env bash
# title-prs.sh — replace gh-stack's auto titles with the real commit-style
# titles, assert every PR's base/draft state, and record PR numbers in state.
#
# usage:
#   title-prs.sh --branches branches.tsv --titles pr-titles.tsv
#                [--base main] [--gate-json-dir /tmp/batch-gates]
#                [--state scripts/state.mjs] [--no-state] [--dry-run]
#
# pr-titles.tsv: `NN<TAB>title<TAB>body`.
set -euo pipefail

branches_file=""
titles_file=""
base="main"
json_dir="/tmp/batch-gates"
state_script=""
record_state=1
dry_run=0
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

while [ $# -gt 0 ]; do
  case "$1" in
    --branches) branches_file="${2:-}"; shift ;;
    --titles) titles_file="${2:-}"; shift ;;
    --base) base="${2:-main}"; shift ;;
    --gate-json-dir) json_dir="${2:-/tmp/batch-gates}"; shift ;;
    --state) state_script="${2:-}"; shift ;;
    --no-state) record_state=0 ;;
    --dry-run) dry_run=1 ;;
    --help|-h) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -n "$branches_file" ] && [ -n "$titles_file" ] || {
  echo "title-prs: --branches and --titles are required" >&2
  exit 2
}

repo=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not inside a git repository" >&2; exit 2; }
cd "$repo"

[ -n "$state_script" ] || state_script="$script_dir/state.mjs"
[ "$record_state" = "1" ] && [ ! -f "$state_script" ] && record_state=0

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

prev="$base"
prev_sha=$(git rev-parse "origin/$base" 2>/dev/null || git rev-parse "$base" 2>/dev/null || true)

for i in "${!layers[@]}"; do
  n="${layers[$i]}"
  branch="${branches[$i]}"

  line=$(awk -F'\t' -v n="$n" '$1==n{print; exit}' "$titles_file")
  IFS=$'\t' read -r _layer title body <<< "$line"
  if [ -z "${title:-}" ]; then
    echo "FAIL: no title for layer $n in $titles_file" >&2
    exit 1
  fi

  if [ "$dry_run" = "1" ]; then
    echo "dry-run: layer $n $branch -> $prev  [$title]"
    prev="$branch"
    prev_sha=$(git rev-parse "$branch" 2>/dev/null || true)
    continue
  fi

  pr=$(gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty')
  if [ -z "$pr" ]; then
    echo "FAIL: no open PR for $branch" >&2
    exit 1
  fi

  gh pr edit "$pr" --title "$title" --body "$body" >/dev/null

  meta=$(gh pr view "$pr" --json title,baseRefName,isDraft \
    --jq '"\(.title)\t\(.baseRefName)\t\(.isDraft)"')
  actual_title=$(printf '%s' "$meta" | cut -f1)
  actual_base=$(printf '%s' "$meta" | cut -f2)
  draft=$(printf '%s' "$meta" | cut -f3)

  if [ "$actual_title" != "$title" ]; then
    echo "FAIL: PR #$pr title persisted as '$actual_title'" >&2
    exit 1
  fi
  if [ "$actual_base" != "$prev" ]; then
    echo "FAIL: PR #$pr targets $actual_base, expected $prev" >&2
    exit 1
  fi
  if [ "$draft" != "false" ]; then
    echo "FAIL: PR #$pr is a draft" >&2
    exit 1
  fi

  if [ "$record_state" = "1" ]; then
    sha=$(git rev-parse "$branch")
    json="$json_dir/gate-$n.json"
    checks=""
    if [ -f "$json" ]; then
      checks=$(node -e 'const j=require(process.argv[1]); console.log(String(j.checks || "").split(" ").filter(Boolean).join(","))' "$json" 2>/dev/null || true)
    fi
    args=(layer "$n" --branch "$branch" --sha "$sha" --parent "${prev_sha:-$prev}" --gate green --pr "$pr" --title "$title")
    if [ -z "$checks" ]; then
      echo "PR #$pr  $branch -> $prev  [$title]  (state not recorded: missing $json)"
    elif node "$state_script" "${args[@]}" --checks "$checks" >/dev/null 2>&1; then
      echo "PR #$pr  $branch -> $prev  [$title]  (state recorded)"
    else
      echo "PR #$pr  $branch -> $prev  [$title]  (state not initialised)"
    fi
  else
    echo "PR #$pr  $branch -> $prev  [$title]"
  fi

  prev="$branch"
  prev_sha="$sha"
done

if [ "$dry_run" != "1" ]; then
  echo ""
  if ! gh stack view --short 2>/dev/null; then
    echo "gh stack view is ambiguous (another merged stack also ends at $base)."
    echo "The PRs are still correct; verify with: gh pr list --state open --json number,baseRefName,title"
  fi
fi
