# rsync & the untouchable assets

The rsync step is where a deploy either stays safe or destroys the site. This is the whole rule set.

## Why `--delete` is banned here

`zur.dataemergencia.com` (656 MB) and `qrnet.app` (5.3 GB) keep their images, fonts and video
**only on the server**: those paths are in `.gitignore`, so CI has never seen them. rsync with
`--delete` mirrors *absences* too — it would remove every file it cannot find locally, i.e. all of them.

Excluded paths are protected from `--delete` even when it is on, which is why the excludes below
are mandatory belt-and-braces. Without `--delete` they protect against nothing; with it they are the
only thing standing between the deploy and 5.3 GB of images.

## The switch line

```
-az
--exclude=.env
--exclude=.env.*
--exclude=.htaccess
--exclude=.git/
--exclude=.github/
--exclude=node_modules/
--exclude=vendor/
--exclude=versions/
--exclude=backups/
--exclude=storage/
--exclude=tests/
--exclude=docs/
--exclude=openwiki/
--exclude=devCommands/
--exclude=scripts/
--exclude=assets/images*/
--exclude=assets/fonts/
--exclude=assets/video/
--exclude=*.md
--exclude=*.log
--exclude=phpunit.xml
--exclude=pint.json
--exclude=.vscode/
--exclude=.idea/
```

`assets/images*/` (with the wildcard) also covers the hand-made copies that exist on disk —
`assets/images - optimized/`, `assets/images - copia/` — without three separate lines.

## What each group is for

| Excludes | Why |
| --- | --- |
| `assets/images*/ fonts/ video/` | untouchable, server-owned, multi-GB |
| `.env`, `.env.*`, `.htaccess` | server credentials and rewrites; never overwrite |
| `storage/`, `backups/`, `versions/` | runtime logs, backups, and the rollback history |
| `node_modules/`, `vendor/`, `tests/`, `docs/`, `devCommands/`, `scripts/`, `.github/` | not needed to serve the site |
| `*.md`, `*.log`, `phpunit.xml`, `pint.json`, editor dirs | repo-only noise |

## Verify the assets survived

After the first deploy, on the server:

```bash
du -sh "$APP_PATH/assets/images"   # must match pre-deploy size
ls -dt "$APP_PATH/versions"/*/ | head -3
```

If `assets/images` shrank, `--delete` slipped in — restore from `versions/` and remove it.
