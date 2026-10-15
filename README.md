<pre align="center">
███████╗   ██████╗   ███╗   ██╗  ██████╗   ███████╗  ██████╗
██╔════╝  ██╔═══██╗  ████╗  ██║  ██╔══██╗  ██╔════╝  ██╔══██╗
███████╗  ██║   ██║  ██╔██╗ ██║  ██║  ██║  █████╗    ██████╔╝
╚════██║  ██║   ██║  ██║╚██╗██║  ██║  ██║  ██╔══╝    ██╔══██╗
███████║  ╚██████╔╝  ██║ ╚████║  ██████╔╝  ███████╗  ██║  ██║
╚══════╝   ╚═════╝   ╚═╝  ╚═══╝  ╚═════╝   ╚══════╝  ╚═╝  ╚═╝
</pre>

<div align="center">

**Agent-grade workflows for AI-based development.**

`31` skills · `4155` lines of pure instruction · `0` runtime dependencies

[![skills](https://img.shields.io/badge/skills-31-brightgreen?style=flat-square&logo=superuser)](skills/)
[![agent](https://img.shields.io/badge/agents-OpenCode-black?style=flat-square)](https://opencode.ai)
[![contract](https://img.shields.io/badge/contracts-machine--parsed-blue?style=flat-square)](skills/plan-generator/SKILL.md)

</div>

---

## This Is Why Your Workflow Is A Mess, Use sonder-skills

Language models are brilliant and unreliable in equal measure. Give one a raw
prompt and you get code that _mostly_ works, committed in one lump, with no
plan, no review, and no trace of what was assumed.

**sonder-skills** is a loadout of composable, machine-parseable workflows that
turn a raw LLM into something closer to an engineer with a process: it plans
before it types, reviews before it commits, fails closed instead of faking
green, and leaves a paper trail a human can audit.

No framework. No daemon. No API key. Just markdown that tells the agent
_exactly_ what to do, in what order, and when to stop.

---

## The Arsenal

Every skill is a self-contained `SKILL.md` — trigger conditions, an explicit
process, hard gates, and a defined output contract. The model doesn't
_imagine_ a workflow; it executes one.

### ★ Core Three

The load-bearing trio — plan the work, run the pipeline, ship the result.

<table>
<tr><td>

**★ [`plan-generator`](skills/plan-generator/SKILL.md)**
Turns a vague feature request into a **spec → phased roadmap → verification
gates**, written to one markdown file. Cheap planning up front so a
misunderstanding doesn't compound into three wrong files.

</td><td>

**★ [`plan-executor`](skills/plan-executor/SKILL.md)**
Walks that file phase by phase, ticks `- [ ]` boxes to `- [x]`, and
**actually verifies each `Gate:`** before moving on. Never skips.
Never fakes it.

</td></tr>
<tr><td colspan="2">

**★ [`commit-review`](skills/commit-review/SKILL.md)**
The full pipeline: review the changes, fix them, commit them atomically,
summarize the run. Orchestrates three specialist skills and does no
reviewing, fixing, or committing itself. Invoking it **is** the commit
authorization.

</td></tr>
</table>

### The Specialists

Each one is useful alone and orchestration-ready as a stage in something
bigger.

| Skill                                                        | What it hijacks                                                                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`correctness-review`](skills/correctness-review/SKILL.md)   | Logic, quality, safety, pattern consistency. Returns a structured `PASS`/`FAIL` verdict with tagged findings. Reads, never writes.                     |
| [`context-review`](skills/context-review/SKILL.md)           | The pass pure code-reading misses: git history, cross-references, diagnostics, build status. Also `PASS`/`FAIL`.                                       |
| [`fix-review-findings`](skills/fix-review-findings/SKILL.md) | Takes an exact findings list and fixes **only those** — grouped per file, one delegated subagent per file, verified after each. No drive-by refactors. |
| [`review-changes`](skills/review-changes/SKILL.md)           | The loop: **review → fix → re-review**, capped at 3 cycles, ending in `PASS`, `FAIL`, or `NO CHANGES`.                                                 |
| [`atomic-commit`](skills/atomic-commit/SKILL.md)             | One file, one Conventional Commit, written from the actual diff — never `update stuff`. Self-installs its own helper script on first use.              |
| [`commit-summary`](skills/commit-summary/SKILL.md)           | Formats findings + fixes + commits into a structured report. Formatting only — it touches nothing.                                                     |

### Beyond the Pipeline

The rest of the loadout, under the same contract: one skill, one responsibility.

#### Shipping & history

| Skill                                                    | What it hijacks                                                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`atomic-commits`](skills/atomic-commits/SKILL.md)       | The batch companion to `atomic-commit`: stages exactly one file per commit through a bundled script, and refuses to run at all on a protected branch.                               |
| [`new-git-release`](skills/new-git-release/SKILL.md)     | Turns "create release X.Y.Z" into release notes by diffing the commits since the last release tag, then writes them where the repo expects them. Read-only on history.             |
| [`gitsync`](skills/gitsync/SKILL.md)                     | Merges the latest `main` into one or more branches in isolated worktrees, pre-checks for conflicts, merges only the clean ones, and prints the push commands instead of pushing.    |
| [`resolving-merge-conflicts`](skills/resolving-merge-conflicts/SKILL.md) | Walks an in-progress merge or rebase conflict through to a resolution.                                                                                              |
| [`verification-safety`](skills/verification-safety/SKILL.md) | The post-subagent safety net: bans destructive git commands and hard-blocks file destruction during verification.                                                                |

#### Implementation

| Skill                                                                          | What it hijacks                                                                                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| [`sonder-sharp-implementation`](skills/sonder-sharp-implementation/SKILL.md)   | Sharp, minimal implementation for a single or few-file change — a bug fix, a tweak, a rename, an endpoint, a component.   |
| [`sonder-sharp-implementation-batch`](skills/sonder-sharp-implementation-batch/SKILL.md) | The same, for 3+ changes where some depend on others: it fixes the order first, then implements.                  |

#### Backend & API

| Skill                                | What it hijacks                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| [`rest-api`](skills/rest-api/SKILL.md) | Resource modelling, HTTP methods, status codes, versioning, and API documentation. |

#### Testing

| Skill                                                                  | What it hijacks                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`vitest-testing-expert`](skills/vitest-testing-expert/SKILL.md)       | Vitest for JS/TS: components, hooks, services, mocks, coverage, Playwright.                |

#### Front end, accessibility & SEO

| Skill                                                | What it hijacks                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`frontend-design`](skills/frontend-design/SKILL.md) | Distinctive, production-grade interfaces — and the judgment to avoid generic AI aesthetics. |
| [`accessibility`](skills/accessibility/SKILL.md)     | WCAG 2.2 audits and fixes: keyboard paths, screen-reader support, semantics.        |
| [`contrast-fixes`](skills/contrast-fixes/SKILL.md)   | The narrow, high-frequency case: colour-contrast ratios to WCAG AA, hue-preserving. |
| [`seo`](skills/seo/SKILL.md)                         | Meta tags, structured data, sitemaps, search visibility.                            |

#### Media

| Skill                                                        | What it hijacks                                                                                          |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [`image-access`](skills/image-access/SKILL.md)               | Finding and reading images across WSL and the Windows host — pasted screenshots, `C:\…` paths, the clipboard. |
| [`ffmpeg-image-ops`](skills/ffmpeg-image-ops/SKILL.md)       | Convert, resize, optimise and batch-process raster images with ffmpeg rather than Pillow.                |
| [`pdf-revision`](skills/pdf-revision/SKILL.md)               | Turns a PDF review doc — screenshots plus numbered notes — into page renders, cropped PNGs and a digest. |

#### Docs, agents & operations

| Skill                                                                                        | What it hijacks                                                                            |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`agents-md-generator`](skills/agents-md-generator/SKILL.md)                                 | Writes a minimal, high-signal `AGENTS.md`, pushing the detail into `docs/{SCOPE}.md`.      |
| [`agents-md-fixer`](skills/agents-md-fixer/SKILL.md)                                         | The same, for a bloated one: audited and split by progressive disclosure.                  |
| [`agents-md-progressive-disclosure`](skills/agents-md-progressive-disclosure/SKILL.md)       | The refactor itself: an instructions file past ~60 lines that mixes always-on rules with task detail. |
| [`shared-hosting-deploy`](skills/shared-hosting-deploy/SKILL.md)                             | GitHub Actions deploys to shared hosting over SSH + rsync, keeping the server's multi-GB assets untouched. |
| [`daily-report`](skills/daily-report/SKILL.md)                                               | Turns the day's commits into a compressed standup report.                                  |
| [`sonder-find-skills`](skills/sonder-find-skills/SKILL.md)                                   | Routes a problem to the right skill of ours by proficiency, in tiers.                      |

---

## System Map

```
                       ┌─────────────────────────────────────────┐
                       │            commit-review                │
                       │        (review → ship → report)         │
                       └────────┬───────────┬───────────┬────────┘
                                │           │           │
                ┌───────────────▼──┐  ┌─────▼──────┐  ┌─▼─────────────┐
                │  review-changes  │  │ atomic-     │  │ commit-       │
                │ review⇄fix⇄re-run│  │ commit      │  │ summary       │
                └───┬─────────┬────┘  └────────────┘  └───────────────┘
                    │         │
        ┌───────────▼──┐  ┌───▼──────────────┐     ┌──────────────────┐
        │ correctness- │  │ context-review   │     │  plan-generator  │
        │ review       │  │ history ⨯ build  │     │  spec▸roadmap▸   │
        └───────┬──────┘  └──────────────────┘     │  gates           │
                │                                  └────────┬─────────┘
                └────────────►┌──────────────────┐◄─────────┘
                              │ fix-review-      │   shared contract:
                              │ findings         │   - [ ] tasks,
                              │ (delegated subs) │   **Gate:** lines
                              └──────────────────┘         │
                                                           ▼
                                                  ┌──────────────────┐
                                                  │  plan-executor   │
                                                  └──────────────────┘
```

Two hard composition rules run through the whole set:

1. **Separation of powers** — reviewers never fix, fixers never review,
   reviewers and fixers never touch git. One skill, one responsibility.
2. **Fail closed** — a review still failing after 3 cycles stops the
   pipeline. Nothing gets committed on a red verdict. Ever.

---

## Install

Add the whole loadout to any project with one command:

```bash
npx skills add aliance-team/sonder-skills
```

or, if you're team pnpm:

```bash
pnpm dlx skills add aliance-team/sonder-skills
```

That's it — the skills are discovered and routed on natural language from
there.

---

## Contribution

Working from source, hacking on skills, or sending changes back?

```bash
git clone git@github.com:aliance-team/sonder-skills.git
```

That clone holds the first-party skills above — nothing else. Upstream sets
(aihero, vercel-labs, warpdotdev) are installed into `skills/` by the
[`skills`](https://www.aihero.dev/skills) CLI for local use only and are
**gitignored**, so they never land in this repo. See [`SYNC.md`](SYNC.md) for
how they are refreshed.

Register the local `skills/` folder for discovery:

```jsonc
// opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "skills": { "paths": ["./skills"] },
}
```

Or vendor individual skills into your own repo so every agent working there
inherits the process:

```bash
mkdir -p .opencode/skills
cp -r sonder-skills/skills/{plan-generator,plan-executor,atomic-commit} .opencode/skills/
```

Each skill is a plain directory — `SKILL.md` plus optional `scripts/` and
`references/`. Copy what you need, delete what you don't, edit the process.
There is nothing to install and nothing to break.

**To contribute a skill:** keep the shape the rest of the set relies on —
frontmatter `name` + explicit `description` with triggers and anti-triggers,
numbered phases, concrete gates, and a defined output block. One skill, one
responsibility. Open a PR.

---

<div align="center">

**trust the process, not the temperature.**

_read the diffs · tick the gates · fail closed · commit clean_

</div>
