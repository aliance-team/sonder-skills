---
name: docs-agents-md-fix
description: Audit and refactor an existing, bloated, or messy AGENTS.md (or CLAUDE.md) into a minimal root file plus scoped docs/*.md files using progressive disclosure.
license: MIT
compatibility: opencode (also works with any agent that reads AGENTS.md)
---

# AGENTS.md Fixer

Refactor an existing AGENTS.md without losing any instruction the user actually needs.
Based on: https://www.aihero.dev/a-complete-guide-to-agents-md

## Rules

1. **Never change behavior silently.** Every original instruction ends up in exactly one place: root, a docs file, or the deletion list with a reason.
2. Do not edit anything until the user approves the plan (Step 6).
3. Back up first: copy to `AGENTS.md.bak` before writing.
4. Contradictions are the user's call. Never pick a winner yourself.
5. Links in the root are conversational: `For testing patterns, see docs/TESTING.md`. No "ALWAYS" or all-caps.
6. Do not add new rules the original did not contain. Verifying commands against the repo is fine; inventing is not.
7. Do not add `docs/*.md` to opencode `instructions` globs; that loads everything every request.

## Workflow

### Step 0: Inventory

Read the target file (`AGENTS.md`, else `CLAUDE.md`). Also check for nested AGENTS.md files and an `opencode.json` `instructions` list. Number every distinct instruction (I1, I2, ...) so nothing gets lost. Report size: lines and approximate instruction count (budget guideline: ~150-200 total across all loaded files).

### Step 1: Find contradictions

List pairs that conflict, including implicit ones (e.g. "use `let`" vs "prefer const", "use npm" vs a `pnpm-lock.yaml` in the repo, "tabs" vs formatter config).
For each, ask the user which version to keep, quoting both with their IDs. Ask all contradictions together using a single question. Wait for answers.

### Step 2: Identify the essentials (root only)

Keep only:

- One-sentence project description
- Package manager (only if not npm; verify against lockfile or `packageManager`)
- Non-standard build/typecheck/test commands (verify they exist in scripts/CI)
- Anything relevant to every single task

If the description or package manager is missing, derive it from the repo and mark it as _added from repo evidence_.

### Step 3: Group the rest

Cluster remaining instructions into categories such as TypeScript conventions, React, Laravel/PHP, testing, API design, database, Git workflow, build/deploy. One file per category: `docs/<SCOPE>.md`. Merge categories with fewer than ~3 instructions into a neighbor. Allow nesting (TYPESCRIPT.md → TESTING.md) and external references (official docs, specs) where they sharpen a rule.

### Step 4: Create the file structure

Produce:

- Minimal root `AGENTS.md` with links to the docs
- Each `docs/<SCOPE>.md` with its instructions, rewritten to be specific (preserve meaning)
- Suggested `docs/` tree

Monorepo: keep root to purpose, navigation, shared tooling; move package-specific rules into `packages/<x>/AGENTS.md` (nested files merge with root, so never duplicate).

Replace file-path maps with capabilities or domain concepts (paths go stale and poison context). If a path rule is truly needed, flag it for the user.

### Step 5: Flag for deletion

Table of every removed instruction:

| ID  | Instruction                          | Reason                                   |
| --- | ------------------------------------ | ---------------------------------------- |
| I12 | "Write clean code"                   | Overly obvious                           |
| I17 | "Be careful with state"              | Too vague to act on                      |
| I21 | "Use async/await"                    | Redundant, the agent already does this   |
| I30 | "Auth lives in src/auth/handlers.ts" | Stale-prone path, discoverable by search |

Reasons allowed: **Redundant**, **Too vague**, **Overly obvious**, **Stale-prone path**, **Superseded by contradiction answer**. If unsure, keep it in a docs file and note the doubt rather than delete.

### Step 6: Present the plan, wait for approval

Show in this order, concisely:

1. Contradictions resolved (with the user's answers)
2. Proposed root AGENTS.md (full text)
3. Proposed docs tree with one line per file
4. Deletion table
5. Coverage check: `N original instructions = X root + Y docs + Z deleted`

Apply edits incrementally if the user requests changes.

### Step 7: Write and verify

After approval: create the backup, write files, then verify:

- Coverage numbers still add up
- Every link resolves to an existing file
- Root is under ~40 lines
- No remaining contradictions between files
- Commands in root exist in the repo

Report before/after size. Offer `ln -s AGENTS.md CLAUDE.md` if the user also uses Claude Code.

## Example (real-life)

Before: a 220-line AGENTS.md mixing "Use npm" (line 4), pnpm commands (line 90), Laravel naming rules, React hooks rules, "write clean code", and a path map.

After:

- Root (about 15 lines): description, "This project uses pnpm", 3 commands, 3 doc links
- `docs/LARAVEL.md`, `docs/REACT.md`, `docs/TESTING.md`
- Deleted: "write clean code" (obvious), path map (stale-prone)
- Asked user once: npm vs pnpm → pnpm
