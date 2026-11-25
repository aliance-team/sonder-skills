---
name: git-commit-summary
description: |-
  Generate a structured summary of a completed review-and-commit run: findings, fixes applied, and commits made. Formatting only — does not review, fix, or commit anything itself.
  Examples:
  - Called by commit-review after its commit step completes
  - user: "summarize what you just committed" → run this against the recent commits
---

# commit-summary: Structured Run Summary

Takes review results + a commit list and formats them for the user.

## Input Required

- Review findings (from `review-changes` / `correctness-review` /
  `context-review`), with fixed/unfixed status
- List of commits made (`git log --oneline -n <count>` covers this)

## Output Format

```markdown
## Summary

### Overview

- **Files changed**: N across M areas
- **Review verdict**: PASS / FAIL (after X cycles)
- **Commits made**: N atomic commits

### Review Findings

| File | Severity | Issue | Fixed? |
| ---- | -------- | ----- | ------ |

### Commits Made

<hash> type(scope): message
<hash> type(scope): message
```

Omit the Findings table entirely if the review found nothing — don't pad
a clean run with an empty table.
