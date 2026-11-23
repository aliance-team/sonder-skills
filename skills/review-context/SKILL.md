---
name: review-context
description: |-
  Check git history, cross-references, diagnostics, and build status for a set of changed files — context a pure code-logic review misses. Returns a structured PASS/FAIL verdict. Does not review code logic itself and does not fix anything.
  Examples:
  - user: "check if these changes break anything elsewhere" → run this review
  - Called by commit-review or review-changes alongside correctness-review
  Do NOT use for code-logic review (see correctness-review) or to apply fixes (see fix-review-findings).
---

# context-review: History & Consistency Check

Checks what a diff alone doesn't show: related history, callers/importers,
diagnostics, build health. Read-only.

## Input Required

- List of changed file paths
- The diff

## Procedure

Delegate to a subagent (or run inline if no subagent/task tool exists):

```
task(
  description="Check git context and related files for missed issues",
  run_in_background=true,
  prompt="""
<review_type>CONTEXT & CONSISTENCY</review_type>

<changed_files>
{list of changed file paths}
</changed_files>

<diff>
{diff}
</diff>

Do NOT review code logic — a separate pass handles that. Check:

1. Git history: `git log --oneline -10 -- {each changed file}`. Related
   recent commits? TODO/FIXME/HACK near the changed lines?
2. Cross-references: files that import/reference the changed modules.
   Config that needs updating? Tests likely affected?
3. Diagnostics: if a language-server or linter is available, run it on
   changed files/directories and report errors or warnings. Skip cleanly
   if none is available — don't fail the review over tooling absence.
4. Build check: if the project has an obvious build/typecheck command
   (check package.json scripts, Makefile, etc.), run it. Skip if none is
   evident.

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentences</summary>
<sources_checked>
  - git log — OK / FINDING
  - cross-references — OK / FINDING
  - diagnostics — OK / ISSUES / SKIPPED (unavailable)
  - build check — OK / FAILED / SKIPPED (unavailable)
</sources_checked>
<findings>
  - [BLOCKING / IMPORTANT / FYI] Category: Description
</findings>
<blocking_issues>BLOCKING items only. Empty if PASS.</blocking_issues>
"""
)
```

## Output

Return the raw tagged block to the caller, unsummarized.
