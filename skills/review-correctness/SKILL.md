---
name: review-correctness
description: |-
  Review a set of file changes (diff + full contents) for correctness, quality, safety, and pattern consistency. Returns a structured PASS/FAIL verdict with findings. Does not fix anything or touch git.
  Examples:
  - user: "review these changes for bugs" → run this review, report verdict
  - user: "is this code correct before I commit?" → run this review
  - Called by commit-review or review-changes as one review pass
  Do NOT use for context/history checks (see context-review) or to apply fixes (see fix-review-findings).
---

# correctness-review: Logic & Quality Review

Single-purpose review agent for a set of changed files. Input in, structured
verdict out — no side effects.

## Input Required

- List of changed file paths
- Full content of each changed file
- The diff (`git diff`, or provided diff text)

If any of these are missing, collect them first:

```bash
git status --short
git diff --name-only
git diff
```

## Procedure

Delegate to a subagent (or, if no subagent/task tool is available, perform
the review inline yourself):

```
task(
  description="Review changes for correctness and quality",
  run_in_background=true,
  prompt="""
<review_type>CORRECTNESS & QUALITY</review_type>

<changed_files>
{list of changed file paths}
</changed_files>

<file_contents>
{full content of every changed file, clearly delimited}
</file_contents>

<diff>
{the diff}
</diff>

Focus on:
1. Correctness: logic errors, edge cases, null/undefined handling, off-by-one
2. Pattern consistency with the surrounding codebase
3. Error handling: errors caught and propagated, no empty catches
4. Type safety: unsafe casts/suppressions (`as any`, `@ts-ignore`, etc.)
5. Naming & readability
6. Obvious lint/format issues
7. Security: input validation, injection, secrets exposure
8. Regression risk

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentences</summary>
<findings>
  - [CRITICAL/MAJOR/MINOR] Category: Description
  - File: path (line range)
  - Current: what the code does
  - Suggestion: specific fix
</findings>
<blocking_issues>CRITICAL and MAJOR items only. Empty if PASS.</blocking_issues>
"""
)
```

If run without a subagent, produce the same tagged output format yourself.

## Output

Return the raw `<verdict>`/`<findings>`/`<blocking_issues>` block to the
caller. Don't summarize it away — callers (like `commit-review`) parse it.
