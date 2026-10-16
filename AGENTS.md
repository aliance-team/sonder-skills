# AGENTS.md

Guidance for agents working in this repository (`sonder-skills`).

## Commits — use `atomic-commits`, without exception

All commits follow the `skills/atomic-commits` skill. No exceptions:

- **One file per commit.** Never `git add .` / `git add -A` / `git add <dir>/`,
  and never group two or more files in a single commit.
- **Conventional Commit messages:** `type(scope): imperative lowercase description`,
  at most 72 characters.
- **Two or more files:** batch with the bundled script instead of committing by hand:

  ```bash
  printf 'path/to/file\ttype(scope): message\n' > /tmp/commits.txt
  bash skills/atomic-commits/atomic-commits.sh /tmp/commits.txt
  ```

- **No** co-author/attribution footers, and **no** `[skip ci]` unless explicitly asked
  in that request.

## Skills and upstream sync

- Upstream skills (aihero, vercel-labs, warpdotdev) are installed under `skills/`
  by the `skills` CLI for local use; refresh them with `npx skills update` (see
  `SYNC.md`).
- Their directories are gitignored: **only first-party skills** are committed here.
