---
name: research-find-skills
description: Route a problem to the right SONDER first-party skill by proficiency instead of by keyword. Use when the user asks "which of our skills should handle this", "do we have a skill for X", "find our skill for X", "what owns this", invokes /sonder-find-skills, or when the right skill for a job is unclear and the answer should be one of ours. Only routes the skills in this repo; when nothing here fits, it says so rather than stretching a skill.
---

# Sonder Find Skills

`research-find-skills` routes a **problem** to a **skill we own**.

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
| [`sonder-sharp-batch`](skills/sonder-sharp-batch/SKILL.md) | ●●● | Three or more changes with an order between them (migration → model → endpoint → UI). |
| [`backend-rest-api`](skills/backend-rest-api/SKILL.md) | ●●○ | The shape of the endpoints: resources, verbs, status codes, versioning. |

### Testing

| Skill | Tier | Owns |
| --- | --- | --- |
| [`test-vitest`](skills/test-vitest/SKILL.md) | ●●● | Vitest tests for JS/TS: components, hooks, services, coverage. |

### Reviewing & fixing

| Skill | Tier | Owns |
| --- | --- | --- |
| [`review-changes`](skills/review-changes/SKILL.md) | ●●● | The whole loop: correctness + context, fix, re-review, up to three cycles. |
| [`review-correctness`](skills/review-correctness/SKILL.md) | ●●● | Whether the code is right. One pass, no fixes. |
| [`review-context`](skills/review-context/SKILL.md) | ●●● | What else the change touches: history, cross-references, diagnostics, build. |
| [`review-fix-findings`](skills/review-fix-findings/SKILL.md) | ●●● | Applying a given findings list, one delegated fix at a time. |
| [`ops-preflight-verify`](skills/ops-preflight-verify/SKILL.md) | ●●● | The post-subagent pass: no destructive git, no file destruction. |
| [`git-commit-summary`](skills/git-commit-summary/SKILL.md) | ●●○ | Summarising a review-and-commit run after the fact. |

### Committing, branches & releases

| Skill | Tier | Owns |
| --- | --- | --- |
| [`git-atomic-commit`](skills/git-atomic-commit/SKILL.md) | ●●● | Every commit: one Conventional Commit per file, never grouped, batch included. |
| [`git-commit-review`](skills/git-commit-review/SKILL.md) | ●●● | Review then commit, end to end. |
| [`ops-delivery-harness`](skills/ops-delivery-harness/SKILL.md) | ●●● | Turning reviewed work into a stack of deploy-safe PRs: delivery units in a manifest, per-unit gates, risk tiers that gate merging. |
| [`git-sync`](skills/git-sync/SKILL.md) | ●●● | Merging main into branches in isolated worktrees, conflict-checked. |
| [`git-merge-conflicts`](skills/git-merge-conflicts/SKILL.md) | ●●● | An in-progress merge or rebase conflict. |
| [`git-release`](skills/git-release/SKILL.md) | ●●● | Release notes for a version, from the commits since the last tag. |
| [`ops-daily-report`](skills/ops-daily-report/SKILL.md) | ●●○ | A standup report from the day's commits. |

### Deploying

| Skill | Tier | Owns |
| --- | --- | --- |
| [`deploy-shared-hosting`](skills/deploy-shared-hosting/SKILL.md) | ●●● | Shipping a PHP app to cPanel/Namecheap shared hosting over SSH + rsync: secrets, build, gates, maintenance mode, versioned backup, rollback. |

### Front end, accessibility & SEO

| Skill | Tier | Owns |
| --- | --- | --- |
| [`frontend-design`](skills/frontend-design/SKILL.md) | ●●● | Building the interface itself, to a production standard. |
| [`frontend-a11y`](skills/frontend-a11y/SKILL.md) | ●●● | WCAG 2.2 audits and fixes: keyboard paths, screen readers, semantics. |
| [`frontend-contrast`](skills/frontend-contrast/SKILL.md) | ●●● | The narrow case: colour-contrast ratios only, hue-preserving. |
| [`frontend-seo`](skills/frontend-seo/SKILL.md) | ●●● | Meta tags, structured data, sitemaps, search visibility. |

### Media

| Skill | Tier | Owns |
| --- | --- | --- |
| [`media-image-access`](skills/media-image-access/SKILL.md) | ●●● | Finding and reading images across WSL and the Windows host. |
| [`media-ffmpeg`](skills/media-ffmpeg/SKILL.md) | ●●● | Converting, resizing and optimising raster images. |
| [`docs-pdf-revision`](skills/docs-pdf-revision/SKILL.md) | ●●● | Reading a PDF review doc: page renders, cropped screenshots, and a digest pairing each note with its visual. |

### Agent docs & operations

| Skill | Tier | Owns |
| --- | --- | --- |
| [`docs-agents-md-generate`](skills/docs-agents-md-generate/SKILL.md) | ●●● | Writing a minimal, high-signal `AGENTS.md`. |
| [`docs-agents-md-fix`](skills/docs-agents-md-fix/SKILL.md) | ●●● | The same, for one that has gone bloated or messy. |
| [`docs-agents-md-progressive`](skills/docs-agents-md-progressive/SKILL.md) | ●●● | The refactor itself: an instructions file past ~60 lines mixing rules with detail. |
| [`docs-agents-md-optimize`](skills/docs-agents-md-optimize/SKILL.md) | ●●● | Making sessions faster: scoped commands, gate output, preflight facts, skill routing. |

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
