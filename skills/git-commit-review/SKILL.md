---
name: git-commit-review
description: |-
  Review uncommitted changes, fix blocking issues, then commit each file atomically once clean, and summarize. Composes review-changes + atomic-commit + commit-summary. Invoking this skill is explicit commit authorization.
  Examples:
  - user: "commit-review" / "review then commit" / "review and commit" → run this
  - user: "check and commit" / "verify and commit" → run this
  Do NOT use if the user wants review only with no commit — use review-changes directly.
---

# commit-review: Review → Commit → Summarize

Orchestrates three independent skills. Does no reviewing, fixing, or
committing itself — it sequences the specialists and passes their output
along.

## Procedure

### 1. Review

Run `review-changes`.

- Result is FAIL after its 3-cycle review-fix cap → stop here. Report the
  failure (its own Phase 4 output) to the user. Do not commit failing changes.
- Result is NO CHANGES → stop. Report "nothing to commit"; skip steps 2-3.
- Result is PASS → continue.

### 2. Commit

Run `atomic-commit` against the now-clean changes. It handles scope
detection, one-file-per-commit enforcement, and its own helper script.

**Authorization**: invoking `commit-review` is the user's explicit
authorization to commit — no additional confirmation needed for this step.

If your environment restricts which agent/role may run `git commit`,
delegate this step to whichever agent holds that permission; otherwise
run it directly. Nothing here assumes a specific subagent name — use
whatever your setup already designates for git writes.

### 3. Summarize

Run `commit-summary` with the Phase 4 review result from step 1 —
including its Review Findings table with Fixed? status — and the commit
list from step 2.

## Key Principles

1. **Quality gate, not speed bump** — if review finds nothing, go straight
   to commit.
2. **Scope discipline** — fixes touch only what review flagged.
3. **Atomic commits** — one file per commit, via `atomic-commit`.
4. **Fail closed** — a review that's still failing after its 3-cycle
   cap stops the workflow; nothing gets committed.
5. **Composable** — each phase is its own skill and can be invoked alone.
