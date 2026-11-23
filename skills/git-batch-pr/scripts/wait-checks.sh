#!/usr/bin/env bash
# wait-checks.sh — the ONLY merge authorization. Fail-closed.
#
# Green requires ALL of:
#   - the number of matching open PRs equals --expected (when given)
#   - every PR is non-draft
#   - every PR has at least one reported check (a PR with no checks is NOT green)
#   - no check is pending
#   - no non-allowlisted check failed (CheckRun conclusion or StatusContext state)
#
# usage: wait-checks.sh --prefix "fastcatalog/" [--expected 7]
#                       [--allow "Phone Paths"] [--timeout 2400]
#                       [--interval 45] [--once]
# exit: 0 green, 1 failure, 2 pending/timeout/mismatch
set -euo pipefail

prefix=""
allow=""
expected=""
timeout=2400
interval=45
once=0

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) prefix="${2:-}"; shift ;;
    --expected) expected="${2:-}"; shift ;;
    --allow) allow="${2:-}"; shift ;;
    --timeout) timeout="${2:-2400}"; shift ;;
    --interval) interval="${2:-45}"; shift ;;
    --once) once=1 ;;
    --help|-h) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

[ -n "$prefix" ] || { echo "FAIL  --prefix is required (an empty prefix matches every PR)" >&2; exit 2; }
command -v gh >/dev/null 2>&1 || { echo "FAIL  gh not found" >&2; exit 1; }

rows_for() {
  gh pr list --state open --limit 200 --json number,headRefName,isDraft,statusCheckRollup \
    --jq ".[] | select(.headRefName|startswith(\"$prefix\")) |
      .number as \$n | .headRefName as \$h | .isDraft as \$d |
      (if ((.statusCheckRollup // []) | length) == 0
       then [\$n, \$h, (\$d|tostring), \"__NONE__\", \"\", \"\"]
       else (.statusCheckRollup[] |
         [\$n, \$h, (\$d|tostring),
          (.name // .context // \"?\"),
          (.status // .state // \"\"),
          (.conclusion // .state // \"\")])
       end) | @tsv" 2>/dev/null
}

deadline=$((SECONDS + timeout))
while :; do
  rows=$(rows_for || true)
  if [ -z "$rows" ]; then
    echo "[$(date +%H:%M:%S)] no open PRs match prefix '$prefix'"
    [ "$once" = "1" ] && exit 2
    [ "$SECONDS" -ge "$deadline" ] && { echo "TIMEOUT: no PRs appeared"; exit 2; }
    sleep "$interval"
    continue
  fi

  tmp=$(mktemp)
  trap 'rm -f "$tmp"' EXIT
  printf '%s\n' "$rows" > "$tmp"

  summary=$(awk -F'\t' -v allow="$allow" -v expect="$expected" '
    BEGIN {
      n = split(allow, a, ","); for (i = 1; i <= n; i++) if (a[i] != "") allowed[a[i]] = 1
    }
    {
      pr = $1; head = $2
      if (!(pr in seen)) { seen[pr] = 1; order[++npr] = pr; headof[pr] = head; draft[pr] = $3; checks[pr] = 0 }
      if ($4 == "__NONE__") next
      checks[pr]++
      name = $4
      if (name in allowed) { allowseen[pr]++ ; next }
      st = $5; cc = $6
      if (st == "COMPLETED") {
        if (cc == "FAILURE" || cc == "ERROR" || cc == "CANCELLED" || cc == "TIMED_OUT" ||
            cc == "ACTION_REQUIRED" || cc == "STARTUP_FAILURE") fails[pr] = fails[pr] " " name "=" cc
      } else if (st == "PENDING" || st == "QUEUED" || st == "IN_PROGRESS" || st == "WAITING" || st == "REQUESTED") {
        pending++
      } else if (st == "") {
        fails[pr] = fails[pr] " " name "(no status)"
      }
    }
    END {
      zero = 0; failure = 0; pend = 0
      for (i = 1; i <= npr; i++) {
        pr = order[i]
        if (checks[pr] == 0) { zero++; printf "  NO CHECKS  PR #%s %s\n", pr, headof[pr] }
        if (draft[pr] == "true") { failure++; printf "  DRAFT      PR #%s %s\n", pr, headof[pr] }
        if (fails[pr] != "") { failure++; printf "  FAIL       PR #%s %s:%s\n", pr, headof[pr], fails[pr] }
      }
      if (expect != "" && npr != expect) {
        printf "  COUNT      %d PRs, expected %s\n", npr, expect
        failure++
      }
      printf "COUNT %d %d %d %d %d\n", npr, pend, failure, zero, allowseen[order[1]]
    }
  ' "$tmp")

  meta=$(printf '%s\n' "$summary" | grep '^COUNT ' | tail -1)
  printf '%s\n' "$summary" | grep -v '^COUNT ' | sed '/^$/d' || true
  read -r _ npr pend nfail nzero _ <<< "$meta"

  echo "[$(date +%H:%M:%S)] prs=$npr pending=$pend failures=$nfail no-checks=$nzero"

  if [ "$nfail" -gt 0 ] || [ "$nzero" -gt 0 ]; then
    echo "NOT GREEN: see the lines above (allowlist: ${allow:-none})"
    exit 1
  fi
  if [ "$pend" -eq 0 ]; then
    echo "ALL CHECKS GREEN — merge authorized (prs=$npr, allowlist: ${allow:-none})"
    exit 0
  fi
  if [ "$once" = "1" ]; then
    echo "PENDING: $pend check(s) still running"
    exit 2
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "TIMEOUT after ${timeout}s: $pend check(s) still pending"
    exit 2
  fi
  sleep "$interval"
done
