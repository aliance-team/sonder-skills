---
name: git-pr-guardrails
description: Operate GitHub safely in a software factory. Use when committing, pushing a branch, opening or updating a pull request, reading CI, handling a rejected push, stacking PRs, or preparing a release or deploy. The agent ceiling is a pushed feature branch and an open, ready-for-review PR (never a draft); merging, closing, force-pushing, tagging, and deploying belong to the human release manager.
---

# GitHub PR guardrails

## The PR ceiling

An agent may reach a pushed feature branch and an open, **ready-for-review** pull request. Always create the PR ready (`gh pr create`, no `--draft`): a draft hides finished work and still needs a human to flip it. Everything after the open PR is the human release manager's decision: review, merge, close, deploy.

| Action | Agent | Human |
| :-- | :-- | :-- |
| Local atomic commits | yes | yes |
| Push a feature branch | yes | yes |
| Open or update a ready PR (never `--draft`) | yes | yes |
| Read PR, CI, and branch state | yes | yes |
| Merge or close a PR | no | yes |
| Rebase, force-push, rewrite shared history | no | yes, explicitly |
| Tag, release, deploy, workflow dispatch, secrets | no | yes |

Never infer approval from silence, a green check, or a prior "proceed". A new remote state change needs a new explicit instruction. One remote state change per turn, then stop and report.

## Runbook

1. **Preflight.** Confirm the current branch, the base, the clean tree, and the intended remote.
   `git branch --show-current`, `git status --short`, `git log --oneline <base>..HEAD`.
2. **Commit locally.** One file per commit, Conventional Commits. Use the `git-atomic-commit` skill.
3. **Verify locally.** Run the repo's narrow checks; record exit codes and test counts.
4. **Push the feature branch.** A rejected push is a stop signal: fetch and merge, never force.
5. **Open a ready PR.** `gh pr create --base <base>` without `--draft`. State scope, tests, risk, and what is blocked.
6. **Report and stop.** Return the PR URL, head SHA, check conclusions, and open questions.

Completion: a ready PR exists and the report contains URL + SHA + checks + blockers.

## Cheap-model rules

- **Evidence over claims.** Quote the command and its result. "Pushed" means the push output shows the ref update; "green" means the check conclusion, not the absence of a red mark.
- **One branch, one instruction.** Stay on the branch the user named. Do not switch elsewhere to "fix" something.
- **Merge, never rebase.** Bring `main` in with a merge commit. Rebasing and force-pushing shared branches are human-only.
- **Stop at the ceiling.** After the ready PR opens, wait. Never open a draft, and never merge or deploy because the work "looks done".
- **Disclose bypasses.** If a hook must be skipped (`--no-verify`), say so and why; never hide it.

## Failure handling

- **Non-fast-forward:** fetch the remote, merge it into the local branch, resolve, re-run checks, push. Never force.
- **CI red:** reproduce locally, fix, commit, push. If the failure is outside the branch's scope, report it instead of editing another branch.
- **Auth failure:** give the user the exact command. Do not silently switch SSH/HTTPS or credentials.
- **Conflicts:** stop and report the conflicted paths. Do not rewrite history to avoid them.

Full factory model, gates, PR body template, and incident-derived rules:
[references/factory-harness.md](references/factory-harness.md).

Complements `delivery-harness` (delivery units and stacking) and `git-atomic-commit` (commit shape).

## Absolute paths: `git -C`, never a bare `cd`

- Every git command in a handoff block, script or scripted sequence names its own repository: `git -C /abs/path push -u origin <branch>`. Never `cd /abs/path && git …`.
- Why: `cd` mutates shell state past the command. In a `&&` chain a mid-chain failure leaves the *next* command running in the wrong repo; a partial copy-paste starts wherever the terminal happens to be; with two repos in one block it is the difference between pushing the right branch and the wrong one.
- `gh` resolves the repository from the working directory and has no per-command path flag, so confine its `cd` to a subshell: `( cd /abs/path && gh pr create --base main … )`. The parenthesis ends the directory change with the command.
- `-C` goes before the subcommand: `git -C <path> push`, never `git push -C`.
- When a block spans repos, keep every command absolute. The block must be re-runnable from any working directory, and individually pasteable line by line.

Bad:
```
cd /repo/a && git push -u origin feat && gh pr create --base main … && cd /repo/b && git push -u origin other
```

Good:
```
git -C /repo/a push -u origin feat && ( cd /repo/a && gh pr create --base main … ) && \
git -C /repo/b push -u origin other && ( cd /repo/b && gh pr create --base main … )
```
