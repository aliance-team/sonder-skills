# Keeping this repo in sync

This repo is a personal snapshot of `~/.agents` (skills + prompts) fed by two streams:

1. **Upstream skills** — aihero (`mattpocock/skills`), vercel-labs, warpdotdev — installed
   and refreshed by the [`skills`](https://www.aihero.dev/skills) CLI.
2. **This repo** (`aliance-team/sonder-skills`) — your own skills and local edits.

`.skill-lock.json` records the provenance (source repo, path, hash) of every CLI-installed skill.

## Update from upstream

```bash
npx skills update   # refresh aihero + other upstream skills into skills/
git status          # review what changed
```

Or run `scripts/sync.sh`, which updates and then prints the git status.

## Commit and publish

```bash
git add -A
git commit -m "chore: sync skills"
git push
```

## Layout

- `skills/<name>/SKILL.md` — one folder per skill, with `name` + `description` frontmatter.
- `.skill-lock.json` — provenance for every CLI-installed skill.
- `opencode.json` — registers `./skills` for OpenCode discovery when working inside this repo.
