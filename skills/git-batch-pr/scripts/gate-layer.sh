#!/usr/bin/env bash
# gate-layer.sh — prove ONE layer green. Fail-closed.
#
# GREEN requires: at least one check ran, every check passed, and HEAD did not
# move during the run. The result is written as JSON bound to the HEAD SHA so a
# later phase can trust (or refuse) a cached gate.
#
# Build policy (fail-safe):
#   --top                -> always build
#   --base missing       -> always build
#   changed .astro/layout/page/config -> build
#   changed module imported by an .astro file -> build
#
# usage: gate-layer.sh <label> [--base <ref>] [--top] [--build] [--no-build]
#                       [--json <file>] [--require-clean]
# env: TSC_CMD SCRIPTS_TSC_CMD TEST_CMD BUILD_CMD
set -euo pipefail

label="${1:-}"
[ -z "$label" ] && { echo "usage: gate-layer.sh <label> [--base <ref>] [--top] [--json <file>]" >&2; exit 2; }
shift || true

base=""
force_build=""
top=0
json_out=""
require_clean=0
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="${2:-}"; shift ;;
    --top) top=1 ;;
    --build) force_build=1 ;;
    --no-build) force_build=0 ;;
    --json) json_out="${2:-}"; shift ;;
    --require-clean) require_clean=1 ;;
    --help|-h) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

repo=$(git rev-parse --show-toplevel)
cd "$repo"
head_before=$(git rev-parse HEAD)

if [ "$require_clean" = "1" ]; then
  dirty=$(git status --porcelain --untracked-files=no)
  [ -z "$dirty" ] || { echo "FAIL  layer $label has uncommitted changes" >&2; exit 1; }
fi

logdir="${TMPDIR:-/tmp}/batch-gates"
mkdir -p "$logdir"
log="$logdir/$label.log"
: > "$log"

# ── command defaults ───────────────────────────────────────────────────────
if [ -z "${TSC_CMD:-}" ] && [ -f tsconfig.json ] && [ -x ./node_modules/.bin/tsc ]; then
  TSC_CMD="./node_modules/.bin/tsc --noEmit --incremental --tsBuildInfoFile $logdir/tsc-$label.tsbuildinfo -p tsconfig.json"
fi
if [ -z "${SCRIPTS_TSC_CMD:-}" ] && [ -f scripts/tsconfig.json ] && [ -x ./node_modules/.bin/tsc ]; then
  SCRIPTS_TSC_CMD="./node_modules/.bin/tsc --noEmit -p scripts/tsconfig.json"
fi
if [ -z "${TEST_CMD:-}" ] && [ -x ./node_modules/.bin/vitest ]; then
  TEST_CMD="./node_modules/.bin/vitest run --reporter=dot"
fi
if [ -z "${BUILD_CMD:-}" ] && [ -x ./node_modules/.bin/astro ]; then
  BUILD_CMD="./node_modules/.bin/astro build"
fi

if [ -z "${TSC_CMD:-}${SCRIPTS_TSC_CMD:-}${TEST_CMD:-}" ]; then
  echo "FAIL  no checks configured (TSC_CMD / SCRIPTS_TSC_CMD / TEST_CMD); refusing to report GREEN" >&2
  exit 1
fi

# ── build decision ─────────────────────────────────────────────────────────
do_build=0
if [ "$force_build" = "1" ] || [ "$top" = "1" ] || [ -z "$base" ]; then
  do_build=1
elif [ "$force_build" = "0" ]; then
  do_build=0
elif git rev-parse -q --verify "$base" >/dev/null; then
  changed=$(git diff --name-only "$base" HEAD 2>/dev/null || true)
  if printf '%s\n' "$changed" | grep -Eq '\.astro$|(^|/)astro\.config\.[a-z]+$|(^|/)src/(pages|layouts)/'; then
    do_build=1
  else
    # A changed .ts consumed by an untouched .astro is invisible to tsc.
    for p in $changed; do
      stem=$(basename "$p"); stem=${stem%.*}
      [ ${#stem} -lt 4 ] && continue
      if grep -rqE "from ['\"][^'\"]*/${stem}(\.js)?['\"]" src --include='*.astro' 2>/dev/null; then
        do_build=1
        break
      fi
    done
  fi
fi
[ -n "${BUILD_CMD:-}" ] || do_build=0

run() {
  local name="$1" cmd="$2" start elapsed
  start=$SECONDS
  if bash -c "$cmd" >>"$log" 2>&1; then
    elapsed=$((SECONDS - start))
    printf '  %-18s OK   %3ss\n' "$name" "$elapsed"
    checks+=" $name"
    return 0
  fi
  elapsed=$((SECONDS - start))
  printf '  %-18s FAIL %3ss  (log: %s)\n' "$name" "$elapsed" "$log"
  tail -25 "$log" | sed 's/^/      /'
  return 1
}

echo "── layer $label ─────────────────────────────"
fail=0
checks=""
[ -n "${TSC_CMD:-}" ]         && { run "tsc" "$TSC_CMD" || fail=1; }
[ -n "${SCRIPTS_TSC_CMD:-}" ] && { run "typecheck:scripts" "$SCRIPTS_TSC_CMD" || fail=1; }
[ -n "${TEST_CMD:-}" ]        && { run "tests" "$TEST_CMD" || fail=1; }
if [ "$do_build" = "1" ]; then
  run "build" "$BUILD_CMD" || fail=1
else
  echo "  build              skip (no reachable .astro/config/route change)"
fi

head_after=$(git rev-parse HEAD)
if [ "$head_before" != "$head_after" ]; then
  echo "  HEAD moved during the gate ($head_before -> $head_after)"
  fail=1
fi
if [ -z "$checks" ]; then
  echo "  no check executed"
  fail=1
fi

result=RED
[ "$fail" -eq 0 ] && result=GREEN
echo "  RESULT: $result"

if [ -n "$json_out" ]; then
  mkdir -p "$(dirname "$json_out")"
  printf '{"label":"%s","head":"%s","base":"%s","checks":"%s","build":%s,"result":"%s","at":"%s"}\n' \
    "$label" "$head_before" "$base" "$(echo "$checks" | xargs)" "$do_build" "$result" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$json_out"
fi

[ "$fail" -eq 0 ] || exit 1
