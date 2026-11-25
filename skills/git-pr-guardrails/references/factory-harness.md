# Software-factory harness

A permission model and gate sequence for agent-built software. The agent is a builder, not a
release manager. Cheap models get a narrow, checkable lane and a hard stop.

## Roles

| Role | Owner | Responsibility |
| :-- | :-- | :-- |
| Builder | agent | local changes, atomic commits, feature branch, ready PR, local evidence |
| Reviewer | agent or human | read the PR, report findings, do not change remote state |
| Release manager | human | review, merge, close, deploy, rollback |

The human release manager is the only role that changes the shared state after the PR opens.

## State machine

```
LOCAL → PUSHED → OPEN → MERGED → DEPLOYED
```

The agent owns `LOCAL`, `PUSHED`, and `OPEN`. The human owns `MERGED` and `DEPLOYED`.
A state transition is a gate, not a continuation: stop at the end of each state and report.

## Gates

| Gate | Check | Owner | Failure |
| :-- | :-- | :-- | :-- |
| G0 | correct branch, clean tree, intended base | agent | stop and report |
| G1 | local checks green (format, static analysis, tests) | agent | fix and re-run |
| G2 | push accepted by the remote | agent | fetch + merge, never force |
| G3 | ready PR open, remote CI green | agent | fix and push; report out-of-scope failures |
| G4 | human review | human | changes requested → back to G1 |
| G5 | merge to the target branch | human | resolve on the branch, never rewrite |
| G6 | deploy approval and window | human | stop |
| G7 | post-deploy verification | human + agent evidence | rollback per the release plan |

A failed gate stops the run. Do not skip forward because a later gate looks easy.

## Permission matrix

| Operation | Agent default | Requires a new explicit instruction |
| :-- | :-- | :-- |
| `git add`, `git commit` | yes | no |
| `git push <feature-branch>` | yes | no |
| `gh pr create` (ready, never `--draft`) | yes | no |
| `gh pr create --draft` | no | never; open it ready instead |
| update the PR body or push more commits | yes | no |
| `gh pr checks`, `gh pr view`, `gh api` reads | yes | no |
| `gh pr merge`, `gh pr close` | no | yes |
| `git push --force`, `git rebase`, `git reset` on shared refs | no | yes |
| tag, release, workflow dispatch, secrets, environments | no | yes |
| deploy, rollback, production SQL, server access | no | yes |

When in doubt, open the ready PR and stop. An open PR awaiting review is cheap; an unwanted merge or deploy is not.

## Stacked PRs

- One branch per delivery unit; the base is the previous unit, not `main`.
- The merge order is fixed and explicit: `1 → 2 → 3 → …`.
- After a merge, the human retargets the next PR to `main`.
- Bring `main` forward with merge commits. Rebase and force-push are human-only.
- Never merge a later unit into an earlier one to "propagate" a fix. Fix the owning branch, or
  merge `main` forward.

## Deploy

- Deploy is a separate approval, never a side effect of "the PR is green".
- Deploy only from a merged, identified commit. Record the SHA.
- Verify the smallest external signal after deploy (health endpoint, a route's status, a smoke test).
- Record the rollback path before starting.
- A deploy triggered by merging to `main` still counts as a deploy: say so before merging.

## PR body template

```markdown
## Scope
What this unit changes; what it deliberately does not.

## Evidence
- Local: <commands, exit codes, test counts>
- Remote: <PR checks and conclusions>
- Commit: <head SHA>

## Risk
Blast radius, rollback, data or contract changes.

## Blocked on
Other PRs, deploy approvals, credentials, or decisions.

## Out of scope
Adjacent work left for a later unit.
```

## Incident-derived rules (2026-11)

These rules exist because each failure happened in a real session. Treat them as hard stops.

- **No unrequested history rewrites.** A rebase or cherry-pick to "fix" a stacked PR damaged the
  branch and the review order. Fix the branch in place or ask.
- **No cross-branch propagation.** Merging a capabilities branch into a later branch to move a fix
  created duplicate and missing changes. Merge `main` forward; fix the owning branch.
- **No branch switching while the user works.** Stay on the named branch. A "quick check" elsewhere
  is still a workspace change.
- **No force-push.** A rejected push means fetch + merge. A force-push attempt is a stop-and-report
  event, even when it fails.
- **No draft PRs.** A draft hides finished work and still needs a human to flip it. Open every PR
  ready for review.
- **No merge or close without a new instruction.** Green checks and a finished branch are
  evidence, not authorization.
- **No deploy assumptions.** Production endpoints were assumed ready; they returned 404. Verify the
  dependency before announcing or triggering a deploy.
- **No silent hook bypass.** `--no-verify` skips a real gate; disclose it and the reason.
- **Report the exact state.** Branch name, head SHA, remote ref, check conclusions. A summary that
  omits the branch is not evidence.

## Agent handoff

End every run with:

```
Branch: <name>
Head: <sha>
Remote: <ref update or "not pushed">
PR: <url or "none">
Checks: <pass/fail/skipped, with counts>
Blocked on: <decision, dependency, or "nothing">
Next human action: <review / merge / deploy / none>
```

The handoff is complete only when every line is filled. "Done" without a PR URL and a head SHA is
not a handoff.
