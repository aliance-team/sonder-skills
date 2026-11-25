---
name: git-pr-guardrails
description: Operate GitHub safely in a software factory. Use when committing, pushing a branch, opening or updating a pull request, reading CI, handling a rejected push, stacking PRs, or preparing a release or deploy. The agent ceiling is a pushed feature branch and a draft PR; merging, marking ready, closing, force-pushing, tagging, and deploying belong to the human release manager.
---

# GitHub PR guardrails

## The draft-PR ceiling

An agent may reach a pushed feature branch and a **draft** pull request. Everything after that is the human release manager's decision: mark ready, review, merge, close, deploy.

| Action | Agent | Human |
| :-- | :-- | :-- |
| Local atomic commits | yes | yes |
| Push a feature branch | yes | yes |
| Open or update a draft PR | yes | yes |
| Read PR, CI, and branch state | yes | yes |
| Mark ready, merge, close | no | yes |
| Rebase, force-push, rewrite shared history | no | yes, explicitly |
| Tag, release, deploy, workflow dispatch, secrets | no | yes |

Never infer approval from silence, a green check, or a prior "proceed". A new remote state change needs a new explicit instruction. One remote state change per turn, then stop and report.

## Runbook

1. **Preflight.** Confirm the current branch, the base, the clean tree, and the intended remote.
   `git branch --show-current`, `git status --short`, `git log --oneline <base>..HEAD`.
2. **Commit locally.** One file per commit, Conventional Commits. Use the `git-atomic-commit` skill.
3. **Verify locally.** Run the repo's narrow checks; record exit codes and test counts.
4. **Push the feature branch.** A rejected push is a stop signal: fetch and merge, never force.
5. **Open a draft PR.** State scope, tests, risk, and what is blocked. Do not mark it ready.
6. **Report and stop.** Return the PR URL, head SHA, check conclusions, and open questions.

Completion: a draft PR exists and the report contains URL + SHA + checks + blockers.

## Cheap-model rules

- **Evidence over claims.** Quote the command and its result. "Pushed" means the push output shows the ref update; "green" means the check conclusion, not the absence of a red mark.
- **One branch, one instruction.** Stay on the branch the user named. Do not switch elsewhere to "fix" something.
- **Merge, never rebase.** Bring `main` in with a merge commit. Rebasing and force-pushing shared branches are human-only.
- **Stop at the ceiling.** After the draft PR, wait. Do not continue to ready, merge, or deploy because the work "looks done".
- **Disclose bypasses.** If a hook must be skipped (`--no-verify`), say so and why; never hide it.

## Failure handling

- **Non-fast-forward:** fetch the remote, merge it into the local branch, resolve, re-run checks, push. Never force.
- **CI red:** reproduce locally, fix, commit, push. If the failure is outside the branch's scope, report it instead of editing another branch.
- **Auth failure:** give the user the exact command. Do not silently switch SSH/HTTPS or credentials.
- **Conflicts:** stop and report the conflicted paths. Do not rewrite history to avoid them.

Full factory model, gates, PR body template, and incident-derived rules:
[references/factory-harness.md](references/factory-harness.md).

Complements `delivery-harness` (delivery units and stacking) and `git-atomic-commit` (commit shape).
