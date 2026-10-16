---
name: new-git-release
description: >
  Generate release notes for a version by diffing the git history since the
  previous release tag. Use when the user asks for a new release, release
  notes, a changelog for a version, "create release 5.4.0", "improve the
  release description", "what changed since the last release", or invokes
  /new-git-release. Read-only on history; the only write is the notes file.
---

# New Git Release

Turn "create release X.Y.Z" into release notes generated from the commits since
the last released tag. The version is the only input; everything else is
derived from the tree.

## Process

### 1. Resolve the repository and the version

- Repository root: `git rev-parse --show-toplevel`.
- Target version: the user-supplied `X.Y.Z`. Normalize the tag to `vX.Y.Z`.
- If no version was given, ask for one and stop. Never guess it.

### 2. Find the base — the last release in the tree

```bash
git describe --tags --abbrev=0 --match 'v[0-9]*' <ref>
```

Fall back to the highest semver tag when `describe` finds none:

```bash
git tag --sort=-v:refname | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+$' | head -1
```

If the repo has no release tag at all, use the first commit
(`git rev-list --max-parents=0 HEAD`) and **say so** in the output. Never pick
a base at or after the target: if the resolved base is not an ancestor of the
target ref, stop and report the conflict.

### 3. Collect the range

```bash
git log --no-merges --format="%s" <base>..HEAD
git diff --shortstat <base>..HEAD
```

Drop bookkeeping commits that are noise for a reader: `chore(release)` version
bumps, merge commits, and stray `ammend` / `emergency` subjects.

### 4. Group and write the notes

Map Conventional Commit types to user-facing sections:

| Types | Section |
| --- | --- |
| `feat` | New features |
| `fix` | Fixed |
| `perf` | Performance |
| `refactor`, `style` | Changed — only when behaviour or visible structure changes |
| `docs`, `ci`, `chore`, `test`, `build` | Docs & tooling — one line each |

Rules:

- **Collapse, do not transcribe.** The many small commits of one feature become
  one bold lead line with its meaningful details beneath it. A 200-commit range
  is a handful of features, not 200 bullets.
- **Lead with what the user can do**, not with the commit wording.
- Quote Spanish UI labels and visible strings verbatim; keep the prose in
  English.
- **Never invent a change.** Every bullet traces to a commit in the range.
- Open with a one-paragraph summary of the release's headline.
- Close with the range and totals: `` `vX.Y.Z...vX.Y.Z` — N commits, N files, +A / −D ``.

### 5. Write the file

Write the notes to `docs/releases/vX.Y.Z.md`, creating the directory when
missing. Then print the same notes in the reply so they can be pasted into the
release description.

### 6. Report the version bump (never run it)

The project version lives in `package.json`, bumped by the deploy tool
(`pnpm deploy` → `php devCommands/deploy.php`), which commits
`chore(release): bump the asset version to X.Y.Z`. Compare `package.json` with
the target version and, when they differ, hand the user the command. **Never run
the deploy, the bump, or a commit yourself.**

## Gates

- The base tag precedes the target version and is an ancestor of it.
- The range is non-empty; otherwise report "nothing to release" and stop.
- **Never tag, push, publish, or commit.** Creating the release is the user's
  call; this skill only produces the notes and reports the next step.

## Output contract

1. `docs/releases/vX.Y.Z.md` written.
2. The notes printed in the reply.
3. The range/totals line, and the version-bump command when `package.json`
   still holds the previous version.
