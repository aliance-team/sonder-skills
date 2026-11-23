#!/usr/bin/env bash
# preflight.sh — block the batch before it starts, not after 190 commits.
#
# Checks the REAL git transport (core.sshCommand / ssh-agent / HTTPS token),
# the repo's Node floor, the base ref freshness, the CI allowlist, a production
# deploy verification path, and the zombie-branch provenance audit. Read-only:
# no pushes, branches or writes.
#
# usage: preflight.sh [--touches-workflows] [--assume-ssh]
#                     [--base origin/main] [--no-deploy]
#                     [--prefix fastcatalog/] [--allow-existing "reason"]
#                     [--no-audit] [--help]
set -uo pipefail

touches_workflows=0
assume_ssh=0
base_ref="origin/main"
deploy_required=1
prefix="fastcatalog/"
allow_existing=""
no_audit=0

while [ $# -gt 0 ]; do
  case "$1" in
    --touches-workflows) touches_workflows=1 ;;
    --assume-ssh) assume_ssh=1 ;;
    --base) base_ref="${2:-origin/main}"; shift ;;
    --no-deploy) deploy_required=0 ;;
    --prefix) prefix="${2:-fastcatalog/}"; shift ;;
    --allow-existing) allow_existing="${2:-}"; shift ;;
    --no-audit) no_audit=1 ;;
    --help|-h) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done

fail=0
warn=0
say()  { printf '%-5s %s\n' "$1" "$2"; }
ok()   { say "OK" "$1"; }
no()   { say "FAIL" "$1"; fail=1; }
hmm()  { say "WARN" "$1"; warn=1; }
info() { say "INFO" "$1"; }

[ -n "${prefix// /}" ] || { echo "FAIL  --prefix cannot be empty" >&2; exit 2; }
if [ -n "$allow_existing" ] && [ -z "${allow_existing// /}" ]; then
  echo "FAIL  --allow-existing requires a non-empty written reason" >&2
  exit 2
fi
if [ "$no_audit" = "1" ] && [ -z "$allow_existing" ]; then
  no "--no-audit requires --allow-existing \"written reason\""
fi

repo=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "FAIL  not inside a git repository"; exit 1; }
cd "$repo"
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# ── fetch first: every ref below must be current ──────────────────────────
if git fetch --quiet origin 2>/dev/null; then
  ok "fetched origin"
else
  no "git fetch origin failed (network or credentials); the base may be stale"
fi

# ── Node floor: use the repo's engines/.nvmrc, not a generic major ────────
node_floor=""
if [ -f package.json ]; then
  node_floor=$(node -e "try{const p=require('./package.json');process.stdout.write(p.engines?.node||'')}catch{}" 2>/dev/null || true)
fi
node_pin=""
for f in .nvmrc .node-version; do
  if [ -f "$f" ]; then node_pin=$(tr -d '[:space:]' < "$f"); break; fi
done
if command -v node >/dev/null 2>&1; then
  node_cur=$(node -v | sed 's/^v//')
  if node - "$node_cur" "$node_floor" "$node_pin" <<'NODE'
const [cur, floor, pin] = process.argv.slice(2);
const parse = (v) => String(v).replace(/^[v^~=<> ]+/, '').split('.').map(Number);
const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
};
let bad = false;
const m = String(floor || '').match(/^(>=|>|=|\^|~)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
if (m) {
  const op = m[1] || '>=';
  const want = [Number(m[2]), Number(m[3] || 0), Number(m[4] || 0)];
  const c = cmp(parse(cur), want);
  const fails =
    (op === '>=' && c < 0) ||
    (op === '>' && c <= 0) ||
    (op === '=' && c !== 0) ||
    (op === '^' && c < 0) ||
    (op === '~' && c < 0);
  if (fails) {
    console.error(`engines.node ${floor}`);
    bad = true;
  }
}
if (pin) {
  const major = Number(String(pin).replace(/^v/, '').split('.')[0]);
  if (major && Number(String(cur).split('.')[0]) !== major) {
    console.error(`.nvmrc ${pin}`);
    bad = true;
  }
}
process.exit(bad ? 1 : 0);
NODE
  then
    ok "node v$node_cur satisfies the repo floor${node_floor:+ ($node_floor)}${node_pin:+ [.nvmrc $node_pin]}"
  else
    no "node v$node_cur does not satisfy the repo floor${node_floor:+ ($node_floor)}${node_pin:+ [.nvmrc $node_pin]} — run: nvm use ${node_pin:-24}"
  fi
else
  no "node not found"
fi

# ── GitHub CLI + stack extension ──────────────────────────────────────────
scopes_workflow=0
if ! command -v gh >/dev/null 2>&1; then
  no "gh not found"
else
  auth=$(gh auth status 2>&1 || true)
  if printf '%s' "$auth" | grep -q "Logged in"; then
    ok "gh authenticated ($(printf '%s' "$auth" | sed -n 's/.*account \([^ ]*\).*/\1/p' | head -1))"
  else
    no "gh is not authenticated (gh auth login)"
  fi
  if printf '%s' "$auth" | grep -Eq "Token scopes:.*workflow"; then
    ok "gh token has the workflow scope"
    scopes_workflow=1
  else
    info "gh token has no workflow scope (only matters if the batch edits .github/workflows)"
  fi
fi

if gh stack --version >/dev/null 2>&1; then
  ok "gh-stack $(gh stack --version 2>&1 | tr -d '\n')"
else
  no "gh-stack extension missing (gh extension install github/gh-stack)"
fi

# ── real push transport, not a bare `ssh -T` ──────────────────────────────
push_url=$(git remote get-url --push origin 2>/dev/null || true)
if [ -z "$push_url" ]; then
  no "origin has no push URL"
else
  info "push transport: $push_url"
fi

ssh_transport=0
case "$push_url" in
  git@*|ssh://*) ssh_transport=1 ;;
esac

transport_ok=0
if GIT_TERMINAL_PROMPT=0 timeout 25 git ls-remote --heads origin >/dev/null 2>&1; then
  ok "git transport authenticates non-interactively (git ls-remote origin)"
  transport_ok=1
else
  no "git transport cannot authenticate non-interactively (passphrase? no agent? missing token?)"
  info "load a passphrase key once with: ssh-add ~/.ssh/id_rsa  (then retry)"
fi

# ── workflow-file capability (deploy keys are NOT enough) ─────────────────
if [ "$touches_workflows" = "1" ]; then
  if [ "$scopes_workflow" = "1" ] && [[ "$push_url" == https://* ]]; then
    ok "workflow files can be pushed (HTTPS + token workflow scope)"
  elif [ "$transport_ok" = "1" ] && [ "$ssh_transport" = "1" ]; then
    if [ "$assume_ssh" = "1" ]; then
      ok "workflow files should be pushable over account SSH"
      info "run scripts/probe-workflow-push.sh once to prove a real .github/workflows write"
    else
      no "workflow files need a proven write: run scripts/probe-workflow-push.sh, then pass --assume-ssh"
    fi
  else
    no "workflow files need an account SSH key or a token with the workflow scope"
  fi
  info "a repo deploy key is NOT a workflow credential; use an account SSH key (ssh-add) or gh auth refresh -s workflow"
fi

# ── base ref: fresh origin ref (or a local branch proven equal) ───────────
if git rev-parse --verify -q "$base_ref" >/dev/null; then
  ok "base ref '$base_ref' at $(git rev-parse --short "$base_ref")"
else
  no "base ref '$base_ref' does not exist"
fi

if [[ "$base_ref" != origin/* ]] && git rev-parse --verify -q "origin/$base_ref" >/dev/null; then
  local_sha=$(git rev-parse "$base_ref")
  remote_sha=$(git rev-parse "origin/$base_ref")
  if [ "$local_sha" != "$remote_sha" ]; then
    no "local '$base_ref' is stale/diverged from origin/$base_ref ($local_sha vs $remote_sha)"
    info "use --base origin/$base_ref, or fast-forward: git branch -f $base_ref origin/$base_ref"
  else
    ok "local '$base_ref' matches origin/$base_ref"
  fi
fi

if [ -z "$(git status --porcelain)" ]; then
  ok "working tree clean"
else
  hmm "working tree has uncommitted changes (the snapshot will capture them)"
fi

if git show-ref --verify --quiet refs/heads/_batch-source; then
  hmm "_batch-source already exists; this may be a resumed run — reuse it deliberately or delete it"
fi

# ── CI baseline = the allowlist ───────────────────────────────────────────
allow=""
if command -v gh >/dev/null 2>&1; then
  merged_no=$(gh pr list --state merged --limit 1 --json number --jq '.[0].number // empty' 2>/dev/null || true)
  if [ -n "${merged_no:-}" ]; then
    allow=$(gh pr view "$merged_no" --json statusCheckRollup \
      --jq '.statusCheckRollup[]? | select(.conclusion=="FAILURE" or .conclusion=="CANCELLED" or .conclusion=="TIMED_OUT") | (.name // .context // empty)' 2>/dev/null |
      sort -u | paste -sd, -)
  fi
fi

if [ -n "${allow:-}" ]; then
  hmm "checks already failing on the last merged PR (#$merged_no): $allow"
  echo "      → record it:  node scripts/state.mjs set-allowlist \"$allow\""
  echo "      → wait with:  scripts/wait-checks.sh --allow \"$allow\" ..."
else
  ok "no pre-existing failures on the last merged PR"
fi

# ── deploy verification path: merged is not shipped ───────────────────────
deploy_json=""
if [ -n "${DEPLOY_VERIFY_CMD:-}" ]; then
  ok "deploy verification configured (DEPLOY_VERIFY_CMD)"
elif [ -f "$SCRIPT_DIR/deploy-info.mjs" ]; then
  deploy_json=$(node "$SCRIPT_DIR/deploy-info.mjs" --json 2>/dev/null || true)
fi

if [ -n "${DEPLOY_VERIFY_CMD:-}" ]; then
  :
elif [ -n "$deploy_json" ] && [ "$deploy_json" != "[]" ]; then
  ok "Netlify deploy verification available"
  node -e '
    const rows = JSON.parse(process.argv[1]);
    for (const r of rows) {
      console.log(`      site=${r.site} id=${r.id} url=${r.url} published=${(r.sha || "none").slice(0, 7)} ${r.state || ""}`);
    }
  ' "$deploy_json"
  echo "      → after merge: node scripts/verify-deploy.mjs --sha <merge> --netlify-site <id> --url <url>"
elif [ "$deploy_required" = "1" ]; then
  no "no deploy verification path (no DEPLOY_VERIFY_CMD and no accessible Netlify site)"
  info "set DEPLOY_VERIFY_CMD, provide NETLIFY_AUTH_TOKEN / ~/.config/netlify/config.json, or pass --no-deploy to explicitly exclude shipping"
else
  hmm "deploy verification explicitly disabled with --no-deploy"
fi

# ── zombie-branch provenance audit: merged is not finalized ───────────────
case "$base_ref" in
  origin/*|refs/remotes/origin/*) audit_base="$base_ref" ;;
  *) audit_base="origin/$base_ref" ;;
esac
audit_log=$(mktemp "${TMPDIR:-/tmp}/preflight-audit.XXXXXX")
trap 'rm -f "$audit_log"' EXIT

if [ "$no_audit" = "1" ]; then
  if [ -n "$allow_existing" ]; then
    hmm "ZOMBIE AUDIT BYPASSED (--no-audit): $allow_existing"
    info "this is unsafe; finalize with: node \"$SCRIPT_DIR/finalize-stack.mjs\" --all-clean --prefix \"$prefix\" --archive-dir \"\$HOME/.local/share/batch-pr-flow-archives/<UTC>\" --dry-run"
  fi
elif [ ! -f "$SCRIPT_DIR/audit-stack.mjs" ]; then
  no "audit-stack.mjs not found at $SCRIPT_DIR; refusing to skip the zombie audit"
else
  audit_args=(--base "$audit_base" --prefix "$prefix" --fail-on-zombies)
  if [ -n "$allow_existing" ]; then
    audit_args+=(--allow-existing "$allow_existing")
  fi
  if node "$SCRIPT_DIR/audit-stack.mjs" "${audit_args[@]}" >"$audit_log" 2>&1; then
    ok "no merged zombies or unmerged work under '$prefix'"
    if [ -n "$allow_existing" ]; then
      hmm "existing merged branches explicitly allowed: $allow_existing"
    fi
  else
    no "zombie or unmerged-work branches under '$prefix' block this batch"
    sed 's/^/      /' "$audit_log" | tail -25
    info "finalize with: node \"$SCRIPT_DIR/finalize-stack.mjs\" --all-clean --prefix \"$prefix\" --archive-dir \"\$HOME/.local/share/batch-pr-flow-archives/<UTC>\" --dry-run"
    info "then rerun preflight; do not create a branch while the audit fails"
  fi
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "PREFLIGHT: FAIL — fix the blockers above before creating any branch"
  exit 1
fi
echo "PREFLIGHT: PASS${warn:+ (with warnings)}"
exit 0
