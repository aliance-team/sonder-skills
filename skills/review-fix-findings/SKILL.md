---
name: review-fix-findings
description: |-
  Apply fixes for a specific list of review findings (from correctness-review, context-review, or any review) — one delegated fix per logical issue, verified after each. Does not review or commit.
  Examples:
  - user: "fix the issues the review found" → apply only those findings
  - Called by commit-review after a review returns blocking_issues
  Do NOT use to find issues (see correctness-review / context-review) and do not add unrelated improvements — scope is exactly the given findings list.
---

# fix-review-findings: Targeted Fix Application

Takes a concrete list of findings and fixes exactly those — nothing more.

## Input Required

A list of findings, each with: file, severity, description, and (if given)
a suggested fix.

## Procedure

1. **Group** findings by file — multiple issues in the same file become one
   fix task for that file, not several.
2. **Delegate** each group to a subagent:

```
task(
  description="Fix reviewed issues in {file}",
  run_in_background=true,
  prompt="""
Fix ONLY the following issues in {file}. Do not refactor, "improve", or
touch anything else in this file or others.

<findings>
{the findings for this file}
</findings>
"""
)
```

3. **Verify** each fix once its task completes — if a diagnostics tool is
   available, run it on the changed file; otherwise re-read the file and
   confirm the fix matches the finding.
4. **Follow up** on a failed fix using the same subagent session if the
   tool supports it, rather than starting over blind.

## Rules

- Scope discipline: fix exactly the given findings. No opportunistic
  refactors, no unrelated cleanup.
- One task per file (grouped), not one task per finding.

## Output

Report, per file: which findings were fixed, and any that couldn't be
(with why) — the caller needs this to decide whether to re-review.
