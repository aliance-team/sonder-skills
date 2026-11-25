#!/usr/bin/env node
/**
 * plan-commits.mjs — validate the plan/messages pair and emit one
 * `commits-NN.txt` per layer for atomic-commits.sh.
 *
 * usage:
 *   node plan-commits.mjs --plan plan.fixed.tsv --messages messages.tsv
 *                         --out /tmp/batch-commits [--branches branches.tsv]
 *                         [--max-subject 72] [--json]
 *
 * The plan is `layer<TAB>path` (SKIP paths allowed). The messages file is
 * `path<TAB>type(scope): subject`. Every non-SKIP planned path needs exactly one
 * message; every message path must be planned. A path listed in two layers is a
 * compat window and is emitted in both.
 *
 * exit: 0 clean, 1 invalid plan/messages, 2 usage.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(name);

if (has('--help') || has('-h')) {
  console.log(
    'usage: plan-commits.mjs --plan plan.fixed.tsv --messages messages.tsv --out DIR [--branches branches.tsv] [--max-subject 72] [--json]',
  );
  process.exit(0);
}

const planPath = arg('--plan');
const messagesPath = arg('--messages');
const outDir = arg('--out');
const branchesPath = arg('--branches');
const maxSubject = Number(arg('--max-subject', '72'));
const asJson = has('--json');

if (!planPath || !messagesPath || !outDir) {
  console.error('plan-commits: --plan, --messages and --out are required');
  process.exit(2);
}

const errors = [];
const plan = [];
const skip = new Set();

for (const raw of readFileSync(planPath, 'utf8').split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (!line.trim() || line.startsWith('#')) continue;
  const [layerRaw, ...rest] = line.split('\t');
  const path = rest.join('\t').trim();
  if (!path) {
    errors.push(`malformed plan line: ${line}`);
    continue;
  }
  if (layerRaw === 'SKIP' || layerRaw === 'EXCLUDE') {
    skip.add(path);
    continue;
  }
  if (!/^\d{1,2}$/.test(layerRaw.trim())) {
    errors.push(`bad layer "${layerRaw}" for ${path}`);
    continue;
  }
  plan.push({ layer: layerRaw.trim().padStart(2, '0'), path });
}

if (skip.size && plan.some((row) => skip.has(row.path))) {
  errors.push('a path cannot be both planned and SKIP');
}

const layerPaths = new Set();
for (const row of plan) {
  const key = `${row.layer}:${row.path}`;
  if (layerPaths.has(key)) errors.push(`duplicate path in layer ${row.layer}: ${row.path}`);
  layerPaths.add(key);
}

const messages = new Map();
const duplicateMessages = new Set();
for (const raw of readFileSync(messagesPath, 'utf8').split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (!line.trim() || line.startsWith('#')) continue;
  const [pathRaw, ...rest] = line.split('\t');
  const path = pathRaw.trim();
  const message = rest.join('\t').trim();
  if (!path || !message) {
    errors.push(`malformed message line: ${line}`);
    continue;
  }
  if (messages.has(path)) duplicateMessages.add(path);
  messages.set(path, message);
}
for (const path of duplicateMessages) errors.push(`duplicate message for ${path}`);

const planned = new Set(plan.map((row) => row.path));
const missing = [...planned].filter((path) => !messages.has(path));
const extra = [...messages.keys()].filter((path) => !planned.has(path) && !skip.has(path));
if (missing.length) errors.push(`planned paths without a message (${missing.length}): ${missing.slice(0, 10).join(', ')}`);
if (extra.length) errors.push(`messages for unplanned paths (${extra.length}): ${extra.slice(0, 10).join(', ')}`);

const conventional = /^[a-z]+(\([^)]+\))?: .+/;
for (const [path, message] of messages) {
  if (!conventional.test(message)) errors.push(`not a Conventional Commit message for ${path}: ${message}`);
  if (message.length > maxSubject + 1) {
    // Subject includes the type/scope; warn at maxSubject, but do not fail.
    console.warn(`WARN  subject ${message.length} chars (> ${maxSubject}) for ${path}: ${message}`);
  }
}

if (branchesPath) {
  const branchLayers = new Set();
  for (const raw of readFileSync(branchesPath, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.startsWith('#')) continue;
    const [layerRaw] = line.split('\t');
    if (/^\d{1,2}$/.test(layerRaw.trim())) branchLayers.add(layerRaw.trim().padStart(2, '0'));
  }
  const planLayers = new Set(plan.map((row) => row.layer));
  for (const layer of planLayers) if (!branchLayers.has(layer)) errors.push(`layer ${layer} has no branch entry`);
  for (const layer of branchLayers) if (!planLayers.has(layer)) errors.push(`branch layer ${layer} has no planned paths`);
}

if (errors.length) {
  console.error(`plan-commits: ${errors.length} error(s)`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const layers = [...new Set(plan.map((row) => row.layer))].sort();
const summary = [];
for (const layer of layers) {
  const rows = plan.filter((row) => row.layer === layer);
  const content = rows.map((row) => `${row.path}\t${messages.get(row.path)}`).join('\n') + '\n';
  writeFileSync(join(outDir, `commits-${layer}.txt`), content);
  summary.push({ layer, commits: rows.length, paths: rows.map((row) => row.path) });
}

if (asJson) {
  console.log(JSON.stringify({ outDir, skip: [...skip], layers: summary }, null, 2));
} else {
  console.log(`plan-commits: ${plan.length} planned commits across ${layers.length} layers -> ${outDir}`);
  for (const row of summary) console.log(`  ${row.layer}: ${row.commits} commit(s)`);
  if (skip.size) console.log(`  SKIP: ${skip.size} path(s)`);
}
