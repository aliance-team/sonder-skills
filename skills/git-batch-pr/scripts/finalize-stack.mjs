#!/usr/bin/env node
/**
 * finalize-stack.mjs — archive a batch stack's branches, then delete only the
 * remote refs that are proven content-merged.
 *
 * It re-runs the same classification as audit-stack.mjs and archives every
 * selected tip to refs/archive/<UTC-date>/<branch>, creates and verifies a
 * git bundle containing only those archive refs, and writes JSON+CSV outside
 * the repo. A GONE branch is archived from its PR head when the branch ref no
 * longer exists. Remote deletion is opt-in twice: --delete-remote and
 * --confirm-delete. The default is a dry run that still archives locally.
 *
 * Two selection modes:
 *   --branches FILE   the layer<TAB>branch list of one stack (bottom -> top)
 *   --all-clean       discover every remote branch under --prefix, select only
 *                     MERGED_CLEAN/GONE, and block on merged zombies
 *                     (MERGED_POST_COMMITS, MERGED_UNVERIFIED), unmerged work
 *                     (CLOSED_UNMERGED, NO_PR with unique commits/files) and
 *                     UNKNOWN. OPEN and a contained NO_PR (0 unique commits,
 *                     0 changed files) are reported but not selected.
 *
 * In --branches mode every requested branch that is not MERGED_CLEAN/GONE
 * blocks. A branch is deletable only when classification is MERGED_CLEAN or
 * GONE. A mergeCommit is proven against origin/main, never against the PR
 * baseRefName: native `gh stack merge --squash` flattens the whole stack onto
 * main while the layer refs keep their pre-squash tips.
 *
 * Deletion re-reads the live tip and pushes with
 *   git push origin --force-with-lease=refs/heads/<branch>:<tip> --delete <branch>
 * so a branch that moves during finalization is rejected and survives.
 *
 * Archive durability: with --delete-remote the archive dir must be outside the
 * repo and outside /tmp. The default is
 *   $HOME/.local/share/batch-pr-flow-archives/<UTC>
 * A /tmp archive needs --allow-ephemeral-archive. Dry runs may use /tmp.
 *
 * Usage:
 *   finalize-stack.mjs --branches branches.tsv [options]
 *   finalize-stack.mjs --all-clean [options]
 *
 *   --state FILE
 *   --archive-dir DIR
 *   --allow-ephemeral-archive     allow a /tmp archive with --delete-remote
 *   --prefix PREFIX               default fastcatalog/
 *   --base REF                    default origin/main (or state.base.ref)
 *   --delete-remote --confirm-delete
 *   --dry-run
 *
 * Exit codes: 0 archived (and deleted when requested), 1 blocked or a git
 * command failed, 2 usage. Without both delete flags it never deletes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path';
import {
  assertOutsideRepo,
  atomicWrite,
  collectRecords,
  csvReport,
  ensureCommit,
  formatTable,
  gitOk,
  isDeletable,
  isZombie,
  repoRoot,
  shortSha,
} from './lib/stack-audit.mjs';

const DURABLE_ARCHIVE_ROOT = join(homedir(), '.local/share/batch-pr-flow-archives');

function usage() {
  const doc = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0];
  console.error(doc.replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
}

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

function utcStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function isInside(root, target) {
  const rel = relative(resolvePath(root), resolvePath(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--branches', '--state', '--archive-dir', '--prefix', '--base']);
const BOOL_FLAGS = new Set([
  '--all-clean',
  '--allow-ephemeral-archive',
  '--delete-remote',
  '--confirm-delete',
  '--dry-run',
]);
const OPTION_KEYS = {
  '--branches': 'branches',
  '--state': 'state',
  '--archive-dir': 'archiveDir',
  '--prefix': 'prefix',
  '--base': 'base',
  '--all-clean': 'allClean',
  '--allow-ephemeral-archive': 'allowEphemeralArchive',
  '--delete-remote': 'deleteRemote',
  '--confirm-delete': 'confirmDelete',
  '--dry-run': 'dryRun',
};

const options = {
  branches: null,
  allClean: false,
  state: null,
  archiveDir: null,
  allowEphemeralArchive: false,
  prefix: 'fastcatalog/',
  base: null,
  deleteRemote: false,
  confirmDelete: false,
  dryRun: false,
};

for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index];
  if (argument === '--help' || argument === '-h') {
    const doc = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0];
    console.log(doc.replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    process.exit(0);
  }
  if (argument.includes('=') && VALUE_FLAGS.has(argument.split('=')[0])) {
    const [name, ...rest] = argument.split('=');
    options[OPTION_KEYS[name]] = rest.join('=');
    continue;
  }
  if (VALUE_FLAGS.has(argument)) {
    const value = argv[++index];
    if (!value || value.startsWith('--')) {
      console.error(`FAIL  ${argument} requires a value`);
      process.exit(2);
    }
    options[OPTION_KEYS[argument]] = value;
    continue;
  }
  if (BOOL_FLAGS.has(argument)) {
    options[OPTION_KEYS[argument]] = true;
    continue;
  }
  console.error(`unknown argument: ${argument}`);
  process.exit(2);
}

if (!options.branches && !options.allClean) {
  usage();
  process.exit(2);
}
if (options.branches && options.allClean) {
  console.error('FAIL  use either --branches or --all-clean, not both');
  process.exit(2);
}
if (options.deleteRemote && !options.confirmDelete) {
  console.error('FAIL  --delete-remote also requires --confirm-delete (remote deletion is opt-in twice)');
  process.exit(2);
}
if (options.confirmDelete && !options.deleteRemote) {
  console.error('FAIL  --confirm-delete requires --delete-remote');
  process.exit(2);
}

const deleteRequested = options.deleteRemote && options.confirmDelete;
const dryRun = options.dryRun || !deleteRequested;
const deletionMode = deleteRequested && !options.dryRun;
if (deleteRequested && options.dryRun) {
  console.error('WARN  --dry-run wins; no remote deletion will happen');
}
if (!options.prefix) {
  console.error('FAIL  --prefix cannot be empty');
  process.exit(2);
}

const repo = (() => {
  try {
    return repoRoot();
  } catch {
    fail('not inside a git repository');
  }
})();

const runStamp = utcStamp();
const archiveDate = utcDate();
const defaultArchiveDir = deletionMode
  ? join(DURABLE_ARCHIVE_ROOT, runStamp)
  : `/tmp/opencode/batch-pr-flow-archive-${runStamp}`;
let archiveDir;
try {
  archiveDir = assertOutsideRepo(repo, options.archiveDir ?? defaultArchiveDir, '--archive-dir');
} catch (error) {
  fail(error.message);
}
const ephemeralArchive = isInside('/tmp', archiveDir);
if (deletionMode && ephemeralArchive && !options.allowEphemeralArchive) {
  console.error('FAIL  --delete-remote requires an archive dir outside /tmp');
  console.error(`      durable: --archive-dir "${join(DURABLE_ARCHIVE_ROOT, runStamp)}"`);
  console.error('      or:      --allow-ephemeral-archive (explicitly non-durable)');
  process.exit(2);
}
mkdirSync(archiveDir, { recursive: true });

let state = null;
if (options.state) {
  if (!existsSync(options.state)) fail(`state file not found: ${options.state}`);
  try {
    state = JSON.parse(readFileSync(options.state, 'utf8'));
  } catch (error) {
    fail(`cannot parse state ${options.state}: ${error.message}`);
  }
  if (!Array.isArray(state.layers)) fail(`state ${options.state} has no layers array`);
}
const baseRef = options.base ?? state?.base?.ref ?? 'origin/main';

let rows = [];
let requestedBranches = null;
if (options.branches) {
  for (const raw of readFileSync(options.branches, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    const [layerRaw, ...rest] = line.split('\t');
    const layer = layerRaw.trim();
    const branch = rest.join('\t').trim();
    if (!branch) fail(`malformed branches line: ${line}`);
    if (!/^\d{1,2}$/.test(layer)) fail(`bad layer "${layerRaw}" for ${branch}`);
    if (!branch.startsWith(options.prefix)) {
      fail(`branch '${branch}' does not start with --prefix '${options.prefix}'`);
    }
    rows.push({ layer: layer.padStart(2, '0'), branch });
  }
  if (!rows.length) fail(`no branches in ${options.branches}`);
  const seenLayers = new Set();
  const seenBranches = new Set();
  let previous = 0;
  for (const row of rows) {
    const numeric = Number(row.layer);
    if (seenLayers.has(row.layer)) fail(`duplicate layer ${row.layer}`);
    if (seenBranches.has(row.branch)) fail(`duplicate branch ${row.branch}`);
    if (numeric <= previous) {
      fail(`branches must be strictly bottom-to-top (${row.layer} after ${previous})`);
    }
    previous = numeric;
    seenLayers.add(row.layer);
    seenBranches.add(row.branch);
  }
  requestedBranches = rows.map((row) => row.branch);
}

let collected;
try {
  collected = collectRecords({
    repo,
    baseRef,
    prefix: options.prefix,
    branchNames: options.allClean ? null : requestedBranches,
    log: (message) => console.error(`      ${message}`),
  });
} catch (error) {
  fail(error.message);
}

const recordByBranch = new Map(collected.records.map((record) => [record.name, record]));
let reportBranches = collected.records;
let skipped = [];

if (options.allClean) {
  const selected = collected.records.filter(isDeletable);
  rows = selected.map((record, index) => ({
    layer: String(index + 1).padStart(2, '0'),
    branch: record.name,
    record,
  }));
  skipped = collected.records
    .filter(
      (record) =>
        !isDeletable(record) && !isZombie(record) && record.classification !== 'UNKNOWN',
    )
    .map((record) => ({
      name: record.name,
      classification: record.classification,
      reason:
        record.classification === 'OPEN'
          ? 'open PR (active work)'
          : record.classification === 'NO_PR'
            ? 'NO_PR with 0 unique commits and 0 changed files'
            : 'not blocking',
    }));
  reportBranches = collected.records;
}

const ordered = rows.map((row) => ({ ...row, record: row.record ?? recordByBranch.get(row.branch) }));

const blockers = [];
const blockerIndex = new Map();
function blockerKind(classification) {
  if (['MERGED_CLEAN', 'MERGED_POST_COMMITS', 'MERGED_UNVERIFIED'].includes(classification)) {
    return 'ZOMBIE';
  }
  if (classification === 'CLOSED_UNMERGED' || classification === 'NO_PR') {
    return 'UNMERGED WORK';
  }
  return 'BLOCKER';
}
function addBlocker(branch, classification, reason) {
  const existing = blockerIndex.get(branch);
  if (existing) {
    if (!existing.reason.includes(reason)) existing.reason += `; ${reason}`;
    return;
  }
  const entry = { branch, classification, kind: blockerKind(classification), reason };
  blockerIndex.set(branch, entry);
  blockers.push(entry);
}
function recordReason(record) {
  const base = (record.reasons ?? []).join('; ') || 'not proven content-merged';
  if (record.classification === 'NO_PR') {
    return `${base}; ${record.uniqueCommitCount ?? '?'} unique commit(s), ${
      record.deltaFiles ?? '?'
    } file(s) differ from base`;
  }
  return base;
}

if (options.allClean) {
  for (const record of collected.records) {
    if (isDeletable(record)) continue;
    if (isZombie(record) || record.classification === 'UNKNOWN') {
      addBlocker(
        record.name,
        record.classification ?? 'UNKNOWN',
        recordReason(record),
      );
    }
  }
} else {
  for (const row of ordered) {
    if (!row.record) {
      addBlocker(row.branch, 'UNKNOWN', 'no classification record');
      continue;
    }
    if (!isDeletable(row.record)) {
      addBlocker(
        row.branch,
        row.record.classification,
        recordReason(row.record),
      );
    }
  }
}

if (state) {
  const stateByBranch = new Map(
    state.layers.filter((layer) => layer.branch).map((layer) => [layer.branch, layer]),
  );
  for (const row of ordered) {
    const layer = stateByBranch.get(row.branch);
    if (!layer) {
      addBlocker(row.branch, 'UNKNOWN', 'state has no layer for this branch');
      continue;
    }
    if (row.record.pr == null) {
      addBlocker(
        row.branch,
        row.record.classification,
        'state cross-check needs a resolved PR number',
      );
    } else if (String(layer.pr ?? '') !== String(row.record.pr)) {
      addBlocker(
        row.branch,
        'UNKNOWN',
        `state PR #${layer.pr} != resolved PR #${row.record.pr}`,
      );
    }
  }
}

const archiveFailures = [];
for (const row of ordered) {
  const record = row.record;
  if (!record) continue;
  const sha = record.tip ?? (record.classification === 'GONE' ? record.headRefOid : null);
  if (!sha) {
    archiveFailures.push({ branch: row.branch, reason: 'no branch tip and no PR head to archive' });
    continue;
  }
  if (
    !ensureCommit(repo, sha, {
      branch: record.tip ? row.branch : null,
      log: (message) => console.error(`      ${message}`),
    })
  ) {
    archiveFailures.push({
      branch: row.branch,
      reason: `object ${shortSha(sha)} is not available locally; cannot archive`,
    });
    continue;
  }
  const ref = `refs/archive/${archiveDate}/${row.branch}`;
  const existing = gitOk(repo, 'rev-parse', '--verify', '--quiet', ref);
  if (existing.ok && existing.out !== sha) {
    archiveFailures.push({
      branch: row.branch,
      reason: `archive ref ${ref} already points to ${shortSha(existing.out)}, not ${shortSha(sha)}`,
    });
    continue;
  }
  try {
    execFileSync('git', ['update-ref', ref, sha], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    record.archivedRef = ref;
    record.archivedSha = sha;
    record.archivedFrom = record.tip ? 'tip' : 'pr-head';
  } catch (error) {
    archiveFailures.push({
      branch: row.branch,
      reason: `git update-ref ${ref} failed: ${String(error.stderr ?? error.message).trim()}`,
    });
  }
}

for (const failure of archiveFailures) {
  addBlocker(
    failure.branch,
    recordByBranch.get(failure.branch)?.classification ?? 'UNKNOWN',
    failure.reason,
  );
}

const archiveRefs = ordered.map((row) => row.record?.archivedRef).filter(Boolean);
let bundle = null;
let bundleVerified = false;
let bundleRefs = [];
let bundleVerifyOutput = '';
const bundleStamp = runStamp;
if (archiveRefs.length) {
  const bundlePath = join(archiveDir, `stack-${bundleStamp}-${process.pid}.bundle`);
  const tempPath = join(archiveDir, `.stack-${bundleStamp}.${process.pid}.tmp`);
  try {
    execFileSync('git', ['bundle', 'create', tempPath, ...archiveRefs], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    bundleVerifyOutput = execFileSync('git', ['bundle', 'verify', tempPath], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const heads = execFileSync('git', ['bundle', 'list-heads', tempPath], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, ref] = line.split(/\s+/);
        return { sha, ref };
      });
    bundleRefs = heads;
    for (const row of ordered) {
      const record = row.record;
      if (!record?.archivedRef) continue;
      const found = heads.find((head) => head.ref === record.archivedRef);
      if (!found) throw new Error(`bundle is missing ${record.archivedRef}`);
      if (found.sha !== record.archivedSha) {
        throw new Error(
          `bundle has ${record.archivedRef} at ${shortSha(found.sha)}, expected ${shortSha(
            record.archivedSha,
          )}`,
        );
      }
    }
    renameSync(tempPath, bundlePath);
    bundle = bundlePath;
    bundleVerified = true;
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // best effort
    }
    const reason = `git bundle create/verify failed: ${String(
      error.stderr ?? error.message,
    ).trim()}`;
    archiveFailures.push({ branch: '(bundle)', reason });
    addBlocker('(bundle)', 'UNKNOWN', reason);
  }
} else if (!(options.allClean && ordered.length === 0)) {
  const reason =
    'no archive refs were created; refusing to continue without a provenance bundle';
  archiveFailures.push({ branch: '(bundle)', reason });
  addBlocker('(bundle)', 'UNKNOWN', reason);
}

const report = {
  schema: 'batch-pr-flow/finalize-stack@1',
  generatedAt: new Date().toISOString(),
  repo: collected.repoSlug,
  base: baseRef,
  baseSha: collected.baseSha,
  selection: options.allClean ? 'all-clean' : 'branches',
  archiveDir,
  archiveDate,
  archiveLifetime: ephemeralArchive ? 'ephemeral:/tmp' : 'durable',
  allowEphemeralArchive: options.allowEphemeralArchive,
  bundleStamp,
  mode: dryRun ? 'dry-run' : 'delete',
  bundle,
  bundleVerified,
  bundleRefs,
  bundleVerifyOutput,
  selectedBranches: ordered.map((row) => row.branch),
  skipped,
  blockers,
  archiveFailures,
  deletions: [],
  result: blockers.length ? 'blocked' : dryRun ? 'archived-dry-run' : 'deleting',
  branches: reportBranches,
};

function writeReports() {
  atomicWrite(
    join(archiveDir, 'finalize-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  atomicWrite(join(archiveDir, 'finalize-report.csv'), csvReport(report.branches));
}

console.log(
  `FINALIZE ${collected.repoSlug}  base ${baseRef}@${shortSha(collected.baseSha)}  archive ${archiveDir}`,
);
console.log(
  `MODE ${dryRun ? 'dry-run (no remote deletion)' : 'delete remote refs'}  selection ${
    options.allClean ? 'all-clean' : 'branches'
  }  date ${archiveDate}`,
);
console.log(
  `ARCHIVE ${ephemeralArchive ? 'ephemeral:/tmp' : 'durable'}  selected ${ordered.length}  skipped ${
    skipped.length
  }`,
);
console.log(formatTable(report.branches));
console.log(
  `BUNDLE ${bundle ?? '(none)'} ${bundleVerified ? `verified (${bundleRefs.length} refs)` : 'NOT VERIFIED'}`,
);
if (skipped.length) {
  console.log(
    `SKIPPED (not blocking): ${skipped
      .map((record) => `${record.name} (${record.classification}: ${record.reason})`)
      .join(', ')}`,
  );
}
if (blockers.length) {
  console.log(`BLOCKERS ${blockers.length}:`);
  for (const blocker of blockers) {
    console.log(
      `  ${blocker.branch}  ${blocker.classification}  ${blocker.kind}: ${blocker.reason}`,
    );
  }
}

if (options.allClean && ordered.length === 0 && blockers.length === 0) {
  report.result = 'nothing-to-finalize';
  writeReports();
  console.log('');
  console.log(`wrote ${join(archiveDir, 'finalize-report.json')}`);
  console.log(`wrote ${join(archiveDir, 'finalize-report.csv')}`);
  console.log('FINALIZE: PASS — no MERGED_CLEAN/GONE branches under the prefix');
  process.exit(0);
}

const pending = ordered
  .filter((row) => row.record?.classification === 'MERGED_CLEAN')
  .map((row) => row.branch);
const alreadyGone = ordered
  .filter((row) => row.record?.classification === 'GONE')
  .map((row) => row.branch);

if (blockers.length) {
  report.result = 'blocked';
  writeReports();
  console.log(`wrote ${join(archiveDir, 'finalize-report.json')}`);
  console.log(`wrote ${join(archiveDir, 'finalize-report.csv')}`);
  console.log('FINALIZE: FAIL — no remote deletion attempted');
  process.exit(1);
}

console.log('');
console.log(
  dryRun
    ? '# Pending remote deletions (NOT executed in dry-run):'
    : '# Remote deletions (executing now):',
);
for (const branch of pending) {
  const record = recordByBranch.get(branch);
  console.log(
    `git push origin --force-with-lease=refs/heads/${branch}:${record.tip} --delete ${branch}`,
  );
}
for (const branch of alreadyGone) console.log(`# already gone: ${branch}`);

if (dryRun) {
  report.result = 'archived-dry-run';
  writeReports();
  console.log('');
  console.log(`wrote ${join(archiveDir, 'finalize-report.json')}`);
  console.log(`wrote ${join(archiveDir, 'finalize-report.csv')}`);
  console.log('FINALIZE: PASS (dry-run; archive created, remote untouched)');
  process.exit(0);
}

let deletionFailure = null;
for (const branch of pending) {
  const live = gitOk(repo, 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`);
  if (!live.ok) {
    deletionFailure = `git ls-remote failed for ${branch}: ${live.err}`;
    break;
  }
  if (!live.out) {
    report.deletions.push({
      branch,
      status: 'already-gone',
      verifiedGone: true,
      error: null,
    });
    continue;
  }
  const liveSha = live.out.split(/\s+/)[0];
  const record = recordByBranch.get(branch);
  if (liveSha !== record.tip) {
    deletionFailure = `${branch} moved on the remote (${shortSha(record.tip)} -> ${shortSha(
      liveSha,
    )}); refusing to delete it`;
    break;
  }
  const lease = `--force-with-lease=refs/heads/${branch}:${record.tip}`;
  try {
    execFileSync('git', ['push', 'origin', lease, '--delete', branch], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    report.deletions.push({ branch, status: 'deleted', verifiedGone: false, error: null });
  } catch (error) {
    deletionFailure = `git push origin ${lease} --delete ${branch} failed: ${String(
      error.stderr ?? error.message,
    ).trim()}`;
    report.deletions.push({
      branch,
      status: 'failed',
      verifiedGone: false,
      error: deletionFailure,
    });
    break;
  }
}

const survivors = [];
for (const branch of pending) {
  const live = gitOk(repo, 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`);
  if (!live.ok) {
    survivors.push(`${branch} (ls-remote failed: ${live.err})`);
  } else if (live.out) {
    survivors.push(branch);
  }
}
for (const entry of report.deletions) {
  if (entry.status === 'deleted' || entry.status === 'already-gone') {
    entry.verifiedGone = !survivors.includes(entry.branch);
  }
}

if (deletionFailure || survivors.length) {
  report.result = 'failed';
  writeReports();
  if (deletionFailure) console.error(`FAIL  ${deletionFailure}`);
  if (survivors.length) {
    console.error(`FAIL  ${survivors.length} remote branch(es) survived:`);
    for (const survivor of survivors) console.error(`  ${survivor}`);
  }
  console.log(`wrote ${join(archiveDir, 'finalize-report.json')}`);
  console.log(`wrote ${join(archiveDir, 'finalize-report.csv')}`);
  console.log('FINALIZE: FAIL — archive is safe, deletion is incomplete');
  process.exit(1);
}

report.result = 'deleted';
writeReports();
console.log('');
console.log(`wrote ${join(archiveDir, 'finalize-report.json')}`);
console.log(`wrote ${join(archiveDir, 'finalize-report.csv')}`);
console.log(`FINALIZE: PASS — ${pending.length} remote branch(es) deleted and verified gone`);
console.log(
  `next: node <skill>/scripts/state.mjs finalize --archive-dir ${archiveDir}  (after recording each merge-result)`,
);
process.exit(0);
