#!/usr/bin/env bash
# verify-stack.sh — fail-closed proof of the four stack invariants.
#
#   1. every commit base..top touches exactly one file (merges rejected)
#   2. branch i's first commit parents onto branch i-1's tip
#   3. snapshot vs top differs only by paths the plan marked SKIP
#   4. every layer contains exactly the paths the plan assigned to it
#   5. the working tree is clean except plan SKIP paths
#
# Exit 0 only when every check passes AND every git command succeeded.
#
# usage: verify-stack.sh --base main --snapshot _batch-source \
#          --branches "b1 b2 ... bN" --plan plan.tsv \
#          [--exclude "extra1,extra2"] [--allow-untracked "p"]
set -euo pipefail

base="main"
snapshot=""
branches=""
plan=""
exclude=""
allow_untracked=""

while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="${2:?}"; shift ;;
    --snapshot) snapshot="${2:?}"; shift ;;
    --branches) branches="${2:?}"; shift ;;
    --plan) plan="${2:?}"; shift ;;
    --exclude) exclude="${2:-}"; shift ;;
    --allow-untracked) allow_untracked="${2:-}"; shift ;;
    --help|-h) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -n "$snapshot" ] && [ -n "$branches" ] || {
  echo "usage: verify-stack.sh --base main --snapshot <ref> --branches \"b1 b2 ...\" [--plan plan.tsv]" >&2
  exit 2
}

repo=$(git rev-parse --show-toplevel)
cd "$repo"

fail=0
pass() { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; fail=1; }

die_ref() { echo "FAIL  ref '$1' does not resolve" >&2; exit 1; }
git rev-parse --verify -q "$base" >/dev/null || die_ref "$base"
git rev-parse --verify -q "$snapshot" >/dev/null || die_ref "$snapshot"
for b in $branches; do git rev-parse --verify -q "$b" >/dev/null || die_ref "$b"; done

first=${branches%% *}
last=${branches##* }

# ── plan: layer<TAB>path, SKIP excluded ────────────────────────────────────
skip_set=" "
own_re=""
if [ -n "$plan" ]; then
  [ -f "$plan" ] || { echo "FAIL  plan file not found: $plan" >&2; exit 1; }
  while IFS=$'\t' read -r layer path; do
    [ -z "${path:-}" ] && continue
    case "$layer" in \#*) continue ;; esac
    case "$path" in \#*) continue ;; esac
    if [ "$layer" = "SKIP" ] || [ "$layer" = "EXCLUDE" ]; then
      skip_set="$skip_set$path "
    else
      own_re="$own_re$layer|$path
"
    fi
  done < "$plan"
else
  echo "WARN  no --plan: per-layer ownership and plan-derived SKIP are not checked"
  IFS=',' read -ra ex <<< "$exclude"
  for p in "${ex[@]:-}"; do [ -n "$p" ] && skip_set="$skip_set$p "; done
fi
# Extra excludes are accepted only if the plan does not cover them; with a plan
# they must already be SKIP (otherwise the operator is widening the allowlist).
if [ -n "$plan" ] && [ -n "$exclude" ]; then
  IFS=',' read -ra ex <<< "$exclude"
  for p in "${ex[@]}"; do
    [ -z "$p" ] && continue
    case " $skip_set " in *" $p "*) ;; *) bad "exclude '$p' is not SKIP in the plan" ;; esac
  done
fi

allowed() { case " $skip_set $allow_untracked " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# ── 1. one file per commit, no merges ──────────────────────────────────────
multi=0
merges=0
count=0
for c in $(git rev-list --no-merges "$base..$last"); do
  count=$((count + 1))
  n=$(git show --name-status --format='' "$c" | grep -c . || true)
  [ "$n" -eq 1 ] || { multi=$((multi + 1)); echo "      $c has $n paths"; }
done
mc=$(git rev-list --merges --count "$base..$last" || echo 0)
[ "$mc" -eq 0 ] || { merges=$mc; echo "      $mc merge commit(s) inside the stack"; }
[ "$multi" -eq 0 ] && [ "$merges" -eq 0 ] && pass "one file per commit ($count commits, no merges)" ||
  bad "$multi multi-file commit(s), $merges merge commit(s)"

# ── 2. linear parentage ────────────────────────────────────────────────────
prev="$base"
chain_bad=0
for b in $branches; do
  base_commit=$(git rev-list --first-parent --no-merges "$b" --not "$prev" | tail -1)
  if [ -z "$base_commit" ]; then
    bad "branch $b has no commits on top of $prev"
    chain_bad=1
    prev="$b"
    continue
  fi
  parent=$(git rev-parse "$base_commit^")
  want=$(git rev-parse "$prev")
  if [ "$parent" != "$want" ]; then
    echo "      $b starts at $base_commit whose parent is $parent (expected $prev=$want)"
    chain_bad=1
  fi
  prev="$b"
done
[ "$chain_bad" -eq 0 ] && pass "branches form one linear chain" || bad "branch parentage is broken"

# ── 3. per-layer ownership ─────────────────────────────────────────────────
if [ -n "$plan" ]; then
  own_bad=0
  prev="$base"
  for b in $branches; do
    n=$(echo "$b" | sed 's#^.*/##' | cut -c1-2)
    expected=$(printf '%s' "$own_re" | awk -F'|' -v n="$n" '$1==n{print $2}')
    actual=$(git diff --name-status "$prev" "$b" | awk -F'\t' '{print $NF}')
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      printf '%s\n' "$expected" | grep -Fxq "$p" || { echo "      $b committed unplanned path: $p"; own_bad=1; }
    done <<< "$actual"
    while IFS= read -r p; do
      [ -z "$p" ] && continue
      printf '%s\n' "$actual" | grep -Fxq "$p" || { echo "      $b is missing planned path: $p"; own_bad=1; }
    done <<< "$expected"
    prev="$b"
  done
  [ "$own_bad" -eq 0 ] && pass "every layer matches its plan assignment" || bad "layer contents diverge from the plan"
fi

# ── 4. final tree == snapshot minus SKIP ───────────────────────────────────
tree_bad=0
diff_out=$(git diff --name-status "$snapshot" "$last") || { bad "git diff $snapshot $last failed"; diff_out=""; tree_bad=1; }
while IFS=$'\t' read -r status a b; do
  [ -z "${status:-}" ] && continue
  case "$status" in
    R*|C*) for p in "$a" "$b"; do allowed "$p" || { echo "      $status $p"; tree_bad=1; }; done ;;
    *)     allowed "$a" || { echo "      $status $a"; tree_bad=1; } ;;
  esac
done <<< "$diff_out"
[ "$tree_bad" -eq 0 ] && pass "top tree matches the snapshot (SKIP paths aside)" || bad "top tree differs from the snapshot"

# ── 5. working tree ────────────────────────────────────────────────────────
wt_bad=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  path="${line:3}"
  case "$path" in *" -> "*) path="${path#* -> }" ;; esac
  allowed "$path" && continue
  echo "      ${line:0:2} $path"
  wt_bad=1
done < <(git status --porcelain)
[ "$wt_bad" -eq 0 ] && pass "working tree clean (SKIP paths aside)" || bad "unexpected working tree changes"

echo
[ "$fail" -eq 0 ] && { echo "VERIFY: PASS"; exit 0; }
echo "VERIFY: FAIL"
exit 1
