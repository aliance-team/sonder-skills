#!/usr/bin/env bash
# test-finalize-stack.sh — offline tests for finalize-stack.mjs using a
# throwaway bare remote and a fake gh. Covers:
#   - two dry runs in one archive dir produce distinct verified bundles
#   - --all-clean selects clean zombies and skips OPEN/NO_PR
#   - --all-clean blocks on MERGED_POST_COMMITS
#   - actual deletion uses the lease and verifies the branch is gone
#   - /tmp archives are refused for --delete-remote without
#     --allow-ephemeral-archive
#   - a moved branch is rejected by the lease and survives
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tmp=$(mktemp -d /tmp/opencode/batch-pr-flow-finalize-test.XXXXXX)
trap 'rm -rf "$tmp"' EXIT

pass=0
out="$tmp/out"
err="$tmp/err"

run_expect() {
  local want="$1"
  shift
  local code
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

die() {
  echo "FAIL  $*" >&2
  exit 1
}

mkdir -p "$tmp/bin"
cat > "$tmp/bin/gh" <<'SH'
#!/usr/bin/env bash
case "$1 $2" in
  "repo view") printf '%s\n' "example/repo" ;;
  "pr list") cat "$FAKE_PR_JSON" ;;
  "api "*"/pulls/"*"/commits")
    number=$(printf '%s' "$2" | sed -n 's#.*/pulls/\([0-9][0-9]*\)/commits#\1#p')
    cat "$FAKE_COMMITS_DIR/$number.txt"
    ;;
  *) echo "fake gh: unsupported: $*" >&2; exit 1 ;;
esac
SH
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH"

setup_repo() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/remote.git" "$dir/work" "$dir/commits"
  git init -q --bare "$dir/remote.git"
  cd "$dir/work"
  git init -q -b main
  git config user.email test@example.com
  git config user.name test
  echo base > base.txt
  git add base.txt
  git commit -q -m base
  git remote add origin "$dir/remote.git"
  git push -q origin main
  export FAKE_PR_JSON="$dir/pr.json"
  export FAKE_COMMITS_DIR="$dir/commits"
  PR_NDJSON="$dir/pr.ndjson"
  : > "$PR_NDJSON"
}

append_pr() {
  local number="$1" name="$2" head="$3" state="$4" merge="$5"
  local merged_at="\"2026-11-08T12:00:00Z\""
  local merge_json
  if [ -n "$merge" ]; then merge_json="{\"oid\":\"$merge\"}"; else merge_json=null; merged_at=null; fi
  printf '{"number":%s,"state":"%s","baseRefName":"main","headRefName":"%s","headRefOid":"%s","mergedAt":%s,"mergeCommit":%s,"isDraft":false,"title":"feat"}\n' \
    "$number" "$state" "$name" "$head" "$merged_at" "$merge_json" >> "$PR_NDJSON"
}

write_prs() {
  node -e '
    const fs = require("fs");
    const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(process.argv[2], JSON.stringify(lines.map(JSON.parse), null, 2));
  ' "$PR_NDJSON" "$FAKE_PR_JSON"
}

# A clean branch: its PR head is the tip, and main gets a squash commit whose
# tree equals the branch tip. This is the native `gh stack merge --squash` shape.
add_clean_branch() {
  local name="$1" file="$2" number="$3"
  git switch -q main
  git switch -q -c "$name"
  echo "$name" > "$file"
  git add "$file"
  git commit -q -m "feat: $name"
  local head tree merge
  head=$(git rev-parse HEAD)
  tree=$(git rev-parse "HEAD^{tree}")
  git push -q origin "$name"
  git switch -q main
  merge=$(git commit-tree "$tree" -p main -m "squash $name")
  git update-ref refs/heads/main "$merge"
  git push -q origin main
  LAST_HEAD="$head"
  LAST_MERGE="$merge"
  printf '%s\n' "$head" > "$FAKE_COMMITS_DIR/$number.txt"
  append_pr "$number" "$name" "$head" MERGED "$merge"
}

add_open_branch() {
  local name="$1" file="$2" number="$3"
  git switch -q main
  git switch -q -c "$name"
  echo "$name" > "$file"
  git add "$file"
  git commit -q -m "feat: $name"
  local head
  head=$(git rev-parse HEAD)
  git push -q origin "$name"
  git switch -q main
  printf '%s\n' "$head" > "$FAKE_COMMITS_DIR/$number.txt"
  append_pr "$number" "$name" "$head" OPEN ""
}

add_post_branch() {
  local name="$1" file="$2" post_file="$3" number="$4"
  add_clean_branch "$name" "$file" "$number"
  git switch -q "$name"
  echo "post" > "$post_file"
  git add "$post_file"
  git commit -q -m "post-merge commit"
  git push -q origin "$name"
  git switch -q main
}

add_closed_branch() {
  local name="$1" file="$2" number="$3"
  git switch -q main
  git switch -q -c "$name"
  echo "$name" > "$file"
  git add "$file"
  git commit -q -m "feat: $name"
  local head
  head=$(git rev-parse HEAD)
  git push -q origin "$name"
  git switch -q main
  append_pr "$number" "$name" "$head" CLOSED ""
}

add_no_pr_branch() {
  local name="$1" file="$2"
  git switch -q main
  git switch -q -c "$name"
  echo "$name" > "$file"
  git add "$file"
  git commit -q -m "feat: $name"
  git push -q origin "$name"
  git switch -q main
}

add_contained_no_pr_branch() {
  local name="$1"
  git push -q origin "main:refs/heads/$name"
}

FIN="$script_dir/finalize-stack.mjs"

# 1. Two dry runs in the same archive dir must not overwrite each other.
setup_repo "$tmp/t1"
add_clean_branch fastcatalog/01-clean one.txt 1
write_prs
cd "$tmp/t1/work"
run_expect 0 node "$FIN" --all-clean --dry-run --archive-dir "$tmp/t1/archive"
run_expect 0 node "$FIN" --all-clean --dry-run --archive-dir "$tmp/t1/archive"
bundles=$(find "$tmp/t1/archive" -maxdepth 1 -name '*.bundle' | wc -l | tr -d ' ')
[ "$bundles" -eq 2 ] || die "expected 2 bundles after two runs, got $bundles"
for bundle in "$tmp/t1/archive"/*.bundle; do
  git bundle verify "$bundle" >/dev/null 2>&1 || die "bundle failed verification: $bundle"
done
pass=$((pass + 1))

# 2. --all-clean selects MERGED_CLEAN and skips OPEN.
setup_repo "$tmp/t2"
add_clean_branch fastcatalog/01-clean one.txt 1
add_clean_branch fastcatalog/02-clean two.txt 2
add_open_branch fastcatalog/03-open open.txt 3
write_prs
cd "$tmp/t2/work"
run_expect 0 node "$FIN" --all-clean --dry-run --archive-dir "$tmp/t2/archive"
commands=$(grep -c '^git push origin --force-with-lease=refs/heads/' "$out" || true)
[ "$commands" -eq 2 ] || die "expected 2 deletion commands, got $commands"
grep -q 'SKIPPED (not blocking).*fastcatalog/03-open' "$out" ||
  die "OPEN branch was not reported as skipped"
pass=$((pass + 1))

# 3. --all-clean blocks on a non-clean zombie.
setup_repo "$tmp/t3"
add_clean_branch fastcatalog/01-clean one.txt 1
add_post_branch fastcatalog/02-post post-a.txt post-b.txt 2
write_prs
cd "$tmp/t3/work"
run_expect 1 node "$FIN" --all-clean --dry-run --archive-dir "$tmp/t3/archive"
grep -q 'MERGED_POST_COMMITS' "$out" || die "post-commit zombie was not a blocker"
commands=$(grep -c '^git push origin --force-with-lease=refs/heads/' "$out" || true)
[ "$commands" -eq 0 ] || die "blocked run printed deletion commands"
pass=$((pass + 1))

# 3b. CLOSED_UNMERGED and NO_PR-with-work block; contained NO_PR and OPEN skip.
#     The actual-deletion attempt must delete nothing while blockers exist.
setup_repo "$tmp/t3b"
add_clean_branch fastcatalog/01-clean one.txt 1
add_closed_branch fastcatalog/02-closed closed.txt 2
add_no_pr_branch fastcatalog/03-no-pr no-pr.txt
add_contained_no_pr_branch fastcatalog/04-contained
add_open_branch fastcatalog/05-open open.txt 5
write_prs
cd "$tmp/t3b/work"
run_expect 1 node "$FIN" --all-clean --dry-run --archive-dir "$tmp/t3b/archive"
grep -q 'BLOCKERS 2' "$out" || die "expected 2 unmerged-work blockers"
grep -q 'fastcatalog/02-closed.*CLOSED_UNMERGED.*UNMERGED WORK' "$out" ||
  die "CLOSED_UNMERGED was not an unmerged-work blocker"
grep -q 'fastcatalog/03-no-pr.*NO_PR.*UNMERGED WORK' "$out" ||
  die "NO_PR with work was not an unmerged-work blocker"
grep -q 'SKIPPED (not blocking).*fastcatalog/04-contained.*0 unique commits' "$out" ||
  die "contained NO_PR was not skipped"
grep -q 'SKIPPED (not blocking).*fastcatalog/05-open.*OPEN' "$out" ||
  die "OPEN was not skipped"
commands=$(grep -c '^git push origin --force-with-lease=refs/heads/' "$out" || true)
[ "$commands" -eq 0 ] || die "unmerged-work blockers still printed deletion commands"
run_expect 1 node "$FIN" --all-clean --delete-remote --confirm-delete \
  --archive-dir "$tmp/t3b/archive" --allow-ephemeral-archive
count=$(git ls-remote --heads origin 'refs/heads/fastcatalog/*' | wc -l | tr -d ' ')
[ "$count" -eq 5 ] || die "expected all 5 branches to survive, got $count"
for branch in 01-clean 02-closed 03-no-pr 04-contained 05-open; do
  live=$(git ls-remote --heads origin "refs/heads/fastcatalog/$branch")
  [ -n "$live" ] || die "fastcatalog/$branch was deleted despite unmerged-work blockers"
done
pass=$((pass + 1))

# 4. Actual deletion works on a throwaway remote with an explicit ephemeral
#    archive override.
setup_repo "$tmp/t4"
add_clean_branch fastcatalog/01-clean one.txt 1
write_prs
cd "$tmp/t4/work"
run_expect 0 node "$FIN" --all-clean --delete-remote --confirm-delete \
  --archive-dir "$tmp/t4/archive" --allow-ephemeral-archive
live=$(git ls-remote --heads origin refs/heads/fastcatalog/01-clean)
[ -z "$live" ] || die "clean branch survived deletion"
node -e 'const r=require(process.argv[1]); if(r.result!=="deleted"||r.deletions[0].status!=="deleted"||!r.deletions[0].verifiedGone) process.exit(1)' \
  "$tmp/t4/archive/finalize-report.json" || die "deletion report is not verified"
pass=$((pass + 1))

# 5. --delete-remote refuses a /tmp archive without the explicit override.
setup_repo "$tmp/t5"
add_clean_branch fastcatalog/01-clean one.txt 1
write_prs
cd "$tmp/t5/work"
run_expect 2 node "$FIN" --all-clean --delete-remote --confirm-delete \
  --archive-dir "$tmp/t5/archive"
grep -q 'outside /tmp' "$err" || die "no /tmp refusal message"
live=$(git ls-remote --heads origin refs/heads/fastcatalog/01-clean)
[ -n "$live" ] || die "branch was deleted despite the archive policy refusal"
pass=$((pass + 1))

# 6. A moved branch is rejected by the lease and survives; finalize also blocks.
setup_repo "$tmp/t6"
add_clean_branch fastcatalog/01-clean one.txt 1
old="$LAST_HEAD"
write_prs
cd "$tmp/t6/work"
git switch -q fastcatalog/01-clean
echo moved > moved.txt
git add moved.txt
git commit -q -m "move the branch"
new=$(git rev-parse HEAD)
git push -q origin fastcatalog/01-clean
git switch -q main
set +e
git push origin --force-with-lease=refs/heads/fastcatalog/01-clean:"$old" \
  --delete fastcatalog/01-clean >"$out" 2>"$err"
code=$?
set -e
[ "$code" -ne 0 ] || die "lease push unexpectedly succeeded on a moved branch"
live=$(git ls-remote --heads origin refs/heads/fastcatalog/01-clean | cut -f1)
[ "$live" = "$new" ] || die "moved branch did not survive the lease rejection"
run_expect 1 node "$FIN" --all-clean --dry-run --archive-dir "$tmp/t6/archive"
grep -q 'MERGED_POST_COMMITS' "$out" || die "moved branch was not blocked"
pass=$((pass + 1))

echo "PASS  finalize-stack tests ($pass checks)"
