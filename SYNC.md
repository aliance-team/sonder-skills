# Keeping this repo in sync

This repo (`aliance-team/sonder-skills`) is the committed home of the
first-party skills that live in `~/.agents/skills`.

Upstream sets (aihero / `mattpocock/skills`, vercel-labs, warpdotdev) are
installed into `skills/` by the [`skills`](https://www.aihero.dev/skills) CLI
for local use only. Their directories are listed in `.gitignore`, so they stay
on disk but are never committed here — this repo ships **first-party skills
only**. `.skill-lock.json` records the provenance of CLI-installed skills.

## Update from upstream

```bash
npx skills update   # refresh upstream skills into skills/ (gitignored)
git status          # review first-party changes only
```

Or run `scripts/sync.sh`, which updates and then prints the git status.

## Commit and publish

Commit one file per commit with a Conventional Commit message — see the
`atomic-commit` skill (or run `commit-review`) — then push.

## Layout

- `skills/<name>/SKILL.md` — one folder per skill, with `name` + `description` frontmatter.
- `.gitignore` — upstream skill directories installed locally by the CLI.
- `.skill-lock.json` — provenance for every CLI-installed skill.
- `opencode.json` — registers `./skills` for OpenCode discovery when working inside this repo.
