---
name: sonder-find-skills
description: Route a problem to the right SONDER first-party skill by proficiency instead of by keyword. Use when the user asks "which of our skills should handle this", "do we have a skill for X", "find our skill for X", "what owns this", invokes /sonder-find-skills, or when the right skill for a job is unclear and the answer should be one of ours. Only routes the skills in this repo; when nothing here fits, it says so rather than stretching a skill.
---

# Sonder Find Skills

`sonder-find-skills` routes a **problem** to a **skill we own**.

Two different questions, two different skills — don't cross them:

| Question | Skill |
| --- | --- |
| "Which of **our** skills should handle this?" | **this one** |
| "Is there a skill in the **ecosystem** for this?" | not this skill — search the registry with `npx skills` |

Everything routed here lives in this repo under `skills/`. When nothing here owns the problem, say so and hand off — never stretch a local skill past its proficiency, and never invent a skill.

## 1. Read the base, don't recall it

The tables below are curated; the **disk is the truth**. Skills get added, renamed and deleted, and a router that answers from memory routes to ghosts.

List the first-party skills (everything not vendored through the CLI), then read the winner's `SKILL.md` before you describe what it does:

```bash
cd ~/.agents   # the sonder-skills checkout
python3 - <<'PY'
import os, re
ignored = set(re.findall(r'^skills/([^/]+)/$', open('.gitignore').read(), re.M))
disk = {d for d in os.listdir('skills') if os.path.isdir(f'skills/{d}')}
print('\n'.join(sorted(disk - ignored)))
PY
```

Every name that prints should appear in a table below. A name listed below that does not print is a stale row — drop it or fix the name. A name that prints but is missing here is an unmapped skill — route it anyway, and add the row.

## 2. Classify the problem

Classify on three axes before matching. Most bad routing is a problem filed under the wrong axis:

1. **Artefact** — what actually changes: code, a test, a doc, an image, a git branch, a pipeline.
2. **Stage** — decide, build, verify, ship, or report.
3. **Domain** — the stack: PHP, JS/TS, node, SQL, CSS, containers.

A problem that lands on a **boundary** between two skills gets **split**, not matched to one of them. "Fix the bug and commit it" is two jobs, not one skill.

## 3. Match by proficiency

Prefer the tiers in order:

| Tier | Meaning | How to use it |
| --- | --- | --- |
| ●●● | **Owns it** | This skill's whole job. Pick it and stop looking. |
| ●●○ | **Supports it** | Bring it alongside a primary, for depth. |
| ●○○ | **Fallback** | Only when nothing above fits, or for one narrow slice. |

### Deciding & planning

| Skill | Tier | Owns |
| --- | --- | --- |
| [`plan-generator`](skills/plan-generator/SKILL.md) | ●●● | Turning a feature request into a phased plan file before any code is written. |
| [`plan-executor`](skills/plan-executor/SKILL.md) | ●●● | Working through an existing plan file's checkboxes and gates, in order. |

### Implementing

| Skill | Tier | Owns |
| --- | --- | --- |
| [`sonder-sharp-implementation`](skills/sonder-sharp-implementation/SKILL.md) | ●●● | A scoped change to one or a few files: bug fix, tweak, rename, endpoint, component. |
| [`sonder-sharp-implementation-batch`](skills/sonder-sharp-implementation-batch/SKILL.md) | ●●● | Three or more changes with an order between them (migration → model → endpoint → UI). |
| [`rest-api`](skills/rest-api/SKILL.md) | ●●○ | The shape of the endpoints: resources, verbs, status codes, versioning. |

### Testing

| Skill | Tier | Owns |
| --- | --- | --- |
| [`vitest-testing-expert`](skills/vitest-testing-expert/SKILL.md) | ●●● | Vitest tests for JS/TS: components, hooks, services, coverage. |

### Reviewing & fixing

| Skill | Tier | Owns |
| --- | --- | --- |
| [`review-changes`](skills/review-changes/SKILL.md) | ●●● | The whole loop: correctness + context, fix, re-review, up to three cycles. |
| [`correctness-review`](skills/correctness-review/SKILL.md) | ●●● | Whether the code is right. One pass, no fixes. |
| [`context-review`](skills/context-review/SKILL.md) | ●●● | What else the change touches: history, cross-references, diagnostics, build. |
| [`fix-review-findings`](skills/fix-review-findings/SKILL.md) | ●●● | Applying a given findings list, one delegated fix at a time. |
| [`verification-safety`](skills/verification-safety/SKILL.md) | ●●● | The post-subagent pass: no destructive git, no file destruction. |
| [`commit-summary`](skills/commit-summary/SKILL.md) | ●●○ | Summarising a review-and-commit run after the fact. |

### Committing, branches & releases

| Skill | Tier | Owns |
| --- | --- | --- |
| [`atomic-commit`](skills/atomic-commit/SKILL.md) | ●●● | Every commit: one Conventional Commit per file, never grouped. |
| [`atomic-commits`](skills/atomic-commits/SKILL.md) | ●●● | The batch case: 2+ files, staged one per commit by the bundled script. |
| [`commit-review`](skills/commit-review/SKILL.md) | ●●● | Review then commit, end to end. |
| [`gitsync`](skills/gitsync/SKILL.md) | ●●● | Merging main into branches in isolated worktrees, conflict-checked. |
| [`resolving-merge-conflicts`](skills/resolving-merge-conflicts/SKILL.md) | ●●● | An in-progress merge or rebase conflict. |
| [`new-git-release`](skills/new-git-release/SKILL.md) | ●●● | Release notes for a version, from the commits since the last tag. |
| [`daily-report`](skills/daily-report/SKILL.md) | ●●○ | A standup report from the day's commits. |

### Deploying

| Skill | Tier | Owns |
| --- | --- | --- |
| [`shared-hosting-deploy`](skills/shared-hosting-deploy/SKILL.md) | ●●● | Shipping a PHP app to cPanel/Namecheap shared hosting over SSH + rsync: secrets, build, gates, maintenance mode, versioned backup, rollback. |

### Front end, accessibility & SEO

| Skill | Tier | Owns |
| --- | --- | --- |
| [`frontend-design`](skills/frontend-design/SKILL.md) | ●●● | Building the interface itself, to a production standard. |
| [`accessibility`](skills/accessibility/SKILL.md) | ●●● | WCAG 2.2 audits and fixes: keyboard paths, screen readers, semantics. |
| [`contrast-fixes`](skills/contrast-fixes/SKILL.md) | ●●● | The narrow case: colour-contrast ratios only, hue-preserving. |
| [`seo`](skills/seo/SKILL.md) | ●●● | Meta tags, structured data, sitemaps, search visibility. |

### Media

| Skill | Tier | Owns |
| --- | --- | --- |
| [`image-access`](skills/image-access/SKILL.md) | ●●● | Finding and reading images across WSL and the Windows host. |
| [`ffmpeg-image-ops`](skills/ffmpeg-image-ops/SKILL.md) | ●●● | Converting, resizing and optimising raster images. |
| [`pdf-revision`](skills/pdf-revision/SKILL.md) | ●●● | Reading a PDF review doc: page renders, cropped screenshots, and a digest pairing each note with its visual. |

### Agent docs & operations

| Skill | Tier | Owns |
| --- | --- | --- |
| [`agents-md-generator`](skills/agents-md-generator/SKILL.md) | ●●● | Writing a minimal, high-signal `AGENTS.md`. |
| [`agents-md-fixer`](skills/agents-md-fixer/SKILL.md) | ●●● | The same, for one that has gone bloated or messy. |
| [`agents-md-progressive-disclosure`](skills/agents-md-progressive-disclosure/SKILL.md) | ●●● | The refactor itself: an instructions file past ~60 lines mixing rules with detail. |

## 4. Verify, then compose

- **Read the winner's `SKILL.md` before you claim what it does.** A one-line summary is orientation; the file is the contract. (Same rule `ask-matt` runs on.)
- **State the tier you picked, and why**, so the user can overrule a ●●○ with a ●●● they know about.
- Composition is allowed and expected: one ●●● primary plus one or two ●●○ supports. Keep the roster short — three skills on one problem is usually two skills and a verb.

## Boundaries

- **Never** recommend a skill that is not on disk.
- **Never** route to an upstream or vendored skill as if it were ours.
- Nothing here fits → say so plainly, then search the registry with `npx skills`, or author a new skill for this repo.

## Output

```
Problem: <one line>
Split:   <the sub-problems, when the request is more than one job>

→ <primary> (●●●) — why it owns this
+ <support> (●●○) — what it adds
```

If you are guessing at a tier, say so and say why.
