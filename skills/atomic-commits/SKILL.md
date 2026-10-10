---
name: atomic-commits
description: "Batch commit workflow: stage exactly ONE file per commit using the bundled atomic-commits.sh, with a strict conventional-message format and zero analysis output. Use when the user explicitly says \"commit\" and two or more files changed. Triggers: \"atomic commits\", \"commit all the git diff\", \"commit everything\", \"batch commit\". Invoking it is commit authorization, but it never auto-commits on its own."
---

# atomic-commits — one file, one commit

Single source of truth for the commit rules (formerly `.opencode/commit-rules.md`) and the batching script (formerly `.opencode/scripts/atomic-commits.sh`).

Everything runs **from the repo root**.

## Rule 1: Never Auto-Commit

Only commit when the user explicitly says "commit". No implicit triggers.

- "commit" / "commit this" / "commit that" → triggers commit flow
- "continue there's a lot to commit" → does NOT auto-trigger commit. Wait for an explicit "commit".

## Rule 2: Never Commit on a Protected Branch

`main` (and `master`) are protected. Never commit directly to them — always work on a branch.

- ✅ `git switch -c <type>/<short-description>` → commit on the branch
- ❌ Committing while `HEAD` is on `main`/`master` — FORBIDDEN
- The bundled script **refuses to run on `main`/`master`** and exits non-zero before touching anything.
- Caught mid-flow on `main`? Create a branch first, then commit: `git switch -c <type>/<short-description>`.
- Detached `HEAD` is allowed; only the named protected branches are blocked.
- Rare escape hatch (e.g. a brand-new repo whose only branch is `main`): `ATOMIC_COMMITS_ALLOW_PROTECTED=1`.

## Rule 3: One File Per Commit — Strict

Every commit stages **exactly one file**. No exceptions.

- ✅ `git add path/to/file.php` → `git commit -m "type(scope): message"`
- ❌ `git add .`, `git add -A`, `git add <dir>/` — FORBIDDEN
- ❌ Grouping 2+ files in a single commit — FORBIDDEN
- ❌ Delegating to a "commit" subagent — FORBIDDEN. Use the bundled `atomic-commits.sh` directly.

## Rule 4: Batch with the bundled script (2+ files)

When 2+ files need committing, **never** do them sequentially by hand or group them in one commit.

```bash
# 1. Build the commit list (one line per file: path:commit message)
cat > /tmp/commits.txt << 'EOF'
path/to/file1.php:type(scope): message
path/to/file2.js:type(scope): message
EOF

# 2. Run the batch script (from the repo root)
bash ~/.agents/skills/atomic-commits/atomic-commits.sh /tmp/commits.txt

# 3. Clean up
rm -f /tmp/commits.txt
```

The script lives next to this file at `~/.agents/skills/atomic-commits/atomic-commits.sh` and enforces the rules itself:

- parses `path:message` lines, strips a leading `./`, skips empty lines
- refuses to run at all on the protected branches `main`/`master`
- verifies each file actually has changes (tracked, staged, or untracked) and skips it otherwise
- stages exactly one file, and **aborts the whole batch** if more than one file is ever staged
- commits with the message as given and prints `✅ [n/total] path` per commit, leaving the list file for you to delete

For a single file, a plain `git add <file> && git commit -m "<message>"` is enough — the script is for batches.

## Rule 5: No Analysis Ceremony — ZERO Output Display

Do NOT display to the user:

- ❌ `git diff` output (full or partial) — FORBIDDEN
- ❌ `git diff --stat` output — FORBIDDEN
- ❌ Style/branch/planning analysis — FORBIDDEN
- ❌ Commit summaries with tables — FORBIDDEN

Internal use only: `git diff --stat` / `git status --short` to build the commit list. Then run the script. Done.

## Rule 6: No Push/PR Discussion After Commit

After committing:

- ❌ "Ready to push when you are" — FORBIDDEN
- ❌ "Branch is ahead by N commits" — FORBIDDEN
- ❌ Any mention of pushing, PRs, remotes — FORBIDDEN unless the user asks

Just report: "Done." or "Committed N files."

## Commit Message Format

```
type(scope): short description
```

- `type`: feat, fix, refactor, style, chore, docs, test
- `scope`: qr, fmd, app, uba, petID, templates, etc.
- Message: imperative, lowercase, no period, max 72 chars
- `[skip ci]`: NEVER add it. Do not use it for docs, config, or any other commit. Only add it when the user explicitly asks for it in that request.

## No Co-author/Attribution Footers

Do NOT add "Ultraworked with..." or "Co-authored-by:..." footers. Just the message.

## Relation to `commit-review`

The `commit-review` skill (review → fix → re-review → commit) uses this skill's rules and script for its commit phase. `/atomic-commits` on its own performs no review — it only commits.
