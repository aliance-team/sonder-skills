---
name: git-batch-pr
description: |-
  Split a reviewed working tree into N sequential feature branches, submit them as a native GitHub stack, verify every layer, and merge the whole stack with one action. Use when the user says "batch PR flow", "stack these PRs", "turn this into a PR stack", "ship this as sequential PRs", "split into reviewable layers", "stack flow", or asks to turn a large uncommitted change set into stacked PRs without approving each one. Not for a single PR, and not when the user explicitly wants one combined PR.
  The skill is built around nine failure modes that a naive split always hits: whole-tree compilers rejecting file-level layers, auto-generated PR titles becoming merge commit subjects, OAuth/deploy-key pushes rejected for workflow scope, a CI check that was already red on main, unchecked .astro consumers, merged-but-never-deployed releases, false compat windows on default exports, probe commits that capture the whole tree, and phantom-ahead zombie branches left behind by a legacy squash stack merge.
license: MIT
metadata:
  pairs_with: plan-executor, atomic-commit
  requires: gh >= 2.90, gh-stack extension, node >= 20, bash, an account SSH key or workflow-scoped token when touching .github/workflows
  scripts: scripts/preflight.sh, scripts/probe-workflow-push.sh, scripts/plan-layers.mjs, scripts/plan-commits.mjs, scripts/build-layers.sh, scripts/gate-layer.sh, scripts/gate-stack.sh, scripts/title-prs.sh, scripts/verify-stack.sh, scripts/wait-checks.sh, scripts/state.mjs, scripts/deploy-info.mjs, scripts/verify-deploy.mjs, scripts/audit-stack.mjs, scripts/finalize-stack.mjs
---

# Batch PR Flow

Turn one reviewed working tree into **N sequential pull requests** that GitHub
merges as one native stack, with **one manual action**, **zero red layers**, and
**zero mid-run interruptions**.

The naive version of this flow (split files by feature → submit with `--auto` →
merge) produces nine predictable failures. Each phase below exists to kill one:

| # | Failure | Killed by |
|---|---|---|
| 1 | A whole-tree compiler rejects a file-level layer | Phase 1 (dependency closure) |
| 2 | `--auto` titles become the merge commit subjects on `main` | Phase 5 (explicit titles) |
| 3 | Push rejected: no `workflow` scope for `.github/workflows/*` | Phase 0 (credential proof) |
| 4 | Waiting forever on a check that was already red on `main` | Phase 0 (baseline allowlist) |
| 5 | A rename breaks an untyped `.astro` consumer | Phase 1 (compat windows) |
| 6 | Merged, but the production deploy never happened | Phase 0 + Phase 7.1 (deploy proof) |
| 7 | Planner invents a compat window for a default export | Phase 1 (default-import-aware parser) |
| 8 | A probe commit captures the whole working tree | Phase 0/2 (exact-path probe, no `git add -A`) |
| 9 | Phantom-ahead zombie branches after a legacy squash stack merge | Phase 0 audit + Phase 7.3 finalize (ancestry + mergeCommit proof, archive, explicit remote delete) |

## Fail-closed rules (read before anything else)

A green result is only accepted when it came from evidence. Every phase ends in
a machine decision, and every script exits non-zero on doubt:

1. **No check, no green.** A layer with zero executed checks is RED; a PR with
   zero reported checks is not ready to merge.
2. **No ref, no pass.** A verifier that cannot resolve a ref or whose `git`
   command failed exits non-zero. Empty output is failure, never success.
3. **Cached gates expire.** A recorded gate is trusted only while the branch
   SHA, its parent, the base SHA and the command set still match.
4. **Merge is authorized only by `wait-checks.sh` exit 0** (plus the recorded
   allowlist). `gh stack merge` does not wait for CI on a repo without required
   checks, and its exit code is not proof of a full merge.
5. **The PR title becomes the merge commit subject.** Titles are written from a
   file and asserted against the PR before merge; `--auto` titles are still
   placeholders and never ship. A wrong title is now cosmetic: it is a bad
   subject line on `main`, not a bad commit, and it changes no content.
6. **Recovery material outlives the merge.** Snapshot, branches, titles and the
   state file are deleted only after the deploy is verified.
7. **Merged is not shipped.** For a repo with an automatic production deploy,
   `verify-deploy.mjs` must prove `published_deploy.commit_ref == merge SHA`,
   `state == ready`, `context == production`, and the live URL answers 200. No
   proof means the batch is incomplete, not "done".
8. **The base is `origin/<branch>` after a fetch.** Never build on a stale local
   `main`; `preflight.sh` fails when local and origin disagree, and the planner
   must be run with `--base origin/main`.
9. **Deploy keys are not workflow credentials.** A repo-scoped deploy key cannot
   push `.github/workflows/*`. Use an account SSH key loaded in an agent, or a
   token with `workflow` scope. Prove it with `probe-workflow-push.sh`.
10. **No `git add -A` outside `_batch-source`.** Feature and probe branches use
    exact paths only. A parent path such as `git add dir/../..` is a whole-tree
    add; never use it.
11. **Global test-infra lives in the lowest layer.** A timeout, setup or shared
    fixture fix that every layer's tests need belongs in layer `01` (or the
    snapshot), never only in the top layer. This includes a **cross-cutting CI
    guard**: if the batch adds a missing-config guard (for example
    `isFirestoreConfigured()` so the CI Phone Paths gate does not turn absent
    test credentials into 503s), it belongs in layer `01`. If it lands in layer
    `k`, every layer `01..k-1` stays red on that gate even though the final
    `main` is green; move the guard down or rebuild `01..k`.
12. **App `tsc` runs on the snapshot before branching.** `astro build` does not
    typecheck `astro.config.*`; a whole-tree app compile on `_batch-source`
    catches config/type errors before 100+ commits exist.
13. **Merged is not finalized.** A merged PR whose branch still exists must be
    proven landed (mergeCommit + tip ancestor of `origin/main`, tip ==
    `headRefOid`, no post-merge commits), archived, and deleted. Behind/ahead
    counts are not evidence. **Legacy/squash-only:** a squash stack additionally
    requires `tree(tip) == tree(mergeCommit)`; `git cherry` overcounts squashes
    and is report-only.

## When to stack — and when not to

A stack buys **reviewability and revertability per layer**. It costs a PR, a CI
job and a gate run per layer. That trade only pays when the layers are genuinely
separable.

| Signal | Stack it (4–8 layers) | One PR with atomic commits |
|---|---|---|
| Changed lines | > ~400 | < ~300 |
| Files touched | > ~25 | < ~20 |
| Subsystems | two or more, independently reviewable | one cohesive unit |
| Layers revertable alone | yes | no |
| Can each layer compile green | yes, by the planner | no (cross-cutting rename, mass edit, generated sweep) |

- **Prefer 4–8 layers, not 14.** Cost per layer is roughly constant (branch, PR,
  CI job, title); review value flattens after ~8. Split by subsystem, not by file
  count.
- **If the batch is one indivisible change** — a rename across 200 files, a
  dependency bump, a formatter sweep — a stack adds no review value: ship one PR
  with atomic commits. `plan-layers` will tell you: when it needs more than ~2
  compat windows, the layers are not separable.
- **Never stack to make a diff look small.** A 14-layer stack of one subsystem is
  worse for review than a 3-layer stack of three subsystems.
- **The cheapest split is the one you don't have to perform.** If the work is
  committed on small branches as it happens, a stack is assembled at the end with
  `gh stack init` (it adopts existing branches). The 40-minute surgery only
  exists when 5 000 uncommitted lines are split after the fact.

### Why the base is the branch below (and why there is no re-push loop)

A PR's diff is a **set difference**, `base...head`. `base = main` makes every
diff in a chain cumulative — layer 5's PR shows layers 1–5. `base = the branch
below` makes it local: one layer, one review.

```sh
git log --oneline main..<branch> | wc -l           # cumulative: every lower layer too
git log --oneline <branch-below>..<branch> | wc -l # one layer
```

Correct bases fix the diff **before** anything merges, which is why the flow has
no re-push loop. After a merge-commit landing the arithmetic is trivial: branch
N contains branch N-1's commits, so it is a strict descendant of `origin/main` —
ahead by its own layer, behind by 0. Nothing needs replaying, rebasing or
re-pushing. Squash breaks exactly that: the squash commit on `main` shares no
ancestry with the tip, so the tip goes "ahead" and needs recovery. That orphan is
the re-push loop.

## Resolve the skill directory once

```sh
SKILL_DIR="${SKILL_DIR:-$HOME/.agents/skills/git-batch-pr}"
test -f "$SKILL_DIR/SKILL.md" || SKILL_DIR="$(dirname "$(find ~ -path '*batch-pr-flow/SKILL.md' 2>/dev/null | head -1)")"
node "$SKILL_DIR/scripts/plan-layers.mjs" --help
```

Scripts are plain bash/node with no dependencies beyond `git`, `gh` and `node`.
They never write to a remote except where explicitly noted.

| Script | Purpose |
|---|---|
| `preflight.sh` | Real transport, Node floor, base freshness, allowlist, deploy path, zombie audit |
| `probe-workflow-push.sh` | Throwaway worktree + one workflow file: proves a real workflow push |
| `plan-layers.mjs` | Coverage, broken imports, forward edges, compat windows |
| `plan-commits.mjs` | Validates plan/branches/messages; emits `commits-NN.txt` |
| `build-layers.sh` | Builds every branch with one-file commits and ownership checks |
| `gate-layer.sh` | One layer: app tsc, scripts tsc, tests, selective build |
| `gate-stack.sh` | All layers, correct parent base, top build, records state |
| `verify-stack.sh` | One-file commits, linear chain, plan ownership, snapshot match |
| `title-prs.sh` | Real PR titles/bodies, base/draft assertions, state record |
| `wait-checks.sh` | Fail-closed CI wait with an explicit allowlist |
| `state.mjs` | Run manifest, cached-gate trust, merge-result and finalized state |
| `deploy-info.mjs` | Lists the accessible Netlify sites and published commit |
| `verify-deploy.mjs` | Fails unless the production deploy is ready on the merge SHA |
| `audit-stack.mjs` | Read-only classification of every remote batch branch; zombie preflight |
| `finalize-stack.mjs` | Archive refs/bundle/CSV (`--branches` or `--all-clean`), lease-delete only proven `MERGED_CLEAN` remote refs |

---

## Phase 0 — Preflight (blocking, ~5 min)

Run this **before creating a branch**. It is not advisory; stop on any blocker.

```sh
"$SKILL_DIR/scripts/preflight.sh" \
  --touches-workflows --base origin/main --prefix fastcatalog/
# deliberately no production deploy in this batch:
# "$SKILL_DIR/scripts/preflight.sh" \
#   --touches-workflows --base origin/main --prefix fastcatalog/ --no-deploy
# only with a written reason (does not waive MERGED_UNVERIFIED/UNKNOWN):
# "$SKILL_DIR/scripts/preflight.sh" \
#   --touches-workflows --base origin/main --prefix fastcatalog/ \
#   --allow-existing "legacy stack audited, deletion scheduled"
# the only bypass (loud warning; a written reason is still required):
# "$SKILL_DIR/scripts/preflight.sh" \
#   --touches-workflows --base origin/main --prefix fastcatalog/ \
#   --no-audit --allow-existing "air-gapped run: no gh access"
```

It checks, in order:

1. **Node floor and base freshness.** It fetches origin, reads `engines.node`
   and `.nvmrc`/`.node-version`, and fails if the active Node is below the
   repo's floor. It also fails if a local base branch is stale/diverged from
   `origin/<branch>`. Use `--base origin/main` (or fast-forward local `main`) —
   never build on a stale local `main`.
2. **Credential proof.** A token without `workflow` scope cannot push
   `.github/workflows/*`; a passphrase-protected SSH key cannot push
   non-interactively without an agent; a **repo deploy key is blocked for
   workflow files** even though it can push normal files. `preflight.sh` tests
   the real git transport (`git ls-remote` with the repo's `core.sshCommand` /
   agent), not a bare `ssh -T`. When the batch touches workflows, prove the
   write with the throwaway worktree probe:
   ```sh
   "$SKILL_DIR/scripts/probe-workflow-push.sh" --base origin/main
   ```
   It commits ONE probe workflow in a temporary worktree with an exact-path
   `git add`, pushes it, deletes the remote branch and removes the worktree. It
   never uses `git add -A` and never touches the batch working tree. Only then
   pass `--assume-ssh` (or use a token with the `workflow` scope):
   ```sh
   "$SKILL_DIR/scripts/preflight.sh" --touches-workflows --assume-ssh --base origin/main
   ```
   If the key has a passphrase, load it once with `ssh-add ~/.ssh/id_rsa`; do
   not leave a decrypted copy on disk.
3. **CI baseline.** Reads the last merged PR's checks and prints an allowlist of
   checks that were **already** failing there. On Fast Catalog, `Phone Paths`
   is red on `main` because CI has no `PUBLIC_FIREBASE_*` and catalog pages
   answer 503; waiting for it would block forever. Keep that value; record it
   when state is initialized before Phase 3:
   ```sh
   node "$SKILL_DIR/scripts/state.mjs" set-allowlist "Phone Paths"
   ```
4. **Deploy verification path.** Netlify is auto-detected from the local Netlify
   CLI config (`~/.config/netlify/config.json`) or `NETLIFY_AUTH_TOKEN`;
   `preflight.sh` prints the site, production URL and the currently published
   commit. If the repo has an auto-deploy and no verification path and you did
   not pass `--no-deploy`, preflight **fails**. After the merge, run:
   ```sh
   node "$SKILL_DIR/scripts/verify-deploy.mjs" \
     --sha "$(git rev-parse origin/main)" \
     --netlify-site <site-id> --url https://<production-domain>
   ```
   It fails closed unless the published deploy is `ready`, `production` and on
   the merge SHA, and the live URL answers 200.
5. **Tool pins.** `gh stack --version`, `gh auth status`, default branch, clean
   tree, and an existing `_batch-source` warning.
6. **Zombie/unmerged-work audit.** `audit-stack.mjs --fail-on-zombies` under
   `--prefix`; any merged branch still on `origin`, or unmerged work
   (`CLOSED_UNMERGED` / `NO_PR` with unique commits or files), stops preflight.
   Details in 0.1 below; `--no-audit` is a loud, reason-required bypass.

### 0.1 Zombie-branch audit (read-only, blocking)

`preflight.sh` runs this audit automatically after its other checks; a merged
zombie **or real unmerged work** makes preflight exit `1`. Run the standalone
form when you need the JSON/CSV report or are auditing outside preflight:

```sh
node "$SKILL_DIR/scripts/audit-stack.mjs" \
  --base origin/main --prefix <prefix>/ \
  --json /tmp/batch-pr-flow-audit-<UTC>.json \
  --csv /tmp/batch-pr-flow-audit-<UTC>.csv \
  --fail-on-zombies
```

Preflight passes the flags through: `--prefix fastcatalog/`,
`--allow-existing "reason"` and `--no-audit`. `--no-audit` is the only bypass;
it requires `--allow-existing "reason"` and prints a loud warning. The audit
compares each branch with its PR using `git ls-remote` and `gh pr list`, then
requires all of: PR `MERGED`, `mergeCommit` an ancestor of `origin/main`, remote
tip == `headRefOid`, no commit outside the PR commit list, and
`tree(tip) == tree(mergeCommit)`. It reports `MERGED_CLEAN`,
`MERGED_POST_COMMITS`, `CLOSED_UNMERGED`, `OPEN`, `NO_PR`, `MERGED_UNVERIFIED`,
`GONE` and `UNKNOWN`.

`--fail-on-zombies` exits `1` while any **merged zombie** (`MERGED_CLEAN`,
`MERGED_POST_COMMITS`, `MERGED_UNVERIFIED`) or **unmerged work**
(`CLOSED_UNMERGED`, or `NO_PR` with unique commits/files) exists. `OPEN` and a
contained `NO_PR` (0 unique commits, 0 changed files) are reported but are not
blocking. **Refuse a new batch until the old stack is finalized** (Phase 7.3).

`--allow-existing "written reason"` is the only waiver, and it only waives
`MERGED_CLEAN`/`MERGED_POST_COMMITS`. It never waives `CLOSED_UNMERGED`,
`NO_PR`-with-work, `MERGED_UNVERIFIED` or `UNKNOWN`, and the reason is kept in
the JSON report. The audit is read-only: it never deletes or pushes.

**Do not continue if preflight exits non-zero.** Every interruption in the first
real run of this flow came from skipping this phase.

---

## Phase 1 — Plan and close the dependency graph (~10 min)

Write the intent file, then let the planner correct it. Do not hand-tune layers
before the planner has run.

### 1.1 Intent file

Set the batch directory **outside the repo** once. These artifacts must never
enter `_batch-source` or make a layer's working tree look dirty:

```sh
BATCH=/tmp/batch-pr-flow
mkdir -p "$BATCH"
```

`$BATCH/plan.tsv`, one line per changed path, `layer<TAB>path`:

```
01	.github/workflows/ci.yml
01	package.json
04	src/lib/read-sources/api.ts
09	src/pages/product/[sku].astro
SKIP	docs/plans/owner-wip.md
```

`SKIP` means "leave this path at the base version" (user work-in-progress,
unrelated changes). Layers are `01..99`; the bottom is `01`.

### 1.2 Run the planner

```sh
node "$SKILL_DIR/scripts/plan-layers.mjs" \
  --snapshot _batch-source \
  --base origin/main \
  --plan "$BATCH/plan.tsv" \
  --emit "$BATCH/plan.fixed.tsv"
```

The planner reads the **final** tree (`--snapshot`), not the working tree, and
reports four things:

- **Missing coverage** — paths changed vs `--base` but absent from the plan
  (these would silently keep their base content).
- **Broken tree** — relative imports in the snapshot that resolve to nothing.
- **Forward edges** — layer `N` needs a path assigned to `M > N`. It pulls the
  dependency down (`layer = N`) and cascades, then warns when one catch drags
  more than `--max-drag 3` files (in which case pushing the *consumer* up is
  usually better; do that by editing the intent file and re-running).
- **Compat windows** — an export that the base had, the snapshot removed, and a
  consumer that dropped the import in a **later** layer. Example from Fast
  Catalog: `getProductBySkuCached` → `getProductByPathCached` in layer 04 while
  the product page migrated in layer 09; layer 04 must keep a
  `@deprecated` alias, layer 09 deletes it.

**Why this is not optional:** `tsc` compiles the whole tree, so a layer that
looks self-contained still fails on a symbol added in a later layer. In the
first real run this cost **8 rebuild-and-fix cycles**. Typical findings:

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module './phone'` | `smart-import.ts` (02) uses a module planned for 09 | pull `phone.ts` down |
| `Property 'equipmentFirst' does not exist on TenantSections` | shared type changed in 08, consumer at 10 | pull `tenant-settings.ts` down |
| `getProductBySkuCached is not exported` (build only) | rename landed before the `.astro` consumer migrated | compat window |
| Consumer imports a UI panel from a later layer | settings page embeds a panel from 11 | push the consumer up |

**What the planner cannot see:** a *shape* change in an exported type that is
consumed through an unchanged module. Example: `TenantSections` gained required
fields in `tenant-settings.ts`; the consumer is `useTenantSettings.ts`, which is
unchanged, so there is no import edge to follow. Only `tsc` catches that class.
That is why Phase 3 still typechecks **every** layer even though builds are
selective.

`--emit` writes the corrected plan plus a `# COMPAT` comment and a second
occurrence of the file at the migration layer. The alias version itself is not in
the snapshot — add it by hand in that layer (it is the only manual edit in the
flow) and gate the layer again.

The parser distinguishes default imports from named exports: `export default
function Foo` registers only `default`, never a named `Foo`. A default consumer
therefore cannot create a false compat window. If a real compat window is
reported, keep the old symbol as a `@deprecated` alias in the lower layer and
delete it at the migration layer.

### 1.3 Commit messages, branches and PR titles in the same pass

While the layer map is in front of you, write all four artifacts:

```
$BATCH/plan.tsv          layer<TAB>path
$BATCH/branches.tsv      layer<TAB>branch-name          (bottom -> top)
$BATCH/messages.tsv      path<TAB>type(scope): message
$BATCH/pr-titles.tsv     layer<TAB>title<TAB>body
```

Then validate them and emit one `commits-NN.txt` per layer **before touching
git**:

```sh
node "$SKILL_DIR/scripts/plan-commits.mjs" \
  --plan "$BATCH/plan.fixed.tsv" \
  --messages "$BATCH/messages.tsv" \
  --branches "$BATCH/branches.tsv" \
  --out "$BATCH/commits"
```

It fails on a missing/extra message, a non-Conventional subject, a duplicate
message, or a branch/layer mismatch. The message file feeds `atomic-commit`; the
branch file feeds Phases 2–5; the title file feeds Phase 5. Writing them now is
what makes the difference between a clean history and fourteen
`fastcatalog/07 feat intent search (#55)` merge commits.

Rules for titles: Conventional Commit format, subject ≤ 72 chars, body says
what the layer makes true. The **PR title becomes the merge commit subject on
`main`** — treat it as a commit message, not a label.

---

## Phase 2 — Snapshot and build the layers (~10 min)

### 2.1 Freeze the base and snapshot

```sh
git fetch origin
git switch -c _batch-source origin/main   # base the snapshot on the fresh origin tree
git add -A                                # ONLY allowed here, on the snapshot
./node_modules/.bin/prettier --write .    # format once
git add -A
git commit -m "chore: batch snapshot (local only, never pushed)"
```

`_batch-source` is the reference tree for every layer and is never pushed.
Never run `git add -A` (or a parent path such as `git add dir/../..`) on a
feature or probe branch: it captures the entire working tree and can silently
turn a one-file probe into a 100-file commit. A real run did exactly that; the
recovery procedure is in the playbook.

### 2.1b Gate the snapshot before branching

Run the whole-tree gates **once** on `_batch-source`:

```sh
./node_modules/.bin/tsc --noEmit -p tsconfig.json
pnpm test:sheets
pnpm format:check
pnpm build
```

Any failure is a snapshot fix, not a layer fix. Two classes only show up here:

- `astro build` does not typecheck `astro.config.*`; the app `tsc` does (a real
  run passed the build but failed app `tsc` on a `devFeatures` object).
- a shared test-infra fix (a timeout, setup file or fixture) must live in the
  snapshot or layer `01`; leaving it only in the top layer makes every earlier
  layer red.

### 2.2 Build each layer from the corrected plan

```sh
"$SKILL_DIR/scripts/build-layers.sh" \
  --base origin/main \
  --snapshot _batch-source \
  --plan "$BATCH/plan.fixed.tsv" \
  --messages "$BATCH/messages.tsv" \
  --branches "$BATCH/branches.tsv" \
  --out "$BATCH/commits"
```

The script is the machine version of the old inline loop. It:

- validates the plan/messages/branches with `plan-commits.mjs` first;
- materialises **only** each layer's exact paths from the snapshot (`git rm`
  for deletions);
- runs `atomic-commits.sh` with `HUSKY=0` (the snapshot was formatted once);
- fails if the layer's diff differs from its plan, if the commit count differs,
  or if any commit touches more than one file;
- never uses `git add -A` and refuses to reuse an existing branch.

- Resolve `$ATOMIC` from the atomic-commit skill (`scripts/atomic-commits.sh`);
  `build-layers.sh` finds it automatically.
- Commit-message TSV is `path<TAB>message`; it refuses multi-file staging.
- If the plan is right, this phase needs **no rebuilds**. A fix here means the
  planner missed something — fix the graph, not the branch.

**Invariant:** each layer's diff against its parent equals its plan rows, and the
working tree is clean except plan `SKIP` paths. `verify-stack.sh` re-checks this
from the outside in Phase 4.

---

## Phase 3 — Gate every layer (~5 min with worktrees)

The final tree being green proves nothing about layer 4. Gate **each** layer,
but only with what that layer can actually break.

```sh
# Gate every layer with the correct parent base and the top-layer build.
"$SKILL_DIR/scripts/gate-stack.sh" \
  --branches "$BATCH/branches.tsv" \
  --base origin/main \
  --json-dir /tmp/batch-gates
```

Initialize the state manifest **before** the first gate so `gate-stack.sh` can
record each green layer:

```sh
node "$SKILL_DIR/scripts/state.mjs" init --base origin/main --snapshot _batch-source --plan "$BATCH/plan.fixed.tsv"
node "$SKILL_DIR/scripts/state.mjs" set-allowlist "Phone Paths"
```

`gate-stack.sh` passes the **parent branch** as `--base` to each gate, so the
build decision reflects that layer's own diff instead of the whole cumulative
stack. It forces `--top` on the last layer, records each green layer in
`state.json`, and stops at the first RED. A single layer can still be gated by
hand:

```sh
"$SKILL_DIR/scripts/gate-layer.sh" 04 --base <branch-03> --json /tmp/gate-04.json
"$SKILL_DIR/scripts/gate-layer.sh" NN --base <branch-NN-1> --top --json /tmp/gate-NN.json
```

Policy the script implements:

| Check | When |
|---|---|
| `tsc --noEmit` incremental (app) | every layer |
| `tsc --noEmit -p scripts` | when the project has it |
| `vitest run` | every layer |
| `astro build` | the top layer always; otherwise when the layer touches `.astro`, `astro.config.*`, `src/pages/**`, or a module imported by an `.astro` file |

`tsc` cannot see `.astro` files. A layer that only adds a layout, changes a
route, or renames a symbol used from a template is invisible to every check
except the build. That is failure mode #5.

Override the commands per repo:

```sh
TSC_CMD="./node_modules/.bin/tsc --noEmit -p tsconfig.json" \
SCRIPTS_TSC_CMD="pnpm typecheck:scripts" \
TEST_CMD="./node_modules/.bin/vitest run" \
BUILD_CMD="./node_modules/.bin/astro build" \
  "$SKILL_DIR/scripts/gate-layer.sh" 07
```

### Speed (measured, not guessed)

On a 16-core machine, this repo (821 tests):

| Check | Cold | Incremental |
|---|---|---|
| `tsc --noEmit` | 52 s | 34 s cold / **15–19 s warm** |
| `vitest run` | 11 s (≈95 s CPU) | — |
| `astro build` | 44 s | — |

`gate-layer.sh` uses a per-layer `--tsBuildInfoFile`, so only the first layer
pays the cold cost. Gating 14 layers serially with cold tsc and 8 builds is
~20 min of pure machine time; **incremental tsc + 4 worktrees is ~5 min.**

- One tree must run the gates sequentially (concurrent `vitest` and `astro
  build` against the same tree produce fake failures).
- **Different layers are independent trees.** Use worktrees and run 3–4 at a
  time after the branches exist:
  ```sh
  git worktree add /tmp/wt/04 <branch-04>
  ( cd /tmp/wt/04 && "$SKILL_DIR/scripts/gate-layer.sh" 04 --base <branch-03> ) &
  ```
  Share `node_modules` (symlink it) or the installs dominate. Do not run more
  workers than `nproc / 3`: `vitest` and `tsc` already use most cores.
- **Freeze each layer's SHA after it passes.** Appending a commit to an already
  validated layer invalidates its gate run. If you must append, re-run that
  layer's gate before submit.
- **Tier CI the same way.** Full matrix on the top PR; `typecheck + tests` on the
  intermediate layers; build only where `.astro`/config/routes changed. On a repo
  with required checks, that is the difference between 14 full builds and 2.
- Run the **top layer twice** (or `vitest --retry=1`) to catch timing-sensitive
  tests. Filesystem-walking contract tests regularly exceed the default 5 s
  timeout under parallel load; if one exists, put the `testTimeout` fix in
  **layer 01 or the snapshot**, never only in the top layer. A real run put a
  15 s timeout in layer 08 and every earlier layer failed at 5 s.
- **Gate the snapshot first (2.1b).** A green final tree does not prove layer 01;
  a config/type error in `astro.config.*` or a global test-infra fix belongs at
  the bottom, where every later layer inherits it.


---

## Phase 4 — Prove the invariants (~2 min)

Never eyeball these. `verify-stack.sh` is **fail-closed**: an invalid ref, a
failing git command, a merge commit or an unplanned path is a FAIL, never a
silent pass.

```sh
"$SKILL_DIR/scripts/verify-stack.sh" \
  --base origin/main \
  --snapshot _batch-source \
  --branches "<branch-01> <branch-02> ... <branch-NN>" \
  --plan "$BATCH/plan.fixed.tsv"
```

| Invariant | Why it matters |
|---|---|
| Every commit `base..NN` touches exactly one file, no merges | the one-file rule, machine-checked |
| Branch `i`'s oldest commit parents onto branch `i-1`'s tip | the stack is linear, not a fan |
| Every layer's diff equals its plan rows | no wrong-layer or missing file |
| `git diff snapshot NN` contains only plan `SKIP` paths (both sides of renames) | nothing lost, nothing smuggled |
| Working tree clean except plan `SKIP` paths | no stray edits reach a layer |

`--exclude` is only honoured for paths the plan already marks `SKIP`; widening it
at verify time is a FAIL.

### 4.1 Record the run

```sh
# state was initialized before Phase 3 and gate-stack.sh recorded each layer.
# If you gated manually, initialize and record here instead:
# "$SKILL_DIR/scripts/state.mjs" init --base origin/main --snapshot _batch-source --plan "$BATCH/plan.fixed.tsv"
# "$SKILL_DIR/scripts/state.mjs" set-allowlist "Phone Paths"
# "$SKILL_DIR/scripts/state.mjs" layer "$n" --branch "<branch-$n>" --gate green --checks "tsc,vitest[,build]"
"$SKILL_DIR/scripts/state.mjs" check      # exit 0 only if every layer still matches
```

The manifest lives in `<git-common-dir>/batch-pr-flow/state.json`, so it survives
worktrees and a context reset. A cached gate is trusted only while the branch
SHA, its parent, the base SHA and the recorded checks still match; `check`
refuses otherwise.

A red invariant is a stop. Rebuild from the plan rather than patching the layer
ad hoc.

---

## Phase 5 — Submit with real titles (~2 min)

```sh
gh stack init --base main $(awk -F'\t' '$1 !~ /^#/ && NF >= 2 {print $2}' "$BATCH/branches.tsv")
gh stack submit --auto --open
```

`--auto` titles each PR from its branch name, and **the PR title becomes the
merge commit subject on `main`**. Replace every title from the file, then assert
the stack shape:

```sh
"$SKILL_DIR/scripts/title-prs.sh" \
  --branches "$BATCH/branches.tsv" \
  --titles "$BATCH/pr-titles.tsv" \
  --base main
```

The script looks up the PR with the **exact** `--head "$branch"` (a prefix such
as `--head "fastcatalog/$n-"` matches nothing), edits title/body, and fails
unless the title persisted, the base is exactly the previous branch, and the PR
is not a draft. It records the PR number and title in `state.json`.

Cross-check the number of PRs and the stack map:

```sh
gh stack view --short
```

- Exit **9** means stacked PRs are disabled in repository settings.
- `--open` marks PRs ready for review; without it `--auto` creates drafts.
- Every PR above the bottom targets the one below. If a PR's base is `main`,
  the stack is broken; do not merge.
- Do not delete `_batch-source` or the branches yet (Phase 7 needs them).
- If `gh stack view` later says `main` belongs to multiple stacks, use
  `gh pr list --state open --json number,baseRefName,title`; the PRs are still
  correct. The ambiguity comes from an older merged stack and can be pruned
  after the deploy is verified.

---

## Phase 6 — Wait with an allowlist (~5–15 min)

```sh
"$SKILL_DIR/scripts/wait-checks.sh" \
  --prefix "<prefix>/" \
  --expected NN \
  --allow "Phone Paths" \
  --timeout 2400
```

The script is **fail-closed** — green requires all of:

- the number of matching open PRs equals `--expected`;
- every PR is non-draft and has **at least one** reported check (a PR with no
  checks is a failure, not a pass);
- no check is pending;
- no non-allowlisted check failed, where a check means either a CheckRun
  `conclusion` or a StatusContext `state`.

| Exit | Meaning |
|---|---|
| `0` | every real check completed, none failing → merge authorized |
| `1` | failure, no-check PR, draft, or count mismatch (printed per PR) |
| `2` | pending or timeout — **not** authorization |

Only checks that report a status are counted; Netlify `NOSTATUS` contexts never
complete and are ignored. An allowlist entry is a risk acceptance, not a
convenience: record it in the state file (`state.mjs set-allowlist`) with the
baseline PR number that proves it was already red on `main`.

On a private repo on GitHub Free there are no required checks, so
`gh stack merge` **does not wait for CI**. This phase is the only thing standing
between a green matrix and an unverified merge.

---

## Phase 7 — Merge and close (~2 min)

Stacks are generally available since 2026-10-06 (GitHub changelog, that date):
they land through the merge queue as a **single merge group**, create one merge
commit per PR, and retarget the layer above automatically when a base branch is
deleted (see docs.github.com, *about stacked pull requests* and *merging stacked
pull requests*). So land with merge commit — or rebase-merge — and never squash.

```sh
set -euo pipefail
git fetch origin
PRE=$(git rev-parse origin/main)           # captured BEFORE the merge
"$SKILL_DIR/scripts/state.mjs" merge-start # refuses if main moved since init

# Merge preflight: never sync reflexively.
gh pr view "$BOTTOM_PR" --json mergeable,mergeStateStatus \
  --jq '"mergeable=\(.mergeable) state=\(.mergeStateStatus)"'
# mergeable=CONFLICTING -> gh stack sync (or rebase) BEFORE merging
# CLEAN/MERGEABLE     -> merge

# Merge-method preflight: a stack lands with a merge commit.
gh api repos/{owner}/{repo} --jq '{merge:.allow_merge_commit, squash:.allow_squash_merge}'
# merge=false -> STOP. A squash-only repository must not stack at all.

gh stack merge --yes
```

**If `allow_merge_commit` is false, stop.** This flow does not fall back to
squash: every squash orphans the layer above from `main`'s ancestry and the
damage cascades up the chain. Use one PR with atomic commits instead.

`gh stack merge` pre-checks the stack but is not a transaction: a mid-flight
failure can leave the lower prefix landed. **Poll, do not trust the exit code**:

```sh
gh stack view --short        # every layer must show merged
gh pr list --state merged --limit 20 --json number,headRefName \
  --jq '.[] | select(.headRefName|startswith("<prefix>/"))'
```

Then prove the merge structurally. Do not use ahead/behind counts, and never
test a `mergeCommit` against the PR's `baseRefName` — under merge commit each
layer lands on `origin/main`, so `origin/main` is the only valid base:

```sh
# Per layer: the PR's mergeCommit and headRefOid.
gh pr view <n> --json number,state,mergeCommit,headRefOid \
  --jq '"#\(.number) \(.state) head=\(.headRefOid) merge=\(.mergeCommit.oid)"'

git merge-base --is-ancestor <mergeCommit> origin/main
test "$(git ls-remote origin "refs/heads/<branch>" | cut -f1)" = "<headRefOid>"
git merge-base --is-ancestor <headRefOid> origin/main   # ancestry proof (tip is on main)
```

`audit-stack.mjs` performs that proof for the whole stack in one pass. After the
merge, every layer must classify `MERGED_CLEAN` or `GONE`; a merged zombie
(`MERGED_POST_COMMITS`, `MERGED_UNVERIFIED`) or real unmerged work
(`CLOSED_UNMERGED`, `NO_PR` with commits/files) blocks finalization.

Then close out — **restore `SKIP` paths before deleting the snapshot**:

```sh
# 1. bring back the excluded working-tree files
while IFS=$'\t' read -r layer p; do
  [ "$layer" = "SKIP" ] || continue
  git show "_batch-source:$p" > "$p" 2>/dev/null || true
done < "$BATCH/plan.fixed.tsv"
git reset -q                              # leave them untracked

# 2. prove the merge by diffing the recorded pre-merge SHA
git switch main && git pull --ff-only
git diff --name-status "$PRE" main        # only planned paths
"$SKILL_DIR/scripts/state.mjs" merged --main-sha "$(git rev-parse main)"

# 3. ONLY after verify-deploy.mjs exits 0 (Phase 7.1): run Phase 7.3 finalize.
#    Do not run `gh stack sync --prune` yet: it prunes LOCAL branches only and
#    leaves the origin refs that finalize must archive and delete.
```

Verify, in this order:

1. `gh stack view --short` shows every PR merged. Never claim a merge from the
   command's exit code.
2. `git diff --name-status "$PRE" main` contains only planned paths (the
   snapshot tree minus `SKIP`).
3. **Phase 7.1 below proves the production deploy.** No deploy proof means the
   batch is incomplete; do not report "done" or "in production".
4. No forbidden external write happened (Sheet, Drive, database). For this repo:
   the flow must never run `qa:phone`, `scripts/phone-paths-audit.mjs`,
   `qa:agentic`, or a background dev server.

### 7.1 Verify the production deploy (required for auto-deploy repos)

A merged PR is not a shipped release. Wait for the Netlify production deploy of
the merge commit and prove it:

```sh
git fetch origin
node "$SKILL_DIR/scripts/verify-deploy.mjs" \
  --sha "$(git rev-parse origin/main)" \
  --netlify-site <site-id-or-name> \
  --url https://<production-domain>
```

`verify-deploy.mjs` is fail-closed. It requires all of:

- `published_deploy.commit_ref` matches the merge commit;
- `published_deploy.state == "ready"`;
- `published_deploy.context == "production"` (when present);
- `published_at` is set;
- the live URL answers HTTP 200 (and optionally contains a marker with
  `--contains`).

If the repo has two Netlify sites building it, auto-detection refuses; pass
`--netlify-site <id|name>`. `deploy-info.mjs` lists the accessible sites and the
currently published commit. Only after this exits `0` may you run Phase 7.3
(archive and delete the remote refs), then `gh stack sync --prune` and delete
`_batch-source`.

If the deploy fails, treat it as a release blocker: inspect the Netlify deploy
log, fix forward in a normal PR, and re-verify. Do not claim a production
release from a merged PR alone.

### 7.2 Revert kit (keep until the deploy is verified)

One merge commit per layer is the rollback unit. Record it:

```sh
git log --oneline "$PRE"..main          # 14 merge commits, bottom -> top
```

- Independent layer: `git revert <sha>` in a normal PR.
- Middle layer with dependents: revert the suffix top-down in one PR
  (`for s in <top>..<k>; do git revert --no-edit "$s"; done`).
- Interfaces intact: fix forward instead.
- Re-land: `git rebase --onto origin/main <old-parent> <branch-k>`, cascade,
  `gh stack init`, submit.

Do not delete `_batch-source`, the layer branches or `pr-titles.tsv` until the
deploy and a smoke check pass.

### 7.3 Finalize the stack (required)

A merged PR is not finalized while its remote branch exists — but under merge
commit this is an **audit-and-archive** step, not a repair step. Each layer's tip
became a parent of its own merge commit, so every tip is already an ancestor of
`origin/main`; nothing is orphaned and nothing needs replaying. What remains is
bookkeeping: `gh stack sync --prune` removes **local** branches only and never
deletes the `origin` refs, so finalize explicitly. With the repo-level
"Automatically delete head branches" setting enabled, remote deletion is routine
hygiene, not the retarget mechanism: GitHub retargets the layer above
automatically when a base branch is deleted.

1. Record each layer's merge result. `--verified-in-main true` re-checks the
   merge commit against `state.base.ref` and fails if it is not an ancestor:
   ```sh
   node "$SKILL_DIR/scripts/state.mjs" merge-result 01 \
     --pr 49 --head <headRefOid> --merge <mergeCommit> \
     --merged-at <mergedAt> --verified-in-main true --branch-deleted false
   ```
   Repeat for every layer. Use `--branch-deleted true` only after the remote ref
   is gone.
2. Dry-run the finalize. Use the numeric stack list for a live run, or
   `--all-clean` to discover every remote branch under the prefix:
   ```sh
   node "$SKILL_DIR/scripts/finalize-stack.mjs" \
     --branches "$BATCH/branches.tsv" --state <state.json> \
     --prefix <prefix>/ --archive-dir <archive-dir> --dry-run

   # Legacy/complete cleanup: every remote branch under the prefix.
   # This mode does not need branches.tsv.
   node "$SKILL_DIR/scripts/finalize-stack.mjs" \
     --all-clean --prefix <prefix>/ \
     --archive-dir "$HOME/.local/share/batch-pr-flow-archives/<UTC>" --dry-run
   ```
   It archives every selected tip to `refs/archive/<UTC-date>/<branch>`,
   creates a unique `stack-<UTC>-<pid>.bundle` from **only** those refs, verifies
   it with `git bundle verify`, and writes `finalize-report.json` + `.csv` outside
   the repo. A `GONE` branch is archived from its PR head. `--all-clean` selects
   only `MERGED_CLEAN`/`GONE`; it **blocks** on merged zombies
   (`MERGED_POST_COMMITS`, `MERGED_UNVERIFIED`), real unmerged work
   (`CLOSED_UNMERGED`, or `NO_PR` with unique commits/files) and `UNKNOWN`. It
   skips only `OPEN` and a contained `NO_PR` (0 unique commits, 0 changed
   files).
3. Inspect the report. In `--branches` mode every requested layer must be
   `MERGED_CLEAN` or `GONE`; any other class is a blocker. In `--all-clean`
   mode the blockers are exactly the merged zombies, unmerged work and
   `UNKNOWN` listed above; the script exits `1` before deleting anything. A
   recoverable older stack with no state file can omit `--state`; the archive
   report is its provenance.
4. Delete remotely, explicitly. Dry runs may use `/tmp`; with `--delete-remote`
   the archive must be durable: outside the repo and outside `/tmp` (default
   `$HOME/.local/share/batch-pr-flow-archives/<UTC>`). A `/tmp` archive requires
   `--allow-ephemeral-archive`.
   ```sh
   node "$SKILL_DIR/scripts/finalize-stack.mjs" \
     --branches "$BATCH/branches.tsv" --state <state.json> \
     --prefix <prefix>/ \
     --archive-dir "$HOME/.local/share/batch-pr-flow-archives/<UTC>" \
     --delete-remote --confirm-delete

   # or, for every clean zombie under the prefix:
   node "$SKILL_DIR/scripts/finalize-stack.mjs" \
     --all-clean --prefix <prefix>/ \
     --archive-dir "$HOME/.local/share/batch-pr-flow-archives/<UTC>" \
     --delete-remote --confirm-delete
   ```
   It re-reads each remote tip, deletes only `MERGED_CLEAN` branches with
   `git push origin --force-with-lease=refs/heads/<branch>:<tip> --delete <branch>`,
   then requires `git ls-remote --heads origin refs/heads/<branch>` to be empty
   for every one. A survivor or a moved tip is a failure. `GONE` branches are
   skipped after being archived from their PR head. The dry run prints the exact
   lease command list; never run those commands by hand without the same audit
   proof.
5. For a stateful numeric run, re-run `merge-result` for every layer with
   `--branch-deleted true` (the deletion proof), then mark the state finalized:
   ```sh
   node "$SKILL_DIR/scripts/state.mjs" finalize --archive-dir <archive-dir>
   ```
   It refuses unless every layer has a `merge-result` with
   `verifiedInMain=true` and `branchDeleted=true`. For a legacy `--all-clean`
   cleanup, the archive report is the record; `state.mjs finalize` only covers
   layers present in the state file.
6. Only now prune local branches and remove the snapshot:
   ```sh
   gh stack sync --prune
   git branch -D _batch-source
   ```

---

## State, trust and resume

Every run writes `<git-common-dir>/batch-pr-flow/state.json` (worktree-safe,
atomic rename). It records the base/snapshot SHAs, the plan hash, the allowlist,
and per layer: branch, SHA, parent SHA, gate result, checks, PR number and title.

```sh
state.mjs init --base origin/main --snapshot _batch-source --plan "$BATCH/plan.fixed.tsv"
state.mjs set-allowlist "Phone Paths"
state.mjs layer 04 --branch <b04> --gate green --checks tsc,vitest,build
state.mjs trust 04      # exit 0 only if the branch SHA, parent and base still match
state.mjs check         # exit 0 only if every recorded layer is reusable
state.mjs merge-result 04 --pr 52 --head <head> --merge <merge> \
  --merged-at <ISO> --verified-in-main true --branch-deleted true
state.mjs finalize --archive-dir /tmp/opencode/batch-pr-flow-archive-<UTC>
state.mjs show
```

Trust rules — a cached gate is **not** reusable when any of these changed:

- the branch tip (`git rev-parse <branch>` differs from the recorded SHA);
- the base (`git rev-parse origin/main` differs from `base.sha`);
- the gate command or its result (red is never reusable);
- the plan hash (a re-plan invalidates every layer it touched).

On resume after a crash or a context reset:

1. `git fetch origin`, verify `main` still equals `base.sha`.
2. `state.mjs check`; any layer that fails is re-gated, plus the top layer.
3. Reconcile remote state: `gh stack view --short`,
   `gh pr view <n> --json headRefOid,baseRefName,state`, and
   `audit-stack.mjs --prefix <prefix>/ --fail-on-zombies` — never trust a PR
   number from memory.
4. Never trust a worktree, `node_modules`, or CI results for a different SHA.

---

## Recovery playbook

`gs` = `gh stack`. Times are operator minutes with warm caches.

| Failure | Signal | Recovery | TTR |
|---|---|---|---|
| Plan gap / unassigned path | planner coverage, verify ownership | fix plan, rebuild that layer, `gs rebase --upstack` | 10–20 |
| Gate red at layer k (pre-submit) | `gate-layer.sh k` != 0 | fix the snapshot, rebuild k, re-gate k..top | 10–25 |
| Wrong-layer commit | verify ownership | `git rebase --onto <parent> <bad> <branch-k>`, re-add to the owner, `gs rebase --upstack` | 15–25 |
| Extra file after validation | layer gate/build fails | append only to the owner, re-gate it and the top | 5–15 |
| Forgotten compat alias | `astro build` `[MISSING_EXPORT]` | add `@deprecated` alias in the lower layer, re-gate k..top | 15–30 |
| WIP caught in the snapshot | preflight dirty tree | `git stash push -u`, recreate `_batch-source`, add `SKIP` rows | 5–10 |
| CI red at k after submit | `wait-checks.sh` exit 1 | **freeze 1..k-1** (their SHAs stay valid), fix k, `gs rebase --upstack`, `gs push`, re-run the wait | 10–20 |
| Lower-layer PRs red on one gate, top layer green | e.g. Phone Paths 503 on layers 01–06 but green from layer 07; the guard/fix lives in a higher layer | move the cross-cutting guard to layer 01 (or the snapshot), rebuild 01..k, re-gate; never merge a stack with unexplained lower-layer red | 15–30 |
| Rebase conflict | `gs rebase --upstack` stops | `gs rebase --abort` restores everything; prefer an additive fix on k | 10–40 |
| Merge refused / stale | `mergeable=CONFLICTING`, `mergeStateStatus=DIRTY` | `gs sync` or `gs rebase`, `--continue`, `gs push`; retry merge | 5–40 |
| Partial merge | `gs view --short` shows a prefix | treat the merged prefix as truth; `gs init` the remainder, rebase, submit as a new stack | 20–60 |
| Zombie branches after a native stack merge | `audit-stack --fail-on-zombies` lists `MERGED_CLEAN`; layer tips show huge `ahead`; origin refs still exist | Phase 7.3: archive, then `finalize-stack.mjs --all-clean --archive-dir "$HOME/.local/share/batch-pr-flow-archives/<UTC>" --delete-remote --confirm-delete`; never infer from ahead/behind and never expect `gs sync --prune` to touch origin | 5–15 |
| `--delete-remote` refuses a `/tmp` archive | `requires an archive dir outside /tmp` | use the durable `$HOME/.local/share/batch-pr-flow-archives/<UTC>` path; `--allow-ephemeral-archive` is only for throwaway tests | 1–2 |
| A branch moves during finalize | lease push rejected / `moved on the remote` | do not retry blindly; re-audit, decide whether the new commits are work, and keep the branch until a new PR is proven merged | 5–20 |
| Real unmerged work under the prefix | `CLOSED_UNMERGED`, or `NO_PR` with `uniqueCommitCount > 0` / `deltaFiles > 0` | do not delete; reopen/reland the work as a PR, or salvage the commits deliberately; a contained `NO_PR` (0/0) and `OPEN` are non-blocking | 10–30 |
| **Legacy/squash-only:** phantom ahead after a native squash merge | `git rev-list --count origin/main..<layer>` is huge although every PR is merged — cannot occur under merge commits, where each tip is an ancestor of `origin/main` | ignore ahead/behind; require `mergeCommit` ancestor of `origin/main`, tip == `headRefOid`, and (legacy) `tree(tip) == tree(mergeCommit)`; finalize deletes the refs | 5–10 |
| Post-merge commits on a merged branch | `MERGED_POST_COMMITS`; tip != `headRefOid` or `commitsOutsidePr > 0` | inspect the extra commits; if they are real work, open a new PR (or reland), never delete the branch; if they are legacy squash artifacts, prove tree equality and re-audit | 10–30 |
| Branch recreated after deletion | remote tip reappears on a branch whose PR is `MERGED`; classification becomes `MERGED_POST_COMMITS`/`OPEN`/`NO_PR` | classify again with `audit-stack`; treat it as new work until a new PR is merged and the proof holds; never delete from the old PR | 5–20 |
| Merged PR `mergeCommit` is not an ancestor of `origin/main` | `MERGED_UNVERIFIED` despite PR state `MERGED` | do not archive or delete; the stack has not reached `main` (merge the remaining parent/top or fix the base), then re-audit against `origin/main`; never test against `baseRefName` | 10–30 |
| `gs sync --prune` did not delete remote branches | origin refs still present after prune | expected: prune is local-only; run Phase 7.3 finalize to archive and delete the remote refs explicitly | 2–5 |
| Bad layer on `main` | deploy/smoke | revert the single merge commit (or the suffix top-down); re-land with `rebase --onto` | 10–90 |
| Credential lost mid-submit | 403 workflow / publickey | re-probe, fix, `gs submit` again (idempotent; it adopts existing PRs) | 2–15 |
| `gh stack` version/settings drift | exit 9 / upgrade prompt | pin the version, re-enable stacked PRs, re-run preflight | 5–15 |
| Someone pushed `main` | `merge-start` refuses | `git fetch`, re-verify, `gs sync` if needed | 2–20 |
| Preflight says SSH unusable but git works | bare `ssh -T` fails, `git ls-remote` works | load the passphrase key once (`ssh-add ~/.ssh/id_rsa`) and ensure the repo uses it; never test with a bare `ssh -T` that ignores `core.sshCommand` | 2–5 |
| Workflow push rejected from a deploy key | OAuth/workflow-scope error despite a working key | deploy keys are blocked for `.github/workflows`; use an account SSH key via agent or `gh auth refresh -s workflow`, then `probe-workflow-push.sh` | 5–15 |
| Planner false compat window | every default consumer of a renamed export is flagged | upgrade `plan-layers.mjs` (default imports are not named imports); or add an explicit named export for the compatibility window | 2–10 |
| `astro build` green, app `tsc` red | `astro.config.*` or a shape change outside the build | fix the snapshot, rebuild the affected layer; run the snapshot `tsc` in 2.1b | 10–20 |
| Early layer test timeout | layer 01 tests time out at 5 s; the top layer has the 15 s fix | move the timeout/setup fix into layer 01 or the snapshot; rebuild 01..top | 10–20 |
| Probe commit swallowed the working tree | one-file probe commit shows 50+ files | recover from reflog: `git reflog` → `git checkout <sha> -- .` → `git reset` → remove the probe file; verify the diff against the original | 5–15 |
| Merged but production still old | Netlify `published_deploy.commit_ref` != merge SHA | `deploy-info.mjs` → `verify-deploy.mjs`; wait for the build or trigger one; never call it shipped until `ready` | 5–20 |
| `gh stack view` says `main` belongs to multiple stacks | an older merged stack still tracks `main` | use `gh pr list`/`git log` for verification; prune the old stack after its deploy is verified | 2–10 |

Rules that make recovery cheap:

- **Freeze validated layers.** Never rewrite 1..k-1 after they pass; only k..top
  may move.
- **Prefer upstack repair.** `gs rebase --upstack` + atomic `gs push` rewrites
  only the layers above the fix.
- **Never trust exit codes for merge/submit.** Poll `gs view --short`.
- **Retain recovery material** (`_batch-source`, branches, titles, state) until
  the deploy and a smoke check pass. After finalize, the archive bundle, JSON
  and CSV outside the repo are the recovery material for the deleted refs.

### Old failure table (kept for the tactics)

| Symptom | Cause | Action |
|---|---|---|
| `refusing to allow an OAuth App ... workflow` | token lacks `workflow` scope, or the push used a deploy key | Phase 0; use an account SSH key via an agent or `gh auth refresh -s workflow`; deploy keys are blocked for workflows |
| `Permission denied (publickey)` with a passphrase key | no ssh-agent | `ssh-add ~/.ssh/<key>` once (or use a token); do not leave a decrypted copy on disk |
| `tsc`: missing export in an early layer | plan assigned a dependency later | fix the plan, rebuild that layer |
| `astro build`: `[MISSING_EXPORT]` / `[UNRESOLVED_IMPORT]` | `.astro` consumer of a renamed/moved symbol | compat window, or move the consumer with the change |
| A layer's own tests fail on a file from a later layer | test placed before its subject | move the test to the layer that completes the subject |
| CI red on every PR for one check | already red on `main` | allowlist it; fix it in a separate PR |
| Netlify contexts stay `NOSTATUS` forever | deploy previews not reported | ignore for the gate; verify the deploy separately |
| A test times out only in CI | filesystem/network timing | raise `testTimeout`; do not retry-loop the stack |
| Merge refused | unmet rule or conflict | `gh stack view --short`; `gh stack rebase --upstack`; retry |
| A layer needs a file you already committed | plan gap | add it as its own commit **and re-gate that layer** |

---

## Non-negotiables

- One branch per feature: `<prefix>/NN-<type>-<slug>`, bottom = `01`.
- One file per commit, Conventional Commits, no attribution footers.
- The bottom PR targets `main`; every higher PR targets the one below.
- No auto-merge and no merge queue. GA stacks land through the queue as a
  **single merge group**, so a queue no longer splits a batch — but it still
  needs a `merge_group:` trigger and one more moving part between the wait and
  the deploy.
- Never leave a layer red, and never submit one you know is red.
- No direct pushes or force-pushes to `main`.
- The PR title becomes the **merge commit subject**. Write it like a commit.
- **Land stacks with merge commit or rebase-merge. Never squash a stack:** each
  squash orphans the layer above and the damage cascades up the chain.
- Build on `origin/main` after a fetch, never on a stale local `main`.
- No `git add -A` outside `_batch-source`; probes and feature branches use exact
  paths only.
- Workflow pushes need an account SSH key (in an agent) or a token with the
  `workflow` scope. Repo deploy keys are not workflow credentials.
- **Merged is not shipped.** For an auto-deploy repo, run `verify-deploy.mjs`
  and prove the production deploy is `ready` on the merge commit before
  declaring the batch done.
- **Merged is not finalized.** Archive the tips and delete the remote refs only
  after `mergeCommit` and the layer tip are ancestors of `origin/main`, tip ==
  `headRefOid`, and no post-merge commit exists (a legacy squash stack also needs
  `tree(tip) == tree(mergeCommit)`). `gh stack sync --prune` is local-only; it is
  not finalization.
- Never run `git push origin --delete` from an ahead/behind count, a PR state
  alone, or a `baseRefName` ancestry test. Use `finalize-stack.mjs`, which
  refuses every unproven branch.

## Timing budget (measured on 16 cores, ~190 files)

| Phase | 14 layers | 5 layers |
|---|---|---|
| 0 preflight | 2–5 min (once per repo) | same |
| 1 plan + messages + titles | 3–10 min (planner does the work) | 3–5 min |
| 2 snapshot + branches + commits | 2–5 min (`--no-verify`) | 2–3 min |
| 3 gates (incremental + worktrees) | 4–5 min | 2–3 min |
| 4 invariants | <1 min | <1 min |
| 5 submit + titles | 1–2 min | 1 min |
| 6 CI wait | 6–12 min (one matrix, parallel) | 6–10 min |
| 7 merge + deploy + finalize | 3–5 min | 3–5 min |
| **Session time** | **~25–33 min** | **~19–27 min** |

**The number that matters is the marginal cost, not the total.** A single PR
pays the same CI run and the same top-layer gate (~10 min end to end). Stacking
14 layers adds ~8–10 min: the planner pass, the branch build, and the parallel
gate round. Everything else you already pay.

The first real run of this flow took ~2 h 50 m because of 8 fix cycles (now
Phase 1), 2 credential interruptions (now Phase 0) and 13 bad PR titles
(now Phase 5). Those were process failures, not the price of separation.

A later 8-layer / 123-path run (2026-11) added three more process failures:
a probe `git add` that captured the whole tree, a planner false compat window on
a default export, and a merge reported without a production deploy check. All
three are now scripts/checks (`probe-workflow-push.sh`, the default-import-aware
planner, `verify-deploy.mjs`) and the branch build, gate and title loops are one
command each. Deploy verification adds 2–10 min of waiting for the Netlify build,
and is part of the session time for an auto-deploy repo.

If a batch cannot afford ~10 extra minutes, it should not be a stack: use one PR
with atomic commits (see "When to stack").


## Reporting back

State: branch count, PR numbers and stack link, per-layer check status, allowlisted
checks with the reason, invariant results, the merge commits (one per layer),
and **production deploy proof**: Netlify site, deploy ID, commit, state,
`published_at`, URL and HTTP 200 — or an explicit `deploy NOT verified: <why>`.
"Merged" alone is not a completion report. Also report the **finalize proof**:
classification of every layer, archive dir, unique bundle path and
verification, CSV path, every remote branch deleted with a
`--force-with-lease` push and `git ls-remote` empty, and zero survivors
(`GONE` branches are reported as already gone). Confirm that no forbidden
external write occurred (Sheet, Drive, database).
