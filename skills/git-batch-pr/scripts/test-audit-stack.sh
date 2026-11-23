#!/usr/bin/env bash
# test-audit-stack.sh — offline fixture test for audit-stack.mjs.
#
# No gh, no network, no git: every fixture supplies the facts the live
# collector would otherwise gather. Exit 0 only when every classification and
# every documented exit code matches.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tmp=$(mktemp -d /tmp/opencode/batch-pr-flow-test.XXXXXX)
trap 'rm -rf "$tmp"' EXIT

pass=0

run_expect() {
  local want="$1"
  shift
  local out="$tmp/out" err="$tmp/err" code
  set +e
  "$@" >"$out" 2>"$err"
  code=$?
  set -e
  if [ "$code" -ne "$want" ]; then
    echo "FAIL  expected exit $want, got $code: $*" >&2
    sed 's/^/      /' "$out" >&2
    sed 's/^/      /' "$err" >&2
    exit 1
  fi
  pass=$((pass + 1))
}

run_expect 0 node --check "$script_dir/lib/stack-audit.mjs"
run_expect 0 node --check "$script_dir/audit-stack.mjs"
run_expect 0 node --check "$script_dir/finalize-stack.mjs"
run_expect 0 node --check "$script_dir/state.mjs"

# Main fixture: five required classifications plus GONE and UNKNOWN.
run_expect 1 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack.json" \
  --json "$tmp/main.json" --csv "$tmp/main.csv"

node - "$tmp/main.json" <<'NODE'
const report = require(process.argv[2]);
const expected = {
  MERGED_CLEAN: 1,
  MERGED_POST_COMMITS: 1,
  CLOSED_UNMERGED: 1,
  OPEN: 0,
  NO_PR: 1,
  MERGED_UNVERIFIED: 2,
  GONE: 1,
  UNKNOWN: 1,
};
let bad = 0;
for (const [name, count] of Object.entries(expected)) {
  if (report.counts[name] !== count) {
    console.error(`count ${name}: expected ${count}, got ${report.counts[name]}`);
    bad += 1;
  }
}
for (const branch of report.branches) {
  if (branch.expect !== branch.classification) {
    console.error(`${branch.name}: expected ${branch.expect}, got ${branch.classification}`);
    bad += 1;
  }
}
if (report.zombies.length !== 4 || report.unmergedWork.length !== 2 || report.blocking.length !== 6) {
  console.error(
    `main fixture: zombies=${report.zombies.length} unmerged=${report.unmergedWork.length} blocking=${report.blocking.length}`,
  );
  bad += 1;
}
const unmergedNames = report.unmergedWork.map((entry) => entry.name).sort();
if (
  unmergedNames.join(',') !==
  'fastcatalog/03-closed-unmerged,fastcatalog/04-no-pr'
) {
  console.error(`main fixture unmerged work: ${unmergedNames.join(',')}`);
  bad += 1;
}
process.exit(bad ? 1 : 0);
NODE
pass=$((pass + 1))

# The CSV must have the header and one row per branch.
head -1 "$tmp/main.csv" | grep -q '^name,classification,pr,' || {
  echo "FAIL  CSV header missing" >&2
  exit 1
}
[ "$(wc -l < "$tmp/main.csv")" -eq 9 ] || {
  echo "FAIL  expected 8 CSV rows + header" >&2
  exit 1
}
pass=$((pass + 1))

# --fail-on-zombies must reject the main fixture (it contains zombies).
run_expect 1 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack.json" --fail-on-zombies

# Without the guard the report is informational; hard failures still exit 1.
run_expect 1 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack.json"

# A zombie-only fixture: 0 without the flag, 1 with it, 0 only with a reason.
run_expect 0 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack-zombies.json"
run_expect 1 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack-zombies.json" --fail-on-zombies
run_expect 0 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack-zombies.json" \
  --fail-on-zombies --allow-existing "legacy stack audited before this batch"
grep -q 'PREFLIGHT: PASS (allow-existing)' "$tmp/out" || {
  echo "FAIL  allow-existing override was not reported" >&2
  exit 1
}
pass=$((pass + 1))

# --allow-existing without a written reason is a usage error.
run_expect 2 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack-zombies.json" \
  --allow-existing --fail-on-zombies

# A clean fixture (GONE + OPEN + contained NO_PR) passes the guard.
run_expect 0 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack-clean.json" --fail-on-zombies
grep -q 'PREFLIGHT: PASS — no merged zombies or unmerged work' "$tmp/out" || {
  echo "FAIL  clean preflight did not pass" >&2
  exit 1
}
pass=$((pass + 1))

# A real merge-commit landing where main advanced before the merge: the trees
# differ, but ancestry (mergeCommit and PR head both reachable from base), an
# unchanged tip and a closed commit list prove the merge. It must classify
# MERGED_CLEAN and report the tree difference as an advisory reason only.
run_expect 0 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack-merge-commit.json" \
  --json "$tmp/merge-commit.json"
node - "$tmp/merge-commit.json" <<'NODE'
const report = require(process.argv[2]);
const branch = report.branches[0];
let bad = 0;
if (branch.classification !== 'MERGED_CLEAN') {
  console.error(`merge-commit fixture: expected MERGED_CLEAN, got ${branch.classification}`);
  bad += 1;
}
if (branch.treeMatches !== false) {
  console.error(`merge-commit fixture: expected treeMatches=false, got ${branch.treeMatches}`);
  bad += 1;
}
if (!branch.reasons.some((reason) => /tip tree differs from mergeCommit tree/.test(reason))) {
  console.error(`merge-commit fixture: advisory tree reason missing: ${branch.reasons.join(' | ')}`);
  bad += 1;
}
if (report.zombies.length !== 1 || report.failures.length !== 0) {
  console.error(
    `merge-commit fixture: zombies=${report.zombies.length} failures=${report.failures.length}`,
  );
  bad += 1;
}
process.exit(bad ? 1 : 0);
NODE
pass=$((pass + 1))

# CLOSED_UNMERGED and NO_PR with work must block, even with a reason. A
# contained NO_PR (0/0) and an OPEN PR must stay non-blocking.
run_expect 0 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack-unmerged.json" \
  --json "$tmp/unmerged.json"
node - "$tmp/unmerged.json" <<'NODE'
const report = require(process.argv[2]);
const names = report.unmergedWork.map((entry) => entry.name).sort();
let bad = 0;
if (report.zombies.length !== 0) {
  console.error(`expected 0 merged zombies, got ${report.zombies.length}`);
  bad += 1;
}
if (
  names.join(',') !==
  'fastcatalog/01-closed,fastcatalog/02-no-pr-work'
) {
  console.error(`unmerged work: ${names.join(',')}`);
  bad += 1;
}
if (report.blocking.length !== 2) {
  console.error(`expected 2 blocking branches, got ${report.blocking.length}`);
  bad += 1;
}
if (report.blocking.some((entry) => entry.name === 'fastcatalog/03-contained-no-pr')) {
  console.error('contained NO_PR was treated as blocking');
  bad += 1;
}
if (report.blocking.some((entry) => entry.name === 'fastcatalog/04-open')) {
  console.error('OPEN was treated as blocking');
  bad += 1;
}
process.exit(bad ? 1 : 0);
NODE
pass=$((pass + 1))

run_expect 1 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack-unmerged.json" --fail-on-zombies
grep -q 'UNMERGED WORK' "$tmp/out" || {
  echo "FAIL  unmerged work was not reported" >&2
  exit 1
}
pass=$((pass + 1))

run_expect 1 node "$script_dir/audit-stack.mjs" \
  --from-json "$script_dir/fixtures/audit-stack-unmerged.json" \
  --fail-on-zombies --allow-existing "operator reason"
grep -q 'cannot be waived' "$tmp/out" || {
  echo "FAIL  --allow-existing incorrectly waived unmerged work" >&2
  exit 1
}
pass=$((pass + 1))

echo "PASS  audit-stack fixture tests ($pass checks)"
