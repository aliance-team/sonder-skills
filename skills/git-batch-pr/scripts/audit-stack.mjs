#!/usr/bin/env node
/**
 * audit-stack.mjs — classify every remote batch branch against the PR that
 * merged it. Read-only: it never deletes, pushes or rewrites a ref.
 *
 * Classification (fail-closed):
 *   MERGED_CLEAN          MERGED + mergeCommit ancestor of origin/main +
 *                         tip == headRefOid + no commit outside the PR list.
 *                         A tree difference (main advanced before the merge)
 *                         is reported as an advisory reason, not a blocker.
 *   MERGED_POST_COMMITS   MERGED but the tip moved or carries a commit that is
 *                         not in the PR; quantify it, never delete it
 *   MERGED_UNVERIFIED     MERGED but the merge commit is missing or is not an
 *                         ancestor of origin/main
 *   CLOSED_UNMERGED       PR closed without merge; report unique commits/files
 *   OPEN                  PR still open (active work; never a blocker here)
 *   NO_PR                 no PR references the branch; report unique commits
 *                         and files. NO_PR with work is unmerged work.
 *   GONE                  remote branch absent and its merged PR is verified
 *   UNKNOWN               missing PR data, API failure, unresolved ref
 *
 * "Zombie" is reserved for a merged PR whose branch is still alive.
 * CLOSED_UNMERGED and NO_PR with unique commits/files are "unmerged work".
 * OPEN and a contained NO_PR (0 unique commits, 0 changed files) are safe to
 * leave alone. Ahead/behind and `git cherry` are report-only: a squash-merged
 * native stack leaves every layer tip permanently "ahead", and cherry
 * overcounts squash merges. The structural proof above is the only evidence.
 *
 * Usage:
 *   audit-stack.mjs [--base origin/main] [--prefix fastcatalog/]
 *                   [--json PATH] [--csv PATH] [--fail-on-zombies]
 *                   [--allow-existing "written reason"] [--from-json FIXTURE]
 *                   [--dry-run]
 *
 * Exit codes: 0 report produced (unless a hard failure), 1 hard failure or
 * --fail-on-zombies with a merged zombie OR unmerged work, 2 usage. UNKNOWN and
 * MERGED_UNVERIFIED are always exit 1; --allow-existing can only waive
 * MERGED_CLEAN/MERGED_POST_COMMITS and only with a non-empty written reason. It
 * never waives CLOSED_UNMERGED, NO_PR-with-work, MERGED_UNVERIFIED or UNKNOWN.
 */
import { readFileSync } from 'node:fs';
import {
  assertOutsideRepo,
  atomicWrite,
  collectRecords,
  csvReport,
  formatSummary,
  formatTable,
  isHardFailure,
  isMergedZombie,
  isUnmergedWork,
  isZombie,
  recordFromFixture,
  repoRoot,
  shortSha,
  summarize,
} from './lib/stack-audit.mjs';

function usage() {
  const doc = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0];
  console.error(doc.replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
}

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--base', '--prefix', '--json', '--csv', '--from-json']);
const BOOL_FLAGS = new Set(['--fail-on-zombies', '--dry-run']);
const OPTION_KEYS = {
  '--base': 'base',
  '--prefix': 'prefix',
  '--json': 'json',
  '--csv': 'csv',
  '--from-json': 'fromJson',
  '--fail-on-zombies': 'failOnZombies',
  '--dry-run': 'dryRun',
};

const options = {
  base: 'origin/main',
  prefix: 'fastcatalog/',
  json: null,
  csv: null,
  fromJson: null,
  failOnZombies: false,
  dryRun: false,
  allowExisting: null,
};

for (let index = 0; index < argv.length; index += 1) {
  const argument = argv[index];
  if (argument === '--help' || argument === '-h') {
    const doc = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0];
    console.log(doc.replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    process.exit(0);
  }
  if (argument === '--allow-existing' || argument.startsWith('--allow-existing=')) {
    const value = argument.includes('=')
      ? argument.slice(argument.indexOf('=') + 1)
      : argv[++index];
    if (!value || value.startsWith('--')) {
      console.error('FAIL  --allow-existing requires a written reason');
      process.exit(2);
    }
    options.allowExisting = value.trim();
    if (!options.allowExisting) {
      console.error('FAIL  --allow-existing requires a non-empty written reason');
      process.exit(2);
    }
    continue;
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

const cwdRepo = (() => {
  try {
    return repoRoot();
  } catch {
    return null;
  }
})();

let records = [];
let base = options.base;
let baseSha = null;
let repoLabel = null;
let prefix = options.prefix;
let fixtureMismatches = [];

if (options.fromJson) {
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(options.fromJson, 'utf8'));
  } catch (error) {
    fail(`cannot read fixture ${options.fromJson}: ${error.message}`);
  }
  if (fixture.schema !== 'batch-pr-flow/audit-stack-fixture@1') {
    fail(`fixture schema must be batch-pr-flow/audit-stack-fixture@1`);
  }
  if (!Array.isArray(fixture.branches)) fail('fixture is missing a branches array');
  records = fixture.branches.map(recordFromFixture);
  base = fixture.base ?? options.base;
  baseSha = fixture.baseSha ?? null;
  repoLabel = fixture.repo ?? null;
  prefix = fixture.prefix ?? options.prefix;
  fixtureMismatches = records.filter(
    (record) => record.expect && record.expect !== record.classification,
  );
} else {
  const repo = cwdRepo;
  if (!repo) fail('not inside a git repository');
  let collected;
  try {
    collected = collectRecords({
      repo,
      baseRef: options.base,
      prefix: options.prefix,
      log: (message) => console.error(`      ${message}`),
    });
  } catch (error) {
    fail(error.message);
  }
  records = collected.records;
  baseSha = collected.baseSha;
  repoLabel = collected.repoSlug;
  prefix = options.prefix;
}

const counts = summarize(records);
const blocking = records.filter(isZombie);
const mergedZombies = records.filter(isMergedZombie);
const unmergedWork = records.filter(isUnmergedWork);
const failures = records.filter(isHardFailure);
const allowSuppresses = Boolean(options.allowExisting);
const waivable = new Set(['MERGED_CLEAN', 'MERGED_POST_COMMITS']);
const unwaivable = blocking.filter((record) => !waivable.has(record.classification));

let exitCode = 0;
if (failures.length || fixtureMismatches.length) exitCode = 1;
if (options.failOnZombies && blocking.length) {
  if (!allowSuppresses || unwaivable.length) exitCode = 1;
}

const report = {
  schema: 'batch-pr-flow/audit-stack@1',
  generatedAt: new Date().toISOString(),
  repo: repoLabel,
  base,
  baseSha,
  prefix,
  allowExisting: options.allowExisting,
  counts,
  zombies: mergedZombies.map((record) => record.name),
  unmergedWork: unmergedWork.map((record) => ({
    name: record.name,
    classification: record.classification,
    uniqueCommitCount: record.uniqueCommitCount,
    deltaFiles: record.deltaFiles,
  })),
  blocking: blocking.map((record) => ({
    name: record.name,
    classification: record.classification,
  })),
  failures: failures.map((record) => ({ name: record.name, classification: record.classification })),
  fixtureMismatches: fixtureMismatches.map((record) => ({
    name: record.name,
    expect: record.expect,
    actual: record.classification,
  })),
  branches: records,
};

console.log(
  `AUDIT ${repoLabel ?? '(fixture)'}  base ${base}@${shortSha(baseSha)}  prefix ${prefix}`,
);
console.log(formatTable(records));
console.log(formatSummary(records));

if (options.allowExisting) {
  console.log(
    `ALLOW-EXISTING ${options.allowExisting}${
      options.failOnZombies ? '' : ' (no effect without --fail-on-zombies)'
    }`,
  );
}
if (fixtureMismatches.length) {
  for (const record of fixtureMismatches) {
    console.log(`FIXTURE-MISMATCH ${record.name}: expected ${record.expect}, got ${record.classification}`);
  }
}
if (options.failOnZombies) {
  if (!blocking.length) {
    console.log('PREFLIGHT: PASS — no merged zombies or unmerged work');
  } else if (exitCode === 0) {
    console.log(
      `PREFLIGHT: PASS (allow-existing) — ${mergedZombies.length} merged zombie branch(es) accepted with reason: ${options.allowExisting}`,
    );
  } else if (unwaivable.length) {
    console.log(
      `PREFLIGHT: FAIL — ${unwaivable.length} branch(es) are unmerged work or MERGED_UNVERIFIED and cannot be waived: ${unwaivable
        .map((record) => `${record.name}(${record.classification})`)
        .join(', ')}`,
    );
  } else {
    console.log(
      `PREFLIGHT: FAIL — ${blocking.length} merged zombie branch(es) still exist; finalize or pass --allow-existing with a written reason`,
    );
  }
}
if (failures.length) {
  console.log(
    `FAILURES: ${failures
      .map((record) => `${record.name}(${record.classification})`)
      .join(', ')}`,
  );
}

const jsonPath = options.json;
const csvPath = options.csv;
if (jsonPath) {
  try {
    assertOutsideRepo(cwdRepo, jsonPath, '--json');
  } catch (error) {
    fail(error.message);
  }
  if (options.dryRun) {
    console.log(`dry-run: would write JSON ${jsonPath}`);
  } else {
    atomicWrite(jsonPath, JSON.stringify(report, null, 2) + '\n');
    console.log(`wrote ${jsonPath}`);
  }
}
if (csvPath) {
  try {
    assertOutsideRepo(cwdRepo, csvPath, '--csv');
  } catch (error) {
    fail(error.message);
  }
  if (options.dryRun) {
    console.log(`dry-run: would write CSV ${csvPath}`);
  } else {
    atomicWrite(csvPath, csvReport(records));
    console.log(`wrote ${csvPath}`);
  }
}

console.log(exitCode === 0 ? 'AUDIT: PASS' : 'AUDIT: FAIL');
process.exit(exitCode);
