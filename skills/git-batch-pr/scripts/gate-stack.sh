#!/usr/bin/env bash
# gate-stack.sh — gate every layer once, with the correct parent base and the
# top-layer build. Records each green layer in state.json when available.
#
# usage:
#   gate-stack.sh --branches branches.tsv [--base origin/main]
#                 [--json-dir /tmp/batch-gates] [--state scripts/state.mjs]
#                 [--no-state] [--dry-run]
#
# It intentionally passes the PARENT branch as `--base` to gate-layer.sh so the
# build decision reflects that layer's diff, not the whole cumulative stack.
set -euo pipefail

base="origin/main"
branches_file=""
json_dir="/tmp/batch-gates"
state_script=""
record_state=1
dry_run=0
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="${2:-origin/main}"; shift ;;
    --branches) branches_file="${2:-}"; shift ;;
    --json-dir) json_dir="${2:-/tmp/batch-gates}"; shift ;;
    --state) state_script="${2:-}"; shift ;;
    --no-state) record_state=0 ;;
    --dry-run) dry_run=1 ;;
    --help|-h) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -n "$branches_file" ] || { echo "gate-stack: --branches is required" >&2; exit 2; }
[ -f "$branches_file" ] || { echo "gate-stack: no such branches file: $branches_file" >&2; exit 2; }

repo=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "not inside a git repository" >&2; exit 2; }
cd "$repo"

[ -n "$state_script" ] || state_script="$script_dir/state.mjs"
[ "$record_state" = "1" ] && [ ! -f "$state_script" ] && record_state=0

if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL  working tree must be clean before gating" >&2
  exit 1
fi

if [ -f .nvmrc ]; then
  pin=$(tr -d '[:space:]' < .nvmrc)
  cur=$(node -v | sed 's/^v//')
  pin_major=${pin#v}; pin_major=${pin_major%%.*}
  cur_major=${cur%%.*}
  if [ "$pin_major" != "$cur_major" ]; then
    echo "WARN  node v$cur does not match .nvmrc $pin; gate results may be invalid" >&2
  fi
fi

mkdir -p "$json_dir"
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

if [ "$dry_run" = "1" ]; then
  prev="$base"
  for i in "${!layers[@]}"; do
    top=""
    [ "$i" -eq "$((${#layers[@]} - 1))" ] && top=" --top"
    echo "dry-run: gate ${layers[$i]} (${branches[$i]}) base=$prev$top"
    prev="${branches[$i]}"
  done
  exit 0
fi

prev="$base"
for i in "${!layers[@]}"; do
  n="${layers[$i]}"
  branch="${branches[$i]}"
  json="$json_dir/gate-$n.json"
  top=()
  [ "$i" -eq "$((${#layers[@]} - 1))" ] && top=(--top)

  git switch -q "$branch"
  echo ""
  echo "════════ gate $n on $branch (base $prev) ════════"
  if ! "$script_dir/gate-layer.sh" "$n" --base "$prev" "${top[@]}" --json "$json" --require-clean; then
    echo "FAIL: layer $n is RED; fix the layer and re-run from $n" >&2
    exit 1
  fi

  if [ "$record_state" = "1" ]; then
    sha=$(git rev-parse "$branch")
    parent=$(git rev-parse "$prev")
    checks=$(node -e 'const j=require(process.argv[1]); console.log(String(j.checks || "").split(" ").filter(Boolean).join(","))' "$json")
    if node "$state_script" layer "$n" --branch "$branch" --sha "$sha" --parent "$parent" --gate green --checks "$checks" >/dev/null 2>&1; then
      echo "  state              record $n"
    else
      echo "  state              skip (run state.mjs init first)"
    fi
  fi

  prev="$branch"
done

if [ "$record_state" = "1" ]; then
  if node "$state_script" check >/dev/null 2>&1; then
    echo ""
    echo "state: all layers trusted"
  else
    echo ""
    echo "state: check did not pass (run state.mjs show)" >&2
  fi
fi

echo "All requested gates are GREEN."
