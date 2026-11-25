/**
 * stack-audit.mjs — shared provenance reconciliation for batch-pr-flow.
 *
 * Classifies a remote branch against the PR that supposedly merged it. The
 * proof of a clean merged branch is ancestry:
 *
 *   PR state MERGED
 *   + mergeCommit exists
 *   + mergeCommit is an ancestor of origin/main (never the PR baseRefName)
 *   + remote tip == PR headRefOid
 *   + no commit in base..tip is outside the PR's commit list
 *
 * tree(tip) == tree(mergeCommit) is NOT required. It only holds when main did
 * not move between the PR head and the merge; a mid-flight main advance adds
 * unrelated content to the merge commit and makes the trees differ while the
 * PR is still fully merged. Ancestry already proves the landing, so a tree
 * difference is reported as an advisory reason, never a blocker.
 *
 * Ahead/behind counts are NOT evidence and `git cherry` is report-only: with a
 * merge-commit landing the layer tips stay reachable from main, but a legacy
 * squash landing leaves them permanently "ahead" and cherry overcounts.
 *
 * Everything here is fail-closed: an API failure, a missing object, an
 * unresolved ref or incomplete data becomes UNKNOWN/MERGED_UNVERIFIED, never
 * MERGED_CLEAN.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve as resolvePath } from 'node:path';

const MAX_BUFFER = 512 * 1024 * 1024;

export const CLASSES = [
  'MERGED_CLEAN',
  'MERGED_POST_COMMITS',
  'CLOSED_UNMERGED',
  'OPEN',
  'NO_PR',
  'MERGED_UNVERIFIED',
  'GONE',
  'UNKNOWN',
];

// Merged-but-alive branches. "ZOMBIE" is deliberately reserved for these:
// CLOSED_UNMERGED and NO_PR-with-work are "unmerged work", not zombies.
export const ZOMBIE_CLASSES = new Set([
  'MERGED_CLEAN',
  'MERGED_POST_COMMITS',
  'MERGED_UNVERIFIED',
]);

export const DELETABLE_CLASSES = new Set(['MERGED_CLEAN', 'GONE']);

export const HARD_FAILURE_CLASSES = new Set(['UNKNOWN', 'MERGED_UNVERIFIED']);

export function git(repo, ...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function gitOk(repo, ...args) {
  try {
    return { ok: true, out: git(repo, ...args), err: '', status: 0 };
  } catch (error) {
    return {
      ok: false,
      out: String(error.stdout ?? '').trim(),
      err: String(error.stderr ?? '').trim(),
      status: typeof error.status === 'number' ? error.status : null,
    };
  }
}

export function gh(repo, ...args) {
  return execFileSync('gh', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();
}

export function shortSha(sha) {
  return sha ? String(sha).slice(0, 8) : '-';
}

export function treesEqual(repo, left, right) {
  try {
    execFileSync('git', ['diff', '--quiet', left, right], {
      cwd: repo,
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    // 1 = trees differ; >1 = missing object or another git error.
    return error.status === 1 ? false : null;
  }
}

export function isAncestor(repo, ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: repo,
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    // git uses exit 1 for "not an ancestor" and >1 for a real error.
    return error.status === 1 ? false : null;
  }
}

export function readRemoteHeads(repo) {
  const out = git(repo, 'ls-remote', '--heads', 'origin');
  const heads = new Map();
  for (const line of out.split('\n')) {
    const match = line.match(/^([0-9a-f]{40})\trefs\/heads\/(.+)$/);
    if (match) heads.set(match[2], match[1]);
  }
  if (!heads.size) throw new Error('git ls-remote returned no branch heads');
  return heads;
}

export function resolveBase(repo, baseRef, remoteHeads) {
  const result = gitOk(repo, 'rev-parse', '--verify', `${baseRef}^{commit}`);
  if (!result.ok) throw new Error(`base ref '${baseRef}' does not resolve`);
  const sha = result.out;
  const match = baseRef.match(/^(?:origin|refs\/remotes\/origin)\/(.+)$/);
  if (match && remoteHeads.has(match[1]) && remoteHeads.get(match[1]) !== sha) {
    throw new Error(
      `base '${baseRef}' is stale: local ${shortSha(sha)} != remote ${shortSha(
        remoteHeads.get(match[1]),
      )}; run git fetch origin first`,
    );
  }
  return sha;
}

export function repoSlug(repo) {
  try {
    return gh(repo, 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner');
  } catch {
    const url = git(repo, 'remote', 'get-url', 'origin');
    const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    if (!match) throw new Error(`cannot determine GitHub repo from origin URL: ${url}`);
    return `${match[1]}/${match[2]}`;
  }
}

export function listPRs(repo) {
  const raw = gh(
    repo,
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    '200',
    '--json',
    'number,state,baseRefName,headRefName,headRefOid,mergedAt,mergeCommit,isDraft,title',
  );
  const prs = JSON.parse(raw);
  if (!Array.isArray(prs)) throw new Error('gh pr list did not return an array');
  if (prs.length >= 200) {
    throw new Error(
      'gh pr list returned 200 rows (the --limit); refusing to classify NO_PR from a truncated list',
    );
  }
  return prs;
}

function newestFirst(a, b) {
  const am = a.mergedAt ? Date.parse(a.mergedAt) : 0;
  const bm = b.mergedAt ? Date.parse(b.mergedAt) : 0;
  return bm - am || b.number - a.number;
}

export function selectPR(candidates) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => b.number - a.number);
  const open = sorted.find((pr) => pr.state === 'OPEN');
  if (open) return { pr: open, reason: 'open PR wins over any merged/closed history' };
  const merged = sorted.filter((pr) => pr.state === 'MERGED').sort(newestFirst);
  if (merged.length) return { pr: merged[0], reason: 'newest merged PR' };
  const closed = sorted.filter((pr) => pr.state === 'CLOSED');
  if (closed.length) return { pr: closed[0], reason: 'most recent closed PR' };
  return { pr: sorted[0], reason: 'unrecognised PR state' };
}

export function ensureCommit(repo, sha, { branch = null, log = () => {} } = {}) {
  if (!sha) return false;
  if (gitOk(repo, 'cat-file', '-e', `${sha}^{commit}`).ok) return true;
  if (branch) {
    log(`fetching ${branch} (object ${shortSha(sha)} is not local)`);
    gitOk(repo, 'fetch', '--quiet', '--no-tags', 'origin', `refs/heads/${branch}`);
    if (gitOk(repo, 'cat-file', '-e', `${sha}^{commit}`).ok) return true;
  }
  log(`fetching object ${shortSha(sha)} by sha`);
  gitOk(repo, 'fetch', '--quiet', '--no-tags', 'origin', sha);
  return gitOk(repo, 'cat-file', '-e', `${sha}^{commit}`).ok;
}

function resolvePrBase(repo, baseRefName, { baseRef, baseSha, remoteHeads }) {
  const baseName = baseRef
    .replace(/^origin\//, '')
    .replace(/^refs\/remotes\/origin\//, '');
  if (baseRefName === baseName) return baseSha;
  if (remoteHeads.has(baseRefName)) return remoteHeads.get(baseRefName);
  for (const candidate of [`refs/remotes/origin/${baseRefName}`, baseRefName]) {
    const result = gitOk(repo, 'rev-parse', '--verify', `${candidate}^{commit}`);
    if (result.ok) return result.out;
  }
  return null;
}

function branchStats(repo, baseSha, tipSha) {
  const counts = git(repo, 'rev-list', '--left-right', '--count', `${baseSha}...${tipSha}`)
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
  const behind = Number.isFinite(counts[0]) ? counts[0] : null;
  const ahead = Number.isFinite(counts[1]) ? counts[1] : null;

  const numstat = git(repo, 'diff', '--numstat', '-M', `${baseSha}...${tipSha}`);
  let deltaFiles = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.split('\n')) {
    if (!line) continue;
    const [added, removed, path] = line.split('\t');
    if (!path) continue;
    deltaFiles += 1;
    if (/^\d+$/.test(added)) insertions += Number(added);
    if (/^\d+$/.test(removed)) deletions += Number(removed);
  }
  const deltaPaths = git(repo, 'diff', '--name-only', '-M', `${baseSha}...${tipSha}`)
    .split('\n')
    .filter(Boolean);

  const cherry = git(repo, 'cherry', baseSha, tipSha)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [mark, sha] = line.split(/\s+/);
      return { mark, sha };
    });
  const unique = cherry.filter((entry) => entry.mark === '+');

  return {
    ahead,
    behind,
    uniqueCommitCount: unique.length,
    equivalentCommitCount: cherry.length - unique.length,
    uniqueShas: unique.map((entry) => entry.sha),
    deltaFiles,
    insertions,
    deletions,
    deltaPaths,
  };
}

function patchIds(repo, shas) {
  const ids = [];
  for (const sha of shas) {
    try {
      const patch = execFileSync('git', ['show', '--format=', '--no-renames', '--binary', sha], {
        cwd: repo,
        maxBuffer: MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const out = execFileSync('git', ['patch-id', '--stable'], {
        cwd: repo,
        input: patch,
        encoding: 'utf8',
        maxBuffer: MAX_BUFFER,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (out) ids.push({ sha, patchId: out.split(/\s+/)[0] });
    } catch {
      ids.push({ sha, patchId: null });
    }
  }
  return ids;
}

const prCommitCache = new Map();

function prCommits(repo, slug, number) {
  const key = `${slug}#${number}`;
  if (prCommitCache.has(key)) return prCommitCache.get(key);
  try {
    const out = gh(
      repo,
      'api',
      `repos/${slug}/pulls/${number}/commits`,
      '--paginate',
      '--jq',
      '.[].sha',
    );
    const shas = out.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!shas.length) throw new Error('empty commit list');
    prCommitCache.set(key, shas);
    return shas;
  } catch {
    prCommitCache.set(key, null);
    return null;
  }
}

export function classifyRecord(record) {
  if (record.problem) return { classification: 'UNKNOWN', reasons: [record.problem] };

  const state = record.state;
  if (!state) {
    if (!record.pr) return { classification: 'NO_PR', reasons: ['no PR references this branch'] };
    return { classification: 'UNKNOWN', reasons: [`PR #${record.pr} has no state`] };
  }

  if (!record.tip) {
    if (state === 'MERGED') {
      if (!record.mergeCommit) {
        return { classification: 'MERGED_UNVERIFIED', reasons: ['merged PR has no mergeCommit'] };
      }
      if (record.mergeCommitAncestor !== true) {
        return {
          classification: 'MERGED_UNVERIFIED',
          reasons: [`mergeCommit ${shortSha(record.mergeCommit)} is not an ancestor of the base`],
        };
      }
      // With the branch ref gone, the PR head's ancestry is the content proof.
      // Only demand it when headRefOid is known; otherwise fall through to the
      // remaining structural evidence rather than throw.
      if (record.headRefOid && record.headAncestor !== true) {
        return {
          classification: 'MERGED_UNVERIFIED',
          reasons: [
            record.headAncestor === false
              ? `PR head ${shortSha(record.headRefOid)} is NOT an ancestor of the base`
              : `PR head ${shortSha(record.headRefOid)} could not be verified against the base`,
          ],
        };
      }
      const goneReasons = [
        record.headAncestor === true
          ? `branch is gone; PR #${record.pr} is merged in origin/main and its head is an ancestor of the merge`
          : `branch is gone; PR #${record.pr} is merged in origin/main`,
      ];
      if (record.treeMatches === false) {
        goneReasons.push(
          'tip tree differs from mergeCommit tree (main moved before merge; ancestry proof holds)',
        );
      }
      return { classification: 'GONE', reasons: goneReasons };
    }
    if (state === 'OPEN') return { classification: 'OPEN', reasons: [`PR #${record.pr} is OPEN`] };
    if (state === 'CLOSED') {
      return { classification: 'CLOSED_UNMERGED', reasons: [`PR #${record.pr} is CLOSED`] };
    }
    return { classification: 'UNKNOWN', reasons: [`PR #${record.pr} state '${state}'`] };
  }

  if (state === 'OPEN') return { classification: 'OPEN', reasons: [`PR #${record.pr} is OPEN`] };

  if (state === 'MERGED') {
    if (!record.mergeCommit) {
      return { classification: 'MERGED_UNVERIFIED', reasons: ['merged PR has no mergeCommit'] };
    }
    if (record.mergeCommitAncestor !== true) {
      return {
        classification: 'MERGED_UNVERIFIED',
        reasons: [
          record.mergeCommitAncestor === false
            ? `mergeCommit ${shortSha(record.mergeCommit)} is NOT an ancestor of the base`
            : `mergeCommit ${shortSha(record.mergeCommit)} could not be verified against the base`,
        ],
      };
    }
    if (!record.headRefOid || record.tip !== record.headRefOid) {
      return {
        classification: 'MERGED_POST_COMMITS',
        reasons: [
          `remote tip ${shortSha(record.tip)} != PR headRefOid ${shortSha(record.headRefOid)}`,
        ],
      };
    }
    if (record.commitsAfterHead == null || record.commitsOutsidePr == null) {
      return {
        classification: 'UNKNOWN',
        reasons: ['PR commit list could not be compared with the branch'],
      };
    }
    if (record.commitsAfterHead > 0) {
      return {
        classification: 'MERGED_POST_COMMITS',
        reasons: [`${record.commitsAfterHead} commit(s) after the PR head`],
      };
    }
    if (record.commitsOutsidePr > 0) {
      return {
        classification: 'MERGED_POST_COMMITS',
        reasons: [`${record.commitsOutsidePr} commit(s) are not in the PR commit list`],
      };
    }
    const cleanReasons = [
      'mergeCommit is an ancestor of origin/main; tip == headRefOid; no commit outside the PR commit list',
    ];
    if (record.treeMatches === false) {
      cleanReasons.push(
        'tip tree differs from mergeCommit tree (main moved before merge; ancestry proof holds)',
      );
    }
    return { classification: 'MERGED_CLEAN', reasons: cleanReasons };
  }

  if (state === 'CLOSED') {
    const stats =
      record.uniqueCommitCount == null
        ? ''
        : `; ${record.uniqueCommitCount} unique commit(s), ${record.deltaFiles ?? '?'} file(s) vs base`;
    return { classification: 'CLOSED_UNMERGED', reasons: [`PR #${record.pr} is CLOSED${stats}`] };
  }

  return { classification: 'UNKNOWN', reasons: [`PR #${record.pr} state '${state}'`] };
}

function annotate(record) {
  const { classification, reasons } = classifyRecord(record);
  record.classification = classification;
  record.reasons = [...(record.reasons ?? []), ...reasons];
  return record;
}

export function collectRecords({
  repo,
  baseRef = 'origin/main',
  prefix = 'fastcatalog/',
  branchNames = null,
  log = () => {},
}) {
  const remoteHeads = readRemoteHeads(repo);
  const baseSha = resolveBase(repo, baseRef, remoteHeads);
  const slug = repoSlug(repo);
  const prs = listPRs(repo);

  const byHead = new Map();
  for (const pr of prs) {
    if (!byHead.has(pr.headRefName)) byHead.set(pr.headRefName, []);
    byHead.get(pr.headRefName).push(pr);
  }

  const names = branchNames
    ? [...new Set(branchNames)]
    : [...remoteHeads.keys()].filter((name) => name.startsWith(prefix)).sort();

  const records = [];
  for (const name of names) {
    const candidates = byHead.get(name) ?? [];
    const selected = selectPR(candidates);
    const pr = selected?.pr ?? null;
    const record = {
      name,
      tip: remoteHeads.get(name) ?? null,
      pr: pr?.number ?? null,
      state: pr?.state ?? null,
      base: pr?.baseRefName ?? baseRef,
      headRefOid: pr?.headRefOid ?? null,
      mergeCommit: pr?.mergeCommit?.oid ?? null,
      mergedAt: pr?.mergedAt ?? null,
      title: pr?.title ?? null,
      isDraft: pr?.isDraft ?? null,
      prCandidates: candidates.map((candidate) => candidate.number).sort((a, b) => a - b),
      prSelection: selected?.reason ?? null,
      ahead: null,
      behind: null,
      uniqueCommitCount: null,
      equivalentCommitCount: null,
      deltaFiles: null,
      insertions: null,
      deletions: null,
      deltaPaths: [],
      uniquePatchIds: [],
      mergeCommitAncestor: null,
      headAncestor: null,
      treeMatches: null,
      commitsOutsidePr: null,
      commitsAfterHead: null,
      prCommitCount: null,
      problem: null,
      reasons: [],
      classification: null,
    };

    if (!record.tip) {
      if (pr?.state === 'MERGED') {
        if (!record.mergeCommit) {
          record.reasons.push('merged PR has no mergeCommit');
        } else if (!ensureCommit(repo, record.mergeCommit, { log })) {
          record.reasons.push(
            `merge commit ${shortSha(record.mergeCommit)} is not available locally`,
          );
        } else if (!record.headRefOid || !ensureCommit(repo, record.headRefOid, { log })) {
          record.problem = 'PR head is not available locally; cannot prove its content';
        } else {
          record.mergeCommitAncestor = isAncestor(repo, record.mergeCommit, baseSha);
          record.headAncestor = isAncestor(repo, record.headRefOid, baseSha);
          if (record.mergeCommitAncestor !== true) {
            record.reasons.push(
              `merge commit ${shortSha(record.mergeCommit)} is not an ancestor of the base`,
            );
          } else {
            record.treeMatches = treesEqual(repo, record.headRefOid, record.mergeCommit);
          }
        }
      }
      records.push(annotate(record));
      continue;
    }

    if (!ensureCommit(repo, record.tip, { branch: name, log })) {
      record.problem = `branch tip ${shortSha(record.tip)} is not available locally`;
      records.push(annotate(record));
      continue;
    }

    const stats = branchStats(repo, baseSha, record.tip);
    record.ahead = stats.ahead;
    record.behind = stats.behind;
    record.uniqueCommitCount = stats.uniqueCommitCount;
    record.equivalentCommitCount = stats.equivalentCommitCount;
    record.deltaFiles = stats.deltaFiles;
    record.insertions = stats.insertions;
    record.deletions = stats.deletions;
    record.deltaPaths = stats.deltaPaths;

    if (!pr) {
      record.uniquePatchIds = patchIds(repo, stats.uniqueShas);
      records.push(annotate(record));
      continue;
    }

    if (pr.state === 'CLOSED') {
      record.uniquePatchIds = patchIds(repo, stats.uniqueShas);
      records.push(annotate(record));
      continue;
    }

    if (pr.state === 'MERGED') {
      if (!record.headRefOid) {
        record.problem = 'merged PR has no headRefOid';
      } else if (!ensureCommit(repo, record.headRefOid, { log })) {
        record.problem = `PR head ${shortSha(record.headRefOid)} is not available locally`;
      } else if (!record.mergeCommit) {
        record.reasons.push('merged PR has no mergeCommit');
      } else if (!ensureCommit(repo, record.mergeCommit, { log })) {
        record.reasons.push(
          `merge commit ${shortSha(record.mergeCommit)} is not available locally`,
        );
      } else {
        record.mergeCommitAncestor = isAncestor(repo, record.mergeCommit, baseSha);
        record.treeMatches = treesEqual(repo, record.tip, record.mergeCommit);
      }

      if (!record.problem && record.mergeCommit && record.mergeCommitAncestor === true) {
        const prBase = resolvePrBase(repo, pr.baseRefName, {
          baseRef,
          baseSha,
          remoteHeads,
        });
        if (!prBase) {
          record.problem = `PR base ref '${pr.baseRefName}' cannot be resolved`;
        } else {
          const commits = prCommits(repo, slug, pr.number);
          if (!commits) {
            record.problem = `PR #${pr.number} commit list is unavailable`;
          } else {
            const commitSet = new Set(commits);
            record.prCommitCount = commits.length;
            const branchCommits = git(repo, 'rev-list', `${prBase}..${record.tip}`)
              .split('\n')
              .filter(Boolean);
            record.commitsOutsidePr = branchCommits.filter(
              (commit) => !commitSet.has(commit),
            ).length;
            const after = gitOk(
              repo,
              'rev-list',
              '--count',
              `${record.headRefOid}..${record.tip}`,
            );
            record.commitsAfterHead = after.ok ? Number(after.out) : null;
            if (record.commitsAfterHead == null) {
              record.problem = 'could not count commits after the PR head';
            }
          }
        }
      }
    }

    records.push(annotate(record));
  }

  records.sort((a, b) => a.name.localeCompare(b.name));
  return { records, baseSha, remoteHeads, prs, repoSlug: slug };
}

export function recordFromFixture(raw) {
  if (!raw || typeof raw !== 'object' || !raw.name) {
    throw new Error('fixture branch is missing a name');
  }
  const record = {
    name: raw.name,
    tip: raw.tip ?? null,
    pr: raw.pr ?? null,
    state: raw.state ?? null,
    base: raw.base ?? raw.baseRefName ?? null,
    headRefOid: raw.headRefOid ?? null,
    mergeCommit: raw.mergeCommit ?? null,
    mergedAt: raw.mergedAt ?? null,
    title: raw.title ?? null,
    isDraft: raw.isDraft ?? null,
    prCandidates: raw.prCandidates ?? (raw.pr == null ? [] : [raw.pr]),
    prSelection: raw.prSelection ?? null,
    ahead: raw.ahead ?? null,
    behind: raw.behind ?? null,
    uniqueCommitCount: raw.uniqueCommitCount ?? null,
    equivalentCommitCount: raw.equivalentCommitCount ?? null,
    deltaFiles: raw.deltaFiles ?? null,
    insertions: raw.insertions ?? null,
    deletions: raw.deletions ?? null,
    deltaPaths: raw.deltaPaths ?? [],
    uniquePatchIds: raw.uniquePatchIds ?? [],
    mergeCommitAncestor: raw.mergeCommitAncestor ?? null,
    headAncestor: raw.headAncestor ?? null,
    treeMatches: raw.treeMatches ?? null,
    commitsOutsidePr: raw.commitsOutsidePr ?? null,
    commitsAfterHead: raw.commitsAfterHead ?? null,
    prCommitCount: raw.prCommitCount ?? null,
    problem: raw.problem ?? null,
    reasons: raw.reasons ?? [],
    classification: null,
    expect: raw.expect ?? null,
  };
  return annotate(record);
}

export function isMergedZombie(record) {
  return ZOMBIE_CLASSES.has(record.classification);
}

// A CLOSED_UNMERGED PR is potential orphan work by definition. A NO_PR branch
// is unmerged work only when it actually contains something the base does not:
// unique commits or a non-empty tree diff. A contained NO_PR (0/0) is safe to
// skip. Unknown NO_PR counts are treated as work (fail-closed), never as 0.
export function isUnmergedWork(record) {
  if (record.classification === 'CLOSED_UNMERGED') return true;
  if (record.classification !== 'NO_PR') return false;
  if (record.uniqueCommitCount == null || record.deltaFiles == null) return true;
  return record.uniqueCommitCount > 0 || record.deltaFiles > 0;
}

export function isZombie(record) {
  return isMergedZombie(record) || isUnmergedWork(record);
}

export function isDeletable(record) {
  return DELETABLE_CLASSES.has(record.classification);
}

export function isHardFailure(record) {
  return HARD_FAILURE_CLASSES.has(record.classification);
}

export function summarize(records) {
  const counts = Object.fromEntries(CLASSES.map((name) => [name, 0]));
  for (const record of records) counts[record.classification] = (counts[record.classification] ?? 0) + 1;
  return counts;
}

export function formatTable(records) {
  const header = [
    'CLASS'.padEnd(20),
    'BRANCH'.padEnd(58),
    'PR'.padEnd(5),
    'TIP'.padEnd(8),
    'AHEAD/BEHIND'.padEnd(12),
    'UNIQ'.padEnd(5),
    'TREE'.padEnd(5),
    'OUTSIDE'.padEnd(7),
    'DELTA',
  ].join(' ');
  const lines = [header, '-'.repeat(header.length)];
  for (const record of records) {
    const delta =
      record.deltaFiles == null
        ? '-'
        : `${record.deltaFiles}f +${record.insertions ?? 0} -${record.deletions ?? 0}`;
    lines.push(
      [
        String(record.classification).padEnd(20),
        String(record.name).padEnd(58),
        String(record.pr ? `#${record.pr}` : '-').padEnd(5),
        shortSha(record.tip).padEnd(8),
        `${record.ahead ?? '-'}/${record.behind ?? '-'}`.padEnd(12),
        String(record.uniqueCommitCount ?? '-').padEnd(5),
        String(record.treeMatches == null ? '-' : record.treeMatches ? 'yes' : 'NO').padEnd(5),
        String(record.commitsOutsidePr ?? '-').padEnd(7),
        delta,
      ].join(' '),
    );
  }
  return lines.join('\n');
}

export function formatSummary(records) {
  const counts = summarize(records);
  const total = records.length;
  const parts = CLASSES.filter((name) => counts[name]).map((name) => `${name}=${counts[name]}`);
  const zombies = records.filter(isMergedZombie);
  const unmerged = records.filter(isUnmergedWork);
  const failures = records.filter(isHardFailure);
  return [
    `SUMMARY ${total} branch(es): ${parts.join(' ') || '(none)'}`,
    `ZOMBIES ${zombies.length} (merged but still on origin): ${
      zombies.map((record) => record.name).join(', ') || '(none)'
    }`,
    `UNMERGED WORK ${unmerged.length} (closed PR or NO_PR with unique commits/files): ${
      unmerged.map((record) => `${record.name}(${record.classification})`).join(', ') || '(none)'
    }`,
    `FAILURES ${failures.length}: ${failures
      .map((record) => `${record.name}(${record.classification})`)
      .join(', ') || '(none)'}`,
  ].join('\n');
}

export function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_COLUMNS = [
  'name',
  'classification',
  'pr',
  'state',
  'base',
  'headRefOid',
  'mergeCommit',
  'mergedAt',
  'tip',
  'ahead',
  'behind',
  'uniqueCommitCount',
  'deltaFiles',
  'insertions',
  'deletions',
  'mergeCommitAncestor',
  'treeMatches',
  'commitsOutsidePr',
  'prCommitCount',
  'prCandidates',
  'archivedRef',
  'archivedSha',
  'reasons',
];

export function csvRow(record) {
  return CSV_COLUMNS.map((column) => {
    if (column === 'reasons') return csvEscape((record.reasons ?? []).join(' | '));
    if (column === 'prCandidates') return csvEscape((record.prCandidates ?? []).join(';'));
    return csvEscape(record[column]);
  }).join(',');
}

export function csvReport(records) {
  return [CSV_COLUMNS.join(','), ...records.map(csvRow)].join('\n') + '\n';
}

export function atomicWrite(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, path);
}

export function assertOutsideRepo(repo, path, label) {
  if (!repo) return resolvePath(path);
  const absolute = resolvePath(path);
  const rel = relative(repo, absolute);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(`${label} must be outside the repo (${repo}); got ${absolute}`);
  }
  return absolute;
}
