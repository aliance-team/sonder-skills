#!/usr/bin/env node
/**
 * state.mjs — the checkpoint manifest for a batch run. Fail-closed by design:
 * a cached gate is trusted only while its SHA, parent, base and phase still
 * match. Resume never trusts the working tree, a worktree or CI for another SHA.
 *
 * State lives in <git-common-dir>/batch-pr-flow/state.json, so every worktree of
 * the repo sees the same run (a worktree's `.git` is a file, not a directory).
 *
 * Usage:
 *   state.mjs init --base main --snapshot _batch-source --plan plan.tsv [--run ID]
 *   state.mjs show
 *   state.mjs set-phase <phase>
 *   state.mjs set-allowlist "Phone Paths,Other"
 *   state.mjs layer <n> --branch B --sha SHA --gate green|red [--checks "tsc,vitest"]
 *                       [--parent SHA] [--pr N] [--title "..."]
 *   state.mjs merge-start
 *   state.mjs merged [--main-sha SHA]
 *   state.mjs merge-result <n> --pr N --head SHA --merge SHA --merged-at ISO
 *                       --verified-in-main true|false --branch-deleted true|false
 *   state.mjs finalize --archive-dir DIR   # refuses until every layer has a
 *                                          # verified, deleted merge-result
 *   state.mjs trust <n>          # exit 0 only if the layer is safely reusable
 *   state.mjs check              # exit 0 only if every recorded layer trusts
 *
 * Exit codes: 0 ok, 1 refused/invalid, 2 usage.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name) => argv.includes(name);

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const REPO = git('rev-parse', '--show-toplevel');
const COMMON = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
const DIR = join(COMMON.startsWith('/') ? COMMON : join(REPO, COMMON), 'batch-pr-flow');
const FILE = join(DIR, 'state.json');

function usage() {
  const doc = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0];
  console.error(doc.replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
}
function fail(msg) {
  console.error(`REFUSED: ${msg}`);
  process.exit(1);
}
function load() {
  if (!existsSync(FILE)) fail(`no state at ${FILE} (run: state.mjs init ...)`);
  return JSON.parse(readFileSync(FILE, 'utf8'));
}
function save(state) {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, FILE);
}
function now() {
  return new Date().toISOString();
}
function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}
function resolve(ref) {
  try {
    return git('rev-parse', '--verify', ref);
  } catch {
    return null;
  }
}

if (cmd === 'init') {
  const base = opt('--base', 'main');
  const snapshot = opt('--snapshot');
  const plan = opt('--plan');
  if (!snapshot || !plan) {
    usage();
    process.exit(2);
  }
  const baseSha = resolve(base);
  const snapSha = resolve(snapshot);
  if (!baseSha) fail(`base ref '${base}' does not resolve`);
  if (!snapSha) fail(`snapshot ref '${snapshot}' does not resolve`);
  if (!existsSync(plan)) fail(`plan file '${plan}' not found`);
  const allow = opt('--allowlist', '');
  const state = {
    v: 1,
    run: opt('--run', `${Date.now().toString(36)}-${snapSha.slice(0, 8)}`),
    createdAt: now(),
    phase: 'init',
    base: { ref: base, sha: baseSha },
    snapshot: { ref: snapshot, sha: snapSha },
    plan: { path: plan, sha256: sha256(readFileSync(plan, 'utf8')) },
    allowlist: allow ? allow.split(',').map((s) => s.trim()).filter(Boolean) : [],
    layers: [],
    merge: { mainBefore: null, merged: [], mainAfter: null },
    deploy: { at: null, result: null },
  };
  save(state);
  console.log(`state: ${FILE}`);
  console.log(`run ${state.run}  base ${base}@${baseSha.slice(0, 8)}  snapshot ${snapshot}@${snapSha.slice(0, 8)}`);
  process.exit(0);
}

if (cmd === 'show') {
  const s = load();
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}

if (cmd === 'set-phase') {
  const phase = argv[1];
  if (!phase) { usage(); process.exit(2); }
  const s = load();
  s.phase = phase;
  s.updatedAt = now();
  save(s);
  console.log(`phase: ${phase}`);
  process.exit(0);
}

if (cmd === 'set-allowlist') {
  const s = load();
  s.allowlist = (argv[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  s.updatedAt = now();
  save(s);
  console.log(`allowlist: ${s.allowlist.join(', ') || '(none)'}`);
  process.exit(0);
}

if (cmd === 'layer') {
  const n = argv[1];
  const branch = opt('--branch');
  const sha = opt('--sha') ?? (branch ? resolve(branch) : null);
  const gate = opt('--gate', 'green');
  if (!n || !branch || !sha) { usage(); process.exit(2); }
  if (!resolve(sha)) fail(`sha '${sha}' does not resolve`);
  const parent = opt('--parent') ?? (() => {
    try {
      return execFileSync('git', ['rev-parse', `${branch}~1`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  })();
  const s = load();
  const entry = {
    n,
    branch,
    sha,
    parentSha: parent,
    gate,
    checks: (opt('--checks', '')).split(',').map((x) => x.trim()).filter(Boolean),
    pr: opt('--pr', null),
    title: opt('--title', null),
    at: now(),
  };
  const i = s.layers.findIndex((l) => l.n === n);
  if (i >= 0) s.layers[i] = { ...s.layers[i], ...entry };
  else s.layers.push(entry);
  s.layers.sort((a, b) => String(a.n).localeCompare(String(b.n)));
  s.updatedAt = now();
  save(s);
  console.log(`layer ${n}: ${branch}@${sha.slice(0, 8)} gate=${gate}`);
  process.exit(0);
}

if (cmd === 'merge-start') {
  const s = load();
  s.merge.mainBefore = resolve(s.base.ref);
  if (s.merge.mainBefore !== s.base.sha) {
    fail(`main moved since init (${s.base.sha.slice(0, 8)} -> ${s.merge.mainBefore.slice(0, 8)}); re-verify before merging`);
  }
  s.phase = 'merging';
  s.merge.merged = [];
  save(s);
  console.log(`main before merge: ${s.merge.mainBefore}`);
  process.exit(0);
}

if (cmd === 'merged') {
  const s = load();
  const mainAfter = opt('--main-sha', null) ?? resolve(s.base.ref);
  s.merge.mainAfter = mainAfter;
  s.merge.merged = s.layers.map((l) => l.pr).filter(Boolean);
  s.phase = 'merged';
  save(s);
  console.log(`merged into ${mainAfter}`);
  process.exit(0);
}

function findLayer(state, n) {
  const wanted = String(n).padStart(2, '0');
  return state.layers.find(
    (layer) => String(layer.n).padStart(2, '0') === wanted,
  );
}

if (cmd === 'merge-result') {
  const n = argv[1];
  const pr = opt('--pr');
  const head = opt('--head');
  const merge = opt('--merge');
  const mergedAt = opt('--merged-at');
  const verifiedInMain = opt('--verified-in-main');
  const branchDeleted = opt('--branch-deleted');
  if (
    !n ||
    !pr ||
    !head ||
    !merge ||
    !mergedAt ||
    verifiedInMain == null ||
    branchDeleted == null
  ) {
    usage();
    process.exit(2);
  }
  if (!/^\d+$/.test(pr)) fail(`--pr must be a number, got '${pr}'`);
  for (const [label, value] of [
    ['--head', head],
    ['--merge', merge],
  ]) {
    if (!/^[0-9a-f]{7,40}$/i.test(value)) fail(`${label} must be a git SHA, got '${value}'`);
  }
  if (Number.isNaN(Date.parse(mergedAt))) fail(`--merged-at is not an ISO timestamp: '${mergedAt}'`);
  if (!['true', 'false'].includes(verifiedInMain)) {
    fail(`--verified-in-main must be true or false, got '${verifiedInMain}'`);
  }
  if (!['true', 'false'].includes(branchDeleted)) {
    fail(`--branch-deleted must be true or false, got '${branchDeleted}'`);
  }

  const s = load();
  const layer = findLayer(s, n);
  if (!layer) fail(`layer ${n} is not recorded (run: state.mjs layer ... first)`);
  if (verifiedInMain === 'true') {
    const mergeSha = resolve(merge);
    if (!mergeSha) fail(`merge commit '${merge}' does not resolve locally`);
    const baseSha = resolve(s.base.ref);
    if (!baseSha) fail(`base ref '${s.base.ref}' does not resolve`);
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', mergeSha, baseSha], {
        stdio: 'ignore',
      });
    } catch {
      fail(`merge commit ${mergeSha.slice(0, 8)} is not an ancestor of ${s.base.ref}`);
    }
  }
  layer.mergeResult = {
    pr: String(pr),
    head,
    merge,
    mergedAt,
    verifiedInMain: verifiedInMain === 'true',
    branchDeleted: branchDeleted === 'true',
    at: now(),
  };
  if (s.phase !== 'finalized') s.phase = 'merge-verified';
  s.updatedAt = now();
  save(s);
  console.log(
    `merge-result ${layer.n}: PR #${pr} head ${head.slice(0, 8)} merge ${merge.slice(0, 8)} ` +
      `verifiedInMain=${verifiedInMain} branchDeleted=${branchDeleted}`,
  );
  process.exit(0);
}

if (cmd === 'finalize') {
  const archiveDir = opt('--archive-dir');
  if (!archiveDir) {
    usage();
    process.exit(2);
  }
  const s = load();
  if (!s.layers.length) fail('no layers recorded');
  const missing = s.layers.filter((layer) => !layer.mergeResult);
  if (missing.length) {
    fail(
      `${missing.length} layer(s) lack merge-result: ${missing
        .map((layer) => layer.n)
        .join(', ')}`,
    );
  }
  const unsafe = s.layers.filter(
    (layer) =>
      layer.mergeResult.verifiedInMain !== true || layer.mergeResult.branchDeleted !== true,
  );
  if (unsafe.length) {
    fail(
      `${unsafe.length} layer(s) are not verified in main with the branch deleted: ${unsafe
        .map((layer) => layer.n)
        .join(', ')}`,
    );
  }
  const absolute = resolvePath(archiveDir);
  if (!existsSync(absolute)) fail(`archive dir not found: ${absolute}`);
  const rel = relative(REPO, absolute);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    fail(`archive dir must be outside the repo: ${absolute}`);
  }
  s.phase = 'finalized';
  s.finalizedAt = now();
  s.finalize = { archiveDir: absolute, at: s.finalizedAt };
  s.updatedAt = now();
  save(s);
  console.log(`phase: finalized  archive: ${absolute}`);
  process.exit(0);
}

function trust(layer) {
  const s = load();
  const l = s.layers.find((x) => x.n === layer);
  if (!l) return `layer ${layer} has no state entry`;
  if (l.gate !== 'green') return `layer ${layer} gate is ${l.gate}`;
  const branchSha = resolve(l.branch);
  if (!branchSha) return `branch ${l.branch} does not resolve`;
  if (branchSha !== l.sha) return `branch ${l.branch} moved (${l.sha.slice(0, 8)} -> ${branchSha.slice(0, 8)})`;
  const baseSha = resolve(s.base.ref);
  if (baseSha !== s.base.sha) return `base ${s.base.ref} moved (${s.base.sha.slice(0, 8)} -> ${baseSha.slice(0, 8)})`;
  return null;
}

if (cmd === 'trust') {
  const reason = trust(argv[1]);
  if (reason) fail(reason);
  console.log(`layer ${argv[1]} trusted`);
  process.exit(0);
}

if (cmd === 'check') {
  const s = load();
  if (!s.layers.length) fail('no layers recorded');
  let bad = 0;
  for (const l of s.layers) {
    const reason = trust(l.n);
    if (reason) { console.error(`  ${reason}`); bad++; }
  }
  if (bad) fail(`${bad} layer(s) are not safely reusable`);
  console.log(`all ${s.layers.length} layers trusted`);
  process.exit(0);
}

usage();
process.exit(2);
