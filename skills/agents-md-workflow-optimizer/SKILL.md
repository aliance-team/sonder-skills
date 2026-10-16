---
name: agents-md-workflow-optimizer
description: Ground a project's AGENTS.md in the measured causes of slow agent sessions — the exact scoped commands, gate-output protocol and skill routing a session needs, turned into always-on rules so work lands in fewer turns. Use when sessions feel slow, or the user asks to "optimize AGENTS.md", "make agents faster", "reduce turns", "speed up the workflow", or when starting a multi-phase plan in a project whose AGENTS.md lists no verify commands. Complements agents-md-generator (writes one from scratch) and agents-md-fixer (de-bloats one): this skill is about throughput, not size.
license: MIT
compatibility: opencode (also works with any agent that reads AGENTS.md)
metadata:
  pairs_with: plan-generator, plan-executor, sonder-sharp-implementation
---

# AGENTS.md Workflow Optimizer

A session is slow for reasons the repo can be blamed for — a test command that discovers nothing, a tool banner that hides the pass/fail line, a missing scoped command so every check runs the whole suite. This skill finds those and writes them into the project's `AGENTS.md` as always-on rules, so the next session doesn't rediscover them turn by turn.

## When to use me

Trigger on: "AGENTS.md is not helping", "make the agent faster in this project", "reduce turns", "sessions take forever", or before running `plan-executor` in a project whose `AGENTS.md` has no verify commands. Also whenever the same project has burned a session on a rerun caused by a tool's output or a wrong command.

Do NOT trigger on: writing a first `AGENTS.md` (use `agents-md-generator`), shrinking a bloated one (use `agents-md-fixer` / `agents-md-progressive-disclosure`), or general code review.

## Why: where the time actually goes

Measured across three delegated sessions: tool execution was **13–30%** of wall time. Model thinking was **half or more**, and a fixed **~3s per turn** of latency added up on its own. So a faster session is **fewer turns and less thinking**, not cleverer tools. This skill removes *decisions and reruns* — it does not add machinery.

The findings it encodes (from a review of those sessions):

1. **The harness ordered mid-process testing.** Every delegation prompt demanded a per-gate command, so agents tested inside every phase. The fix is `plan-generator`'s `deferred` mode — gate *pointers*, one real Verification phase. (This skill only makes sure the executor honours it.)
2. **A stale premise cost ~1/3 of one session.** A gate said `vitest run`; the repo's config excluded every spec, so the first run found nothing and the agent improvised a config and ran the full suite. A precondition + a scoped command would have caught it in seconds.
3. **A tool banner made the agent misread results.** Commands ran as `nx … | tail -12`; ~8 lines of Nx Cloud 401 noise pushed the pass/fail line out of the window, so lint and typecheck were rerun with `grep`. Never pipe a gate command through `tail`/`head`.
4. **The shell is zsh.** `${PIPESTATUS[0]}` prints blank; an unquoted `--include=*.php` fails with "no matches found"; a following `2>/dev/null` then hid the errors.
5. **Plan bookkeeping was expensive.** Two sessions rewrote the whole plan file (~50s each) to flip boxes. Tick by line number.
6. **Design decisions were re-derived at execution time.** ~95s and ~80s of thinking went into choices the plan should have already settled.
7. **Whole-project checks ran when a scoped one existed** — the single biggest per-step multiplier (`eslint <changed>`, `vitest related`, targeted filters).

## Process

### 1. Ground the project (read-only, one batch)

Read together, not one at a time:
- `AGENTS.md` / `CLAUDE.md` and any nested ones; the `instructions` list in `opencode.json`
- lockfiles (`pnpm-lock.yaml`, `composer.lock`, `uv.lock`, `Cargo.lock`) → package manager; `nx.json` / `turbo.json` / workspaces / `go.work` → monorepo
- CI workflows → the ground-truth verify commands
- runner configs (`vitest.config.*`, `phpunit.xml`, `pytest.ini`, eslint config) → **does test discovery actually find anything?** and what the **scoped** form is (one file / "related")

Write down any trap: a cloud/telemetry banner, a runner whose default glob matches nothing, a shell that isn't bash.

### 2. Audit against the finding catalog

For each row, check the project and decide the rule. Skip rows the project isn't exposed to.

| Finding | Check in this repo | Rule to add |
| --- | --- | --- |
| Banner hides pass/fail | does the runner print a cloud/telemetry preamble? | `NX_NO_CLOUD=true` (or the tool's own flag); never `\| tail` a gate command |
| Stale test premise | does default discovery match spec files? | state the exact scoped test command, and a precondition to confirm discovery |
| zsh footguns | shell is zsh | quote globs; no `${PIPESTATUS[0]}`; use `cmd >log 2>&1; echo EXIT=$?` |
| Whole-project checks | is there a scoped lint/test? | always-on: lint/test only the changed files |
| Mid-phase testing | plan uses `tdd` in unattended runs? | prefer `deferred` plans for delegated work |
| Decision re-derivation | plan lacks resolved choices | record unresolved design decisions in the plan's Spec |

### 3. Write the harness block

Add an always-on block to the project's root `AGENTS.md` (target: the root stays under ~40 lines — push anything long into `docs/WORKFLOW.md` and link it conversationally). The block carries only what applies to **every** task:

```markdown
## Workflow

- Lint changed only: `<scoped lint cmd>`
- Test one file: `<cmd> <path>`  ·  Test related: `<related cmd>`
- Set `<BANNER_FLAG>` before any check so tool banners don't hide the result.
- Never pipe a check through `tail`/`head`; redirect to a log and print the tail only on failure.
- Run the command as written. Quote globs. Read the exit code, not the last line.
```

### 4. Install the gate-preference rule (plans)

`plan-generator` and `plan-executor` are mechanism; *how this project verifies* is policy, and policy belongs here. Any session that touches a plan must settle the verification shape with the user **before** writing or running gates — never infer it. Because the rule has to fire in whatever session invokes a plan skill, it must sit in the project's always-on `AGENTS.md`, not in this on-demand skill:

```markdown
## Plans

- Before `plan-generator` writes a plan — or `plan-executor` starts a plan whose mode was never chosen — ask once: **"TDD (tests and a gate per phase) or deferred (build everything, one Verification phase writes the tests and checks all)?"** Never assume; unattended runs default to `deferred` and note it in the Spec.
- `deferred`: implementation phases carry no tests/lint/build and end with `- [ ] **Gate:** deferred → Phase N`; the last phase `Verification` holds the real gates and runs once. The executor ticks a deferred gate only when Phase N passes.
```

Then run `plan-lint.py` (below): a plan written without the question is exactly what its structural checks reject, so the rule is enforced, not just stated.

This clause restates the `deferred` marker and its executor semantics on purpose — the plan skills don't carry them, and the marker is what makes the executor's behaviour unambiguous. Keep it in the root block: it is short, and a rule that must fire whenever a plan appears cannot live behind a link.

### 5. Wire the fast-change skills

Add a short routing note so the right skill is picked by the *shape* of the task, not by keyword. This is what makes sessions effective immediately:

| Shape of task | Skill |
| --- | --- |
| Non-trivial feature, needs a plan first | `plan-generator` → `plan-executor` |
| One or a few files: fix, tweak, rename, endpoint | `sonder-sharp-implementation` |
| 3+ changes with an order between them | `sonder-sharp-implementation-batch` |
| After a subagent writes code | `verification-safety` |

### 6. Verify

- Every command in the block was **seen in the repo** — never invented.
- Deferred plans in the repo pass the bundled linter (below).
- The root file is still under ~40 lines, and `docs/*.md` was **not** added to `instructions` (that would load it every request).

## Bundled tool: plan-lint

`scripts/plan-lint.py` parses a plan file against the `plan-generator` contract and fails on the structural mistakes that make `plan-executor` drift. It runs no LLM and no project commands — pure structure and heuristics:

```bash
python3 skills/agents-md-workflow-optimizer/scripts/plan-lint.py path/to/plan.md
```

It rejects: a phase with no tasks, a phase whose last checkbox isn't a `**Gate:**`, a task after the gate, a `deferred → Phase N` pointing at a missing or non-Verification phase, a deferred gate inside the Verification phase itself. It warns (non-fatal) on gate commands piped through `tail`/`head`, and on bare whole-suite runners (`vitest run`, `eslint .`, `php artisan test` with no filter) where a scoped form exists — the two heuristic failures that cost the most reruns. Prefer it over a global script: the plan format is a fixed contract, so one generic linter serves every project, and it costs no turns to run.

## Boundaries

- Never invent a command. If the scoped form doesn't exist, say so and add it to the repo first.
- Always-on means always-on: put a rule in the root block only if it applies to every task, or it spends attention on every request.
- The plan skills (`plan-generator`, `plan-executor`) stay untouched. Their policy — the mode question and the `deferred` marker — is installed here instead, in the always-on block. The cost is that the clause is duplicated across projects; if either skill ever ships modes natively, delete the clause rather than running both.
- This skill improves *workflow throughput*. It does not review code, fix it, or commit it.
