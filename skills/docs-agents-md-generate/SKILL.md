---
name: docs-agents-md-generate
description: Generate a minimal, high-signal AGENTS.md for a repository, with detailed guidance split into docs/{SCOPE}.md files loaded just-in-time (progressive disclosure).".
license: MIT
compatibility: opencode (also works with any agent that reads AGENTS.md)
---

# AGENTS.md Generator

Build a **tiny root AGENTS.md** plus **scoped docs the agent fetches only when needed**.
Why: AGENTS.md is loaded on every request. Frontier models follow ~150-200 instructions reliably, so every irrelevant line costs tokens and attention. Stale paths actively poison context.

## Rules (non-negotiable)

1. Root AGENTS.md contains only: one-sentence description, package manager (if not npm), non-standard commands, and what applies to _every_ task. Target under 40 lines.
2. Do not run `/init`-style bulk generation. Restraint over comprehensiveness.
3. Describe capabilities and domain concepts, never file-system maps (paths rot). Hints like "API lives under the server package" are OK; exact file paths are not.
4. Links are conversational: `For TypeScript conventions, see docs/TYPESCRIPT.md`. No "ALWAYS", no all-caps.
5. Only write rules you can ground in evidence from the repo (configs, lint rules, existing code). No filler like "write clean code".
6. Never overwrite an existing AGENTS.md. If one exists, stop and use `agents-md-fixer` instead.
7. Do not add `docs/*.md` to `opencode.json` `instructions`: that loads them every request and defeats the purpose.

## Workflow

### Step 1: Detect project shape (read-only)

Monorepo signals (any one): `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, `package.json` with `workspaces`, `go.work`, Cargo `[workspace]`, multiple `composer.json`/`pyproject.toml` under subfolders.
Otherwise: single project.

### Step 2: Detect package manager

| Signal                                     | Manager                                     |
| ------------------------------------------ | ------------------------------------------- |
| `pnpm-lock.yaml`                           | pnpm                                        |
| `yarn.lock`                                | yarn                                        |
| `bun.lockb` / `bun.lock`                   | bun                                         |
| `package-lock.json`                        | npm (omit from AGENTS.md, it's the default) |
| `packageManager` field in package.json     | use it; mention corepack                    |
| `composer.lock`                            | composer                                    |
| `uv.lock` / `poetry.lock` / `Pipfile.lock` | uv / poetry / pipenv                        |
| `Cargo.lock`, `go.mod`                     | cargo, go                                   |

Multiple lockfiles = contradiction. Ask the user which is canonical.

### Step 3: Detect commands

Read `package.json` scripts, `composer.json` scripts, `Makefile`, `justfile`, `Taskfile.yml`, `pyproject.toml` scripts, CI workflows (`.github/workflows`).
Keep only the commands an agent needs to **verify its work**: dev, build, typecheck, lint, test (including how to run a single test). Skip anything obvious (`npm install`).
Prefer what CI runs: it is the ground truth.

### Step 4: One-sentence description

Derive from README, manifest `description`, and entrypoints. Format: `This is a <what> for <who/purpose>.` One sentence. If unsure, ask.

### Step 5: Plan scopes (progressive disclosure)

Consult `references/scopes.md` for the scope catalog and doc template. Create a doc **only if the repo has evidence for it** (e.g. `tsconfig.json` → TYPESCRIPT.md; test runner config → TESTING.md). Typical: ARCHITECTURE, language/framework conventions, TESTING, API, DATABASE, GIT, BUILD.

### Step 6: Present the plan, wait for approval

Show: detected shape, package manager, commands, the proposed root AGENTS.md, and the list of docs with a one-line purpose each. Do not write files until the user approves. Apply changes incrementally if they ask for edits.

### Step 7: Write files

- `AGENTS.md` (root)
- `docs/<SCOPE>.md` for each approved scope. Docs may link to each other and to external specs (nested tree).
- Monorepo: root AGENTS.md covers purpose, navigation, shared tooling. Each package gets its own short `AGENTS.md` (purpose, stack, link to relevant docs). Nested files merge with root, so never repeat root content.
- Optional: offer `ln -s AGENTS.md CLAUDE.md` for Claude Code users.

### Step 8: Verify

- Every linked file exists.
- Every command was seen in the repo (do not invent).
- Root has no rule that only applies to one domain.
- No contradictions between root and docs.

## Root template: single project

```markdown
This is a <one sentence>.

This project uses <pnpm|yarn|bun|composer|uv>.

## Commands

- Dev: `<cmd>`
- Typecheck: `<cmd>`
- Test one file: `<cmd> <path>`

For <scope> conventions, see docs/<SCOPE>.md
```

## Root template: monorepo

```markdown
This is a monorepo containing <what>.

Use <pnpm workspaces|turbo|nx> to manage dependencies.

## Commands

- All packages: `<cmd>`
- One package: `<cmd> --filter <name>`

See each package's AGENTS.md for specific guidelines.
For shared TypeScript conventions, see docs/TYPESCRIPT.md
```

## Example (real-life)

Laravel + Inertia + React app with `composer.lock`, `pnpm-lock.yaml`, Pest, and Pint:

```markdown
This is a multi-tenant Laravel + Inertia + React app for managing ID cards.

PHP uses composer; JS uses pnpm.

## Commands

- Dev: `composer dev`
- Test one file: `php artisan test --filter=<Name>`
- Format: `./vendor/bin/pint`, `pnpm lint`

For Laravel conventions, see docs/LARAVEL.md
For React and Inertia conventions, see docs/REACT.md
For testing, see docs/TESTING.md
```

Adapt commands to what the repo actually defines; this is only an illustration of size and tone.
