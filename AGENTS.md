# AGENTS.md

Guidance for agents working in this repository (`sonder-skills`).

## Commits — use `git-atomic-commit`, without exception

All commits follow the `skills/git-atomic-commit` skill. No exceptions:

- **One file per commit.** Never `git add .` / `git add -A` / `git add <dir>/`,
  and never group two or more files in a single commit.
- **Conventional Commit messages:** `type(scope): imperative lowercase description`,
  at most 72 characters.
- **Two or more files:** batch with the bundled script instead of committing by hand:

  ```bash
  printf 'path/to/file\ttype(scope): message\n' > /tmp/commits.txt
  bash skills/git-atomic-commit/scripts/atomic-commits.sh /tmp/commits.txt
  ```

- **No** co-author/attribution footers, and **no** `[skip ci]` unless explicitly asked
  in that request.

## Skill naming — category prefix, enforced

- A first-party skill directory is `skills/<category>-<name>`. The categories
  live in `scripts/skill-names.json`: `backend-`, `deploy-`, `docs-`,
  `frontend-`, `git-`, `legacy-`, `media-`, `ops-`, `plan-`, `research-`,
  `review-`, `sonder-`, `test-`.
- New skills, and any skill you rename, must carry a registered category.
  Pick the prefix from what the skill hijacks, not from the tech it mentions.
- Run `node scripts/lint-skill-names.mjs` after adding, renaming or deleting a
  skill. It exits non-zero on an unprefixed name, a stale `legacy` entry, or a
  frontmatter `name` that differs from its directory.
- The `legacy` list holds the skills not renamed yet, and only shrinks: rename
  the skill, then delete its entry.
- Git-ignored upstream skills are out of scope.

## Skills and upstream sync

- Upstream skills (aihero, vercel-labs, warpdotdev) are installed under `skills/`
  by the `skills` CLI for local use; refresh them with `npx skills update` (see
  `SYNC.md`).
- Their directories are gitignored: **only first-party skills** are committed here.
