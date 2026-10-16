# Safety and rollout for live projects

Contents: 1 Risk tiers · 2 Repo rulesets · 3 CODEOWNERS · 4 Deploy-safety rules · 5 Expand/contract migrations · 6 Laravel symlink deploy on merge · 7 Agent security · 8 Metrics

## 1. Risk tiers (the main lever for cutting review time)

| Tier | Examples | Path to main | Human time |
|---|---|---|---|
| 0 | docs, copy, i18n strings, agent docs, chore | green required checks + independent AI review, auto-merge via queue (if opted in) | none |
| 1 | normal feature/UI/logic, additive API, flagged change | same as tier 0 plus QA on preview/staging with flag | QA only |
| 2 | migrations, auth/permissions, payments, API contract change or rename, CI/hooks/test config, test deletion, anything `breaking`, secrets/infra | required checks + independent review + **human approval** (CODEOWNERS) | review the diff |

Tier is a property of the unit in the manifest. `verify_manifest.py` forces tier 2 when protected paths are touched. Tier can only go up during review, never down by the implementing agent.

## 2. Repo rulesets (enforce outside the agent)

- Required status checks on the default branch: format, lint, typecheck, tests, build. Make the AI review a required check too (an AI review that is not required is advice, not a gate).
- Merge queue enabled; stacks are supported by it and enter in order; if one PR is ejected, everything above it is removed too.
- Block force pushes and deletions on the default branch. No bypass actors for the agent's token.
- Require CODEOWNERS review for protected paths (below).
- The agent token can push branches and open/update PRs. It cannot merge to default, edit rulesets, or read production secrets.
- Stacked PRs are public preview, same-repo branches only; CODEOWNERS and rules are evaluated against the stack's base branch. Re-check docs before relying on exact behavior.

## 3. CODEOWNERS for gate integrity

```
# gates must not be editable by the thing they gate
/.github/                      @you
/.githooks/                    @you
**/vitest.config.*             @you
**/eslint.config.*             @you
**/phpunit.xml*                @you
**/pest.php                    @you
**/database/migrations/        @you
/AGENTS.md                     @you
```

Rationale from your own stack: a unit deleted component specs and excluded specs from vitest, and another changed the CI workflow. An agent can make a branch green by weakening the gate. Treat that as tier 2.

## 4. Deploy-safety rules (each merged PR may reach users)

The validation boundary is "safe to run in production if only this unit and those below it are merged", not "builds".

- Backend before consumers; additive before destructive.
- A rename or removal that clients still use (for example an endpoint/route rename) is `breaking`: ship new alongside old, migrate callers, remove old in a later contract unit.
- User-visible change that cannot be half-shipped goes behind a flag, default off.
- Old release and new release must both work against the schema during the deploy window.
- Every unit has a one-line rollback in the manifest. If rollback needs a data fix, it is tier 2.

## 5. Expand/contract migrations (Laravel)

1. Expand: add nullable column/new table/index (concurrently where the DB supports it). Old code ignores it.
2. Deploy code that writes both/reads new with fallback.
3. Backfill in a queued job, not in the migration.
4. Switch reads; keep flag for instant revert.
5. Contract in a later unit: drop old column after one full release cycle.

Never put a data backfill or a column drop in the same unit as the code that starts using the new shape.

## 6. Laravel symlink deploy on merge

Assumed setup: GitHub merge to the default branch triggers CI, which builds and deploys to a VPS using `releases/<sha>` plus a `current` symlink. Because **a merged PR is a production deploy**, "merge" is the real release decision, which is why tiers gate merging, not just review.

### Release order (in the deploy job, never from the agent session)

1. Build in CI, not on the server: `composer install --no-dev --optimize-autoloader`, `npm ci && npm run build`. Upload the artifact to `releases/<sha>`.
2. Link shared state into the release: `.env`, `storage/` (symlink to `shared/`), never copy them.
3. Run `php artisan migrate --force` from the **new** release against the live DB **before** the swap. Only additive migrations are allowed here (see section 5), because old code is still serving traffic.
4. `php artisan config:cache route:cache view:cache event:cache` in the new release.
5. Health-check the new release before it takes traffic (hit it on a private vhost/port or with a `Host` override): `/up` plus one authenticated smoke call that touches the DB and a queue push.
6. Swap atomically: `ln -sfn releases/<sha> current.tmp && mv -Tf current.tmp current`.
7. Reload PHP-FPM (`systemctl reload php8.x-fpm`) so OPcache stops serving the old release. Nginx should use `root /var/www/app/current/public` with `fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name; fastcgi_param DOCUMENT_ROOT $realpath_root;` or you will get a mix of old and new files after the swap.
8. Restart workers: `php artisan queue:restart` (or `horizon:terminate`). Workers started from the old release keep running old code until restarted.
9. Post-deploy watch: 5xx rate and p95 latency against the previous 30 minutes, queue failed-jobs count, scheduler heartbeat. A breach triggers rollback.
10. Keep the last 5 releases; prune older ones.

### Things that bite on this pattern

- **Rollback is not a database rollback.** Swapping the symlink back restores code only. The old code must therefore run against the new schema, which is exactly the expand/contract rule. A unit whose rollback needs `migrate:rollback` or a data fix is tier 2.
- **Old frontend chunks 404.** Users with the app open hold references to old hashed Vite assets. Keep the previous releases' `public/build` assets reachable (copy into a shared assets dir, prune after N releases), or users hit broken lazy-loaded pages right after deploy.
- **Stack merge = N deploys.** Merging a stack through the queue lands PRs one after another. Use a workflow `concurrency` group with `cancel-in-progress: false`: the running deploy finishes and only the newest pending one runs, so intermediate states may be skipped. That is fine only because every unit is independently deployable, so keep enforcing that rule.
- **Migrations are the one irreversible step.** Run them once per deploy, with a lock (`flock`), and fail the deploy if they fail; never let two deploys migrate concurrently.
- **Scheduler and long-running processes:** the cron entry should call `current/artisan` via the symlink; verify no worker or scheduler holds a path to an old release.
- **Maintenance mode is a last resort**, only for tier 2 contract migrations that cannot be made online.

### Deploy workflow skeleton

```yaml
name: deploy
on:
  push:
    branches: [main]
concurrency:
  group: deploy-production
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production        # add required reviewers here for tier-2 releases if wanted
    steps:
      - uses: actions/checkout@v4
      # build, upload artifact, run the 10 steps above via your deploy script
      # on health-check or smoke failure: re-point `current` to previous release and fail the job
```

The agent token must not be able to trigger this job on its own or approve the `production` environment.

## 7. Agent security

- Scoped, short-lived tokens; separate identity for the agent; spend/step limits per run.
- Untrusted text (issue bodies, PR comments, dependency READMEs) is never passed to an agent that holds write or deploy rights without a sanitizing step.
- Reviewer agent is read-only.
- Log every agent action with the SHA it acted on.

## 8. Metrics (to know if the harness works)

- Change failure rate and rollbacks per week.
- Minutes of human time per delivery (target: QA + tier 2 only).
- Share of units by tier; rising tier 2 means classification is too conservative, or work is too coupled.
- Defects found in QA that the reviewer or gates should have caught. Each one becomes a new deterministic gate or reviewer instruction.
- Reviewer false-positive rate; if the human ignores it, it stops being a gate.
