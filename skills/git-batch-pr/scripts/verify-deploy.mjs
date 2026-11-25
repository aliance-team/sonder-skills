#!/usr/bin/env node
/**
 * verify-deploy.mjs — fail-closed production deploy verification.
 *
 * A merged PR is not a shipped release. For Netlify, require the site's
 * published deploy to be `ready`, `context=production`, and its commit to match
 * the merge SHA. Also require the live URL to answer 200 (and optionally contain
 * a marker).
 *
 * usage:
 *   node verify-deploy.mjs --sha <merge-sha> [--netlify-site <id|name>]
 *                          [--url <production-url>] [--contains <text>]
 *                          [--github-env <environment>] [--json]
 *
 * exit: 0 verified, 1 stale/failed/unreachable, 2 usage.
 */
import { execFileSync } from 'node:child_process';
import { loadToken, sitesForRepo, siteByIdOrName, publishedSummary } from './lib/netlify.mjs';

const argv = process.argv.slice(2);
const arg = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const has = (name) => argv.includes(name);

if (has('--help') || has('-h')) {
  console.log(
    'usage: verify-deploy.mjs --sha <merge-sha> [--netlify-site <id|name>] [--url <url>] [--contains <text>] [--github-env <env>] [--json]',
  );
  process.exit(0);
}

const sha = arg('--sha');
const netlifyRef = arg('--netlify-site');
const urlOverride = arg('--url');
const contains = arg('--contains');
const githubEnv = arg('--github-env');
const asJson = has('--json');

if (!sha && !urlOverride && !githubEnv) {
  console.error('verify-deploy: pass --sha, --url and/or --github-env');
  process.exit(2);
}

const results = [];
const problems = [];

function short(value) {
  return value ? String(value).slice(0, 7) : 'none';
}

function commitMatches(actual, wanted) {
  if (!actual || !wanted) return false;
  const a = String(actual).toLowerCase();
  const w = String(wanted).toLowerCase();
  return a === w || a.startsWith(w) || w.startsWith(a);
}

async function verifyNetlify() {
  const token = loadToken();
  if (!token) {
    problems.push('no Netlify token (NETLIFY_AUTH_TOKEN or ~/.config/netlify/config.json)');
    return null;
  }

  let site;
  if (netlifyRef) {
    site = await siteByIdOrName(token, netlifyRef);
  } else {
    const sites = await sitesForRepo(token);
    if (sites.length !== 1) {
      problems.push(
        `expected one Netlify site for this repo, found ${sites.length}; pass --netlify-site <id|name>`,
      );
      return null;
    }
    site = sites[0];
  }

  const summary = publishedSummary(site);
  results.push({ type: 'netlify', ...summary });

  if (!sha) {
    problems.push('--sha is required for Netlify verification');
    return summary;
  }
  if (!commitMatches(summary.sha, sha)) {
    problems.push(`published commit ${short(summary.sha)} != ${short(sha)}`);
  }
  if (summary.state !== 'ready') {
    problems.push(`published deploy state ${summary.state ?? 'none'} != ready`);
  }
  if (summary.context && summary.context !== 'production') {
    problems.push(`published context ${summary.context} != production`);
  }
  if (!summary.publishedAt) {
    problems.push('published_at is empty');
  }
  return summary;
}

function verifyGithubEnv() {
  if (!sha) {
    problems.push('--sha is required for GitHub environment verification');
    return;
  }
  const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
    encoding: 'utf8',
  }).trim();
  const deployments = JSON.parse(
    execFileSync(
      'gh',
      ['api', `repos/${repo}/deployments?environment=${encodeURIComponent(githubEnv)}&per_page=20`],
      { encoding: 'utf8' },
    ),
  );
  const deployment = deployments.find((item) => commitMatches(item.sha, sha));
  if (!deployment) {
    problems.push(`no deployment for ${short(sha)} in GitHub environment ${githubEnv}`);
    return;
  }
  const statuses = JSON.parse(
    execFileSync('gh', ['api', `repos/${repo}/deployments/${deployment.id}/statuses?per_page=1`], {
      encoding: 'utf8',
    }),
  );
  const status = statuses[0];
  results.push({
    type: 'github',
    environment: githubEnv,
    deploymentId: deployment.id,
    sha: deployment.sha,
    state: status?.state ?? null,
  });
  if (!status || status.state !== 'success') {
    problems.push(`GitHub deployment ${deployment.id} state ${status?.state ?? 'none'} != success`);
  }
}

async function verifyUrl(target) {
  const response = await fetch(target, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const body = contains ? await response.text() : '';
  results.push({
    type: 'url',
    url: target,
    status: response.status,
    contains: contains ? body.includes(contains) : null,
  });
  if (response.status !== 200) {
    problems.push(`${target} -> HTTP ${response.status}`);
  }
  if (contains && !body.includes(contains)) {
    problems.push(`${target} does not contain ${JSON.stringify(contains)}`);
  }
}

try {
  let netlifyUrl = null;
  // A --sha is a claim about the deployed commit. If it is present and no
  // GitHub environment is doing the commit check, Netlify must prove it — even
  // when --url is also supplied (otherwise --sha would be silently ignored).
  if (netlifyRef || (sha && !githubEnv)) {
    const summary = await verifyNetlify();
    netlifyUrl = summary?.url ?? null;
  }
  if (githubEnv) verifyGithubEnv();

  const target = urlOverride || netlifyUrl;
  if (target) {
    await verifyUrl(target);
  } else if (contains) {
    problems.push('--contains needs --url or a Netlify site');
  }
} catch (error) {
  problems.push(error.message);
}

if (asJson) {
  console.log(JSON.stringify({ ok: problems.length === 0, sha, results, problems }, null, 2));
} else {
  for (const result of results) {
    if (result.type === 'netlify') {
      console.log(
        `NETLIFY ${result.site}: deploy=${result.deployId ?? 'none'} commit=${short(result.sha)} state=${result.state ?? 'none'} context=${result.context ?? 'none'} published=${result.publishedAt ?? 'none'} url=${result.url}`,
      );
    } else if (result.type === 'github') {
      console.log(
        `GITHUB ${result.environment}: deployment=${result.deploymentId} commit=${short(result.sha)} state=${result.state ?? 'none'}`,
      );
    } else {
      console.log(
        `URL ${result.url}: HTTP ${result.status}${result.contains === null ? '' : ` contains=${result.contains}`}`,
      );
    }
  }
}

if (problems.length) {
  console.error(`\nDEPLOY FAIL: ${problems.join('; ')}`);
  process.exit(1);
}
console.log('\nDEPLOY VERIFIED');
