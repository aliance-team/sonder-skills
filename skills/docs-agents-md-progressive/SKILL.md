---
name: docs-agents-md-progressive
description: Refactor a bloated AGENTS.md into a minimal root file plus on-demand guide files under docs/agent/. Use when an agent instructions file has grown past ~60 lines, duplicates itself, or mixes always-relevant rules with task-specific detail.
---

# Refactor AGENTS.md for progressive disclosure

Goal: the root `AGENTS.md` holds only what applies to **every** task. Everything else moves
behind a markdown link, loaded only when its trigger fires.

## 1. Find contradictions

List every pair of instructions that cannot both be true. For each one, **ask the user which
version to keep** before writing anything. Common sources:

- A command named with two different package managers (`npm run x` vs `pnpm x`).
- Two files claiming authority over the same concern (local rules vs a shared skill).
- A stated fact that is verifiably false (a doc claims generated pages exist; they do not).
- Factual drift inside a rule's justification (a count or list that has since changed).

Do not silently pick a winner. Do not "fix" a contradiction by writing a compromise that
satisfies neither side.

## 2. Identify the essentials

Only these belong in the root file:

- A one-sentence project description.
- Package manager, **if not npm**.
- Non-standard build, typecheck, lint, and test commands.
- Rules that genuinely apply to every single task (e.g. never destroy uncommitted work).
- A linked index of the on-demand guides, each with its trigger condition.

Everything else is a candidate for extraction. Structure tables and command tables are
essentials; rationale and history are not.

## 3. Group the rest

Group by concern, one file per group, named for the trigger rather than the abstraction:

| Guide | Holds |
|---|---|
| `codebase-navigation.md` | Discovery tool order, fallbacks, when grep is correct |
| Architecture (`<lang>-architecture.md`) | The legacy/modern divide, where new code goes, reference implementations |
| `testing.md` | Canonical runners per change type, coverage expectations, completion evidence |
| `git-workflow.md` | When commits happen, delegation rules, branch ownership |
| `workflow.md` | Plan vs Build roles, delegation policy, failure recovery |
| `skills.md` | Trigger → skill routing table |

Two tests for a rule's home:

- **Essential** if dropping it would cause damage on a task unrelated to its subject.
  A destructive-git prohibition is essential. A PHP class placement rule is not — unless
  the project is PHP-only, in which case a single pointer is enough.

- **On-demand** if it only matters once the task touches that subject.

## 4. Create the file structure

- Root `AGENTS.md`: essentials plus an **On-Demand Guides** section where every entry states
  its trigger inline — `- **Tests:** [Testing](docs/agent/testing.md)`.
- One file per group under `docs/agent/`, linked from the root.
- Safety and delegation policy that must be findable but not always loaded goes in
  `.opencode/scope-protection.md`, linked from a single root rule.
- If a superseded file is tracked in git, replace its body with a pointer stub rather than
  deleting it. Deleting is a destructive operation and the user may still have it referenced.

Suggested shape:

```
AGENTS.md
docs/agent/
  codebase-navigation.md
  <lang>-architecture.md
  testing.md
  git-workflow.md
  workflow.md
  skills.md
.opencode/
  scope-protection.md
```

## 5. Flag for deletion

Report these to the user instead of carrying them forward:

- **Redundant** — the agent already knows it, or it is restated elsewhere in the same file.
  A rule that appears in a table, in a "Why" column, and in a "Key Constraints" list is
  one rule, not three.
- **Too vague to act on** — "write clean code", "follow best practices", "be careful".
  If you cannot imagine a concrete violation, the rule cannot be enforced.
- **Overly obvious** — restating a language or tool guarantee the toolchain already enforces.
- **Wrong-tooling** — a rule for a language or framework the repository does not contain.
- **Stale scaffolding** — agent rosters, tool matrices, or permission tables describing a
  harness that is no longer the one in use.
- **Duplicated by the platform** — content already injected into the system prompt by an
  installed MCP server's protocol.

Present this as a short list with a one-line reason each, plus anything found that the user
did not ask about but that contradicts the refactor (broken doc links, hardcoded credentials
in committed config).

## Rules for the agent running this

- Verify before rewriting. Every command, path, package manager, and count in the output
  must have been read from the repository, not assumed.
- Never duplicate a shared skill's content into the repo. Point at the skill and let it
  stay the single source of truth.
- Do not silently drop a rule. Anything removed goes in the deletion report with its reason.
- Keep the root file under roughly 60 lines. If it grows past that, another extraction is due.
