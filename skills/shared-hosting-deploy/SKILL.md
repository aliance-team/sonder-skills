---
name: shared-hosting-deploy
description: Set up or repair a GitHub Actions deploy to cPanel/Namecheap shared hosting over SSH + rsync for a PHP app — build, quality gates, maintenance mode, a versioned server backup, rsync without --delete, composer install, and rollback. Use when adding or fixing a deploy.yml, wiring SSH_* secrets, or shipping one of the dataemergencia/SCAEM sites. Triggers: "set up the deploy", "deploy workflow", "GitHub Actions deploy", "rsync deploy", "ship to the server", "deployment setup". Anti-triggers: container or cloud deploys (Docker, Kubernetes, PaaS), and the manual offline zip flow (`php devCommands/deploy.php`).
---

# shared-hosting-deploy

One repo, one push, one site updated — never touching the assets.

Proven in production at `dataemergencia.com/.github/workflows/deploy.yml`, mirrored for `zur.dataemergencia.com` and `qrnet.app` (same hosting, different `APP_PATH`).

## Rule 0 — the server owns the big assets

`assets/images`, `assets/fonts` and `assets/video` are **gitignored and multi-gigabyte**:

| Project | `assets/images` | Tracked under `assets/` |
| --- | --- | --- |
| `qrnet.app` | **5.3 GB** | 199 files |
| `zur.dataemergencia.com` | **656 MB** | 233 files |
| `dataemergencia.com` | 72 MB | 250 files |

They are not in the repo, so rsync cannot send them — and must never delete them.

- **Never** pass `--delete` to the rsync step. One `--delete` erases years of server-side images.
- **Always** list them in `--exclude`, even without `--delete`, so a later edit cannot hurt them.
- **Never** include them in the server backup — copying 5.3 GB per deploy fills the disk.
- Assets change by hand (FileZilla / cPanel), never through CI.

If a task looks like it needs the assets inside the pipeline, stop — that is the wrong approach.

## Phase 1 — Inventory the remote before writing anything

Answer these from the repo, never from memory:

| Question | How |
| --- | --- |
| Deploy root (`APP_PATH`)? | server path where `index.php` lives |
| `maintenance.php` present? | `test -f maintenance.php` — `qrnet.app` has **none** |
| Build step? | `package.json` scripts — `zur` builds Tailwind v4; `qrnet` has no build |
| Which asset dirs are gitignored? | `grep -n assets .gitignore` |
| PHP version? | match the server (8.4 here) |

## Phase 2 — The seven stages

1. **Build** (only if the project has one) — e.g. `npx @tailwindcss/cli -i ./assets/css/tailwind/input.css -o ./assets/css/tailwind/output.css --minify`.
2. **Gates** — `vendor/bin/pint --test`, `vendor/bin/phpstan analyse`. Fail *before* the server is touched.
3. **Maintenance down** — `php maintenance.php down`, only if the file exists.
4. **Backup on the server** — copy the project root minus `versions/ vendor/ node_modules/ assets/` into `versions/<project>_<timestamp>/`, then keep the last 15.
5. **rsync** — `burnett01/rsync-deployments`, `-az`, explicit excludes, **no `--delete`**.
6. **Composer install on the server** — `--no-dev --prefer-dist --optimize-autoloader`, via `composer.phar` or the system composer.
7. **Maintenance up** — `if: always()`, so a failed deploy still reopens the site.

Full file: [`templates/deploy.yml`](templates/deploy.yml). Exclusion list and why: [`references/rsync-and-assets.md`](references/rsync-and-assets.md).

## Phase 3 — Secrets

Per repo, in Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `SSH_HOST` | hosting host |
| `SSH_USER` | cPanel user |
| `SSH_KEY` | private deploy key |
| `SSH_PORT` | usually `22` |
| `APP_PATH` | **varies per repo** — the only one that differs between zur and qrnet |

Same hosting ⇒ the first four are shared; `APP_PATH` is not.

## Phase 4 — First-deploy gate

The deploy is not done until, on the server: one changed file is actually new, `vendor/` reinstalled, `assets/images` byte-size **unchanged**, and the site returns 200 with maintenance mode off.

## Phase 5 — Rollback

```bash
cd "$APP_PATH"
cp -a versions/<last_good>/. .
php maintenance.php up   # only if maintenance.php exists
```

Stage 4 exists so this is a copy, not a rebuild.

## Output

```
Deploy:   <repo> → <APP_PATH>
Build:    <none | command>
Gates:    <pint | phpstan | pest>
Assets:   <dirs excluded> — untouched
Secrets:  <missing ones>
Gate:     <verified | blocked: why>
```
