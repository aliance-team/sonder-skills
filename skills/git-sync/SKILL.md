---
name: git-sync
description: |-
  Merge the latest main into one or more git branches safely, using isolated git
  worktrees so the primary working tree and any uncommitted work are never disturbed.
  Fetches and prunes first, pre-checks for conflicts, merges only the branches that
  are conflict-free, and prints the push commands instead of pushing.
  Examples:
  - user: "pull main into these branches" / "update my PR branches with main" → sync the whole list in one pass
  - user: "our branch is behind main, sync it" → merge origin/main into that branch
  - user: "merge main into feat-a feat-b feat-c" → fetch, conflict-check, merge each, report
  Do NOT use to rebase or rewrite history, to force-push, or to auto-resolve merge conflicts.
  A sync is additive and branch-scoped: it only ever adds main's commits. It never re-parents,
  re-stacks, squashes, or consolidates branches, and it never moves a branch's own commits.
---

# gitsync

Bring one or more branches up to date with `main` without touching the developer's
working tree, and without pushing. The flow is deliberately conservative: **fetch →
conflict-check → merge only if clean → report → print push commands.**

Run the bundled script for the mechanical part; follow this document for the
judgment calls, guardrails, and the report you hand back.

## Non-negotiable guardrails

These come from real incidents; treat them as hard rules.

1. **Never push unless the developer explicitly asks.** The script prints push
   commands at the end and stops. Only pass `--push` (or run the printed commands)
   when the developer's message clearly authorizes it. Finishing a sync is not
   authorization to push.
2. **Never touch the primary working tree.** It is often dirty, or checked out on a
   different branch, or in a detached state. Do every merge in a temporary
   `git worktree`. Never `git checkout`/`git switch`/`git stash`/`git reset` in the
   primary tree.
3. **No history rewrite, no force push.** Merges only. If a branch needs a rebase,
   say so and stop — this skill does not rebase.
4. **A conflict is a stop sign for that branch.** Abort the merge and leave the
   branch exactly as it was. Never guess a resolution inside this flow.
5. **Read before you write.** `git status --short` and the branch tips first; never
   assume the tree is clean.
6. **A sync is additive and branch-scoped.** It may only add `main`'s commits, as a
   single merge commit. It must never add, drop, or reorder a branch's own commits, and
   must never let a *different* feature branch's commits appear on this branch.
7. **Never re-stack, squash, or "consolidate" branches.** Folding one objective into
   another, or re-parenting a child branch onto a new base, is pollution — not a sync.
   If the branch topology looks wrong, stop and ask; do not "fix" it by rewriting.
8. **"Rebuild" / "clean up" is a red flag, not an instruction.** If asked to rebuild a
   branch, confirm the exact end state and whether history may be rewritten *before*
   running anything. When in doubt, merge only.
9. **Force-push budget: one, and only once.** A single `--force`/`--force-with-lease` to
   publish an already-approved rewrite is the entire budget. If correcting the branch
   would require a **second** force push — history that was already pushed must be
   rewritten *again* — STOP. Do not force-push again and do not "fix" it with another
   rewrite. Leave the branch exactly as it is: that state is the **consequence of the
   earlier bad practice**, and it must be reported, not papered over. Repeated
   force-pushes are forbidden.

## Step 0 — Preconditions

```bash
git rev-parse --is-inside-work-tree
git status --short                 # note, do not act on the primary tree
git branch --show-current || true  # may be detached; that is fine, we use worktrees
```

If a required branch is currently checked out in the primary tree (or any worktree),
the script refuses it. Ask the developer to move that worktree, or create a dedicated
worktree for the branch.

## Step 1 — Fetch, always

```bash
git fetch origin --prune
```

Fetch before anything else so `origin/main` and every `origin/<branch>` are current.
Never compare against a stale local `main`.

If the remote is SSH with a passphrase and no agent is available, an automated
`fetch`/`push` will hang with no TTY. In that case create an **ephemeral** askpass
helper with the passphrase the developer provides, use it for the single command,
and **delete it immediately afterwards**. Never write the passphrase into the repo,
the script, a log, or the report.

```bash
export SSH_ASKPASS=/tmp/opencode/askpass.sh SSH_ASKPASS_REQUIRE=force \
       GIT_ASKPASS=/tmp/opencode/askpass.sh GIT_TERMINAL_PROMPT=0 DISPLAY=:0
# ... run the git command ...
rm -f /tmp/opencode/askpass.sh
```

## Step 1.5 — Stacked-branch gate (pollution guard)

A branch that already contains another branch you are syncing is **stacked**. Merging
`main` into it is still correct, but the child PR will list the parent's commits as its
own unless its PR base is the parent branch — this is the "polluted PR" incident this
gate exists to prevent.

```bash
for a in "$@"; do
  for b in "$@"; do
    [ "$a" = "$b" ] && continue
    git merge-base --is-ancestor "origin/$a" "origin/$b" 2>/dev/null \
      && echo "STACKED: $b contains $a"
  done
done
```

When a stack is detected, do **not** try to flatten it. Merge `main` as usual, then say
in the report: `<child>` contains `<parent>`; its PR base must be `<parent>` (not
`main`), and its count-vs-main will include the parent's commits. That disclosure is the
whole point — silent stacking is what looks polluted.

## Step 2 — The mandatory conflict gate

For each branch, before merging anything, answer two questions:

1. **Is it already up to date?** `git merge-base --is-ancestor origin/main <branch>`
   → if true, skip it (nothing to merge).
2. **Would the merge conflict?** Only then proceed.

Attempt the merge in the isolated worktree. If it fails, the branch has conflicts:
`git merge --abort`, remove the worktree, mark the branch `CONFLICT`, and move on to
the next branch. The developer's rule is explicit — **check for conflicts; only when
there are none, pull main into that branch and continue with the rest.**

## Step 3 — Run the bundled script

The script does Steps 1–2 across any number of branches and prints a summary plus the
push commands.

```bash
bash scripts/gitsync.sh \
  <branchA> <branchB> <branchC>
```

Key behavior:

| Situation | Script behavior |
| --- | --- |
| `origin/main` already an ancestor | `UP-TO-DATE`, skipped |
| Merge is clean | `MERGED`, merge commit created on the branch |
| Merge conflicts | `CONFLICT`, merge aborted, branch untouched, continue with the rest |
| Local branch missing (remote exists) | creates a tracking branch, then proceeds |
| Branch checked out in a worktree | `ERROR`, refuses (you must move that worktree first) |
| Local and remote branch diverged | `ERROR`, refuses (reconcile manually) |
| No `--push` | prints `git push origin refs/heads/<b>:refs/heads/<b>` and exits |
| `--push` passed | pushes each `MERGED` branch (fast-forward only) |

Exit code is `0` only when every branch merged or was up to date; `1` if any branch
conflicted or errored.

Useful flags: `--main <ref>` (default `origin/main`), `--worktree-root <dir>`
(default `/tmp/opencode`).

### Doing it by hand (fallback)

If the script cannot run, reproduce the same shape per branch:

```bash
wt="/tmp/opencode/sync-<slug>"
git worktree add "$wt" "<branch>"
git -C "$wt" merge --ff-only "origin/<branch>"      # catch up the branch's own remote
git -C "$wt" merge origin/main --no-edit            # conflict? abort and report
git -C "$wt" log --oneline -1
git worktree remove --force "$wt"
git worktree prune
```

## Step 4 — Verify what the merge actually did

Before reporting, confirm the merge only brought `main`'s commits and did not drag in
unrelated changes:

```bash
git diff --stat <branch-before> <branch-after>
git log --oneline <branch-before>..<branch-after>
```

If the merge touched application source that has tests, run those tests (see
`Hardening notes` below for why tests are awkward inside a worktree). If it only
touched docs or unrelated apps, a retest is not warranted — say so explicitly rather
than silently skipping.

## Step 5 — Report

Always end with this exact shape:

```
Branch                                    Status       Detail
<branch>                                  MERGED       <before> -> <after>
<branch>                                  UP-TO-DATE   <tip>
<branch>                                  CONFLICT     <conflicting files>
<branch>                                  ERROR        <reason>

Push commands (not run):
  git push origin refs/heads/<branch>:refs/heads/<branch>
  ...
```

Then state plainly: **nothing was pushed**, and that pushing is the developer's call.

## Hardening notes (learned the hard way)

- **A failing pipe can silently kill a push.** Piping a running command into a
  consumer that exits early (e.g. `git push ... | grep '->'`, where `grep` treats the
  pattern as an option and dies) sends `SIGPIPE` to `git push` and aborts it *after*
  it looked like it ran. Use `tail`/`grep -e` for patterns starting with `-`, and
  always verify the remote tip (`git ls-remote origin <ref>`) instead of trusting the
  push output.
- **The pre-push hook is a no-op in worktrees.** Nx reports `Could not find Nx
  modules` without `node_modules`, and PHP suites need `vendor/`. Do not read the
  hook's "push is NOT blocked" line as a pass — it is generic. Treat CI on the PR as
  the real gate, or materialize dependencies if you truly must test locally.
- **Symlinked `vendor/` breaks Composer's base directory.** In a worktree,
  `bootstrap/app.php` resolves through the symlink to the original tree, so Laravel
  boots the wrong app. Use a hardlink copy (`cp -al vendor vendor`) if you must run PHP
  tests in a worktree, not `ln -s`.
- **Branch heads move under you.** A branch may be rebased or pushed by someone else
  between fetch and push. Re-check `origin/<branch>` before pushing; a fast-forward
  push will otherwise be rejected.
- **A branch may need its own remote merged first.** If the local branch is behind
  `origin/<branch>`, the script fast-forwards it before merging `main`; if the two
  have diverged, it refuses rather than inventing a resolution.
- **Clean up.** `git worktree remove --force <path>` for each temp worktree, then
  `git worktree prune`. A leftover worktree blocks the next run with "already checked
  out".
- **"Rebuild" by rebase + force-push is not a sync — it is the incident.** An agent once
  "rebuilt" three stacked branches with `git rebase origin/main` then
  `git push --force`. That re-parented every branch's commits, and each PR then showed
  29 / 35 / 43 commits (every branch carrying the ones below it). The reviewer called the
  branches highly polluted. Updating a branch means merging `main`; it never means
  rebasing, force-pushing, or re-stacking.
- **Stacked branches are only clean with chained PR bases.** If `B` contains `A`, then
  `B`'s PR base must be `A` — never `main` — otherwise `B`'s PR lists `A`'s commits as
  its own. State the base for every branch in the report.
- **Repeated force-pushes are forbidden; one is the entire budget.** Once a rewritten
  history has been pushed, every later correction must be **additive** (a new merge or
  commit) — never another force-push. If a second rewrite appears necessary, that is the
  signal to stop and report: the branch already carries the result of the earlier
  decision, and rewriting it again hides the bad practice instead of resolving it. When
  the budget is spent, the branch is left as-is and the developer decides.

## Handing off a conflict

When a branch conflicts, stop and hand it to the developer (or the
`resolving-merge-conflicts` skill if available). Give them:

```bash
git worktree add /tmp/opencode/resolve-<slug> <branch>
cd /tmp/opencode/resolve-<slug>
git merge origin/main     # resolve, then commit
```

Do not resolve conflicts as part of this flow unless the developer asks you to.

## Bundled resources

```
gitsync/
├── SKILL.md
└── scripts/gitsync.sh   # fetch + conflict gate + merge + report, never auto-push
```
