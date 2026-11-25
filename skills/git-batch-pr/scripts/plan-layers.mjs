#!/usr/bin/env node
/**
 * plan-layers.mjs — make a file->layer plan actually buildable.
 *
 * Reads the FINAL tree of a batch (a snapshot ref), the base ref, and an intent
 * plan (layer<TAB>path). It reports and/or fixes the three things that break
 * file-level layering in any repo whose compiler sees the whole tree:
 *
 *   1. coverage       changed paths the plan forgot
 *   2. forward edges  layer N imports a symbol that the BASE version of a module
 *                     planned for M > N does not export yet  -> pull M down
 *   3. compat windows an export the base had, the snapshot removed, and a
 *                     consumer that only migrates in a later layer
 *
 * A path may appear in more than one layer: that is how a compat window is
 * expressed (alias version first, pristine snapshot last).
 *
 * Usage:
 *   node plan-layers.mjs --snapshot _batch-source --base main --plan plan.tsv
 *                        [--emit plan.fixed.tsv] [--max-drag 3] [--json]
 *
 * Exit codes: 0 clean, 3 findings, 1 usage error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name) => argv.includes(name);

if (has('--help') || has('-h')) {
  const doc = readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0];
  console.log(doc.replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

const snapshot = arg('--snapshot');
const base = arg('--base', 'main');
const planPath = arg('--plan');
const emitPath = arg('--emit');
const maxDrag = Number(arg('--max-drag', '3'));
const asJson = has('--json');
const strict = has('--strict');

if (!snapshot || !planPath) {
  console.error(
    'usage: plan-layers.mjs --snapshot <ref> --plan <plan.tsv> [--base main] [--emit out.tsv]',
  );
  process.exit(1);
}

const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...a) =>
  execFileSync('git', a, { cwd: REPO, maxBuffer: 256 * 1024 * 1024 }).toString();

const tree = new Set(git('ls-tree', '-r', '--name-only', snapshot).split('\n').filter(Boolean));
const baseTree = new Set(git('ls-tree', '-r', '--name-only', base).split('\n').filter(Boolean));

const contentCache = new Map();
function content(ref, path) {
  const key = `${ref}:${path}`;
  if (contentCache.has(key)) return contentCache.get(key);
  let out = null;
  try {
    out = execFileSync('git', ['show', `${ref}:${path}`], {
      cwd: REPO,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch {
    out = null;
  }
  contentCache.set(key, out);
  return out;
}

// ------------------------------------------------------------------ exports
// `export default function Foo` exports ONLY `default`; `Foo` is a local
// binding, not a named export. Treating it as named produced false compat
// windows for every default consumer of a renamed default export.
const DECL_RE =
  /export\s+(?:declare\s+)?(?:(default)\s+)?(?:async\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g;
const BRACE_RE = /export\s*(?:type\s*)?\{([^}]*)\}/g;

function exportsOf(src) {
  if (src == null) return { names: new Set(), star: false };
  const names = new Set();
  let m;
  DECL_RE.lastIndex = 0;
  while ((m = DECL_RE.exec(src))) {
    if (m[1]) names.add('default');
    else names.add(m[2]);
  }
  BRACE_RE.lastIndex = 0;
  while ((m = BRACE_RE.exec(src))) {
    for (const part of m[1].split(',')) {
      const clean = part.trim().replace(/^type\s+/, '');
      if (!clean) continue;
      const alias = clean.split(/\s+as\s+/);
      names.add((alias[1] ?? alias[0]).trim());
    }
  }
  if (/export\s+default\b/.test(src)) names.add('default');
  return { names, star: /export\s+\*\s+from/.test(src) };
}

// ------------------------------------------------------------------- module
const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.astro', '.json', '.css', '.svelte', '.vue'];
function resolveSpec(fromPath, spec) {
  const clean = spec.split('?')[0].split('#')[0];
  if (!clean.startsWith('.')) return null;
  const basePath = posix.normalize(posix.join(posix.dirname(fromPath), clean));
  const cands = [basePath];
  if (basePath.endsWith('.js'))
    cands.push(basePath.slice(0, -3) + '.ts', basePath.slice(0, -3) + '.tsx');
  for (const e of EXTS) cands.push(basePath + e);
  for (const e of ['.ts', '.tsx', '.js']) cands.push(posix.join(basePath, 'index' + e));
  return cands.find((c) => tree.has(c)) ?? null;
}

function parseClause(clause) {
  const out = { names: new Set(), namespace: false, default: false };
  if (!clause) return out;
  if (clause.includes('*')) out.namespace = true;
  const brace = clause.match(/\{([\s\S]*)\}/);
  if (brace) {
    for (const part of brace[1].split(',')) {
      const clean = part.trim().replace(/^type\s+/, '');
      if (!clean) continue;
      out.names.add(clean.split(/\s+as\s+/)[0].trim());
    }
  }
  const beforeBrace = clause.split('{')[0].replace(/^type\s+/, '').replace(/,\s*$/, '').trim();
  if (beforeBrace && !beforeBrace.includes('*')) out.default = true;
  return out;
}

// -------------------------------------------------------------------- plan
const SKIP = 'SKIP';
const occurrences = new Map(); // path -> Set<layer>
const explicitCount = new Map();
const skipPaths = new Set();
const errors = [];

for (const raw of readFileSync(planPath, 'utf8').split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (!line.trim() || line.startsWith('#')) continue;
  const [layerRaw, ...rest] = line.split('\t');
  const path = rest.join('\t').trim();
  if (!path) {
    errors.push(`malformed plan line: ${line}`);
    continue;
  }
  if (layerRaw === SKIP || layerRaw === 'EXCLUDE') {
    skipPaths.add(path);
    continue;
  }
  if (!/^\d{1,2}$/.test(layerRaw.trim())) {
    errors.push(`bad layer "${layerRaw}" for ${path}`);
    continue;
  }
  if (!occurrences.has(path)) occurrences.set(path, new Set());
  occurrences.get(path).add(Number(layerRaw));
  explicitCount.set(path, (explicitCount.get(path) ?? 0) + 1);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const layerOf = new Map([...occurrences].map(([p, set]) => [p, Math.min(...set)]));
const lastLayerOf = new Map([...occurrences].map(([p, set]) => [p, Math.max(...set)]));
const fmt = (n) => String(n).padStart(2, '0');

// Where the snapshot version of a file lands. A path written twice is a compat
// window (alias first, pristine last); a path written once that got pulled
// earlier lands at its new earliest occurrence.
const removalLayerOf = (p) =>
  (explicitCount.get(p) ?? 1) > 1 ? (lastLayerOf.get(p) ?? layerOf.get(p)) : layerOf.get(p);

// ---------------------------------------------------------------- coverage
const changed = new Set(
  git('diff', '--name-only', base, snapshot)
    .split('\n')
    .filter(Boolean),
);
const missingCoverage = [...changed].filter((p) => !occurrences.has(p) && !skipPaths.has(p));
const plannedButUnchanged = [...occurrences.keys()].filter((p) => !changed.has(p));

// ------------------------------------------------------------ dependency scan
const deps = new Map(); // path -> Map(dep -> { names, namespace, default })
const unresolved = [];
const namespaceImports = [];

for (const path of layerOf.keys()) {
  const src = content(snapshot, path);
  if (src == null) {
    if (!baseTree.has(path)) {
      errors.push(`planned path missing from ${snapshot}: ${path}`);
    } else {
      deps.set(path, new Map());
    }
    continue;
  }
  const map = new Map();
  const addEdge = (target, info) => {
    if (!layerOf.has(target)) return; // unchanged module: base version everywhere
    if (!map.has(target))
      map.set(target, { names: new Set(), namespace: false, default: false, moduleOnly: false });
    const merged = map.get(target);
    for (const n of info.names) merged.names.add(n);
    merged.namespace ||= info.namespace;
    merged.default ||= info.default;
    merged.moduleOnly ||= info.moduleOnly;
  };
  const re = /\bimport\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const target = resolveSpec(path, m[2]);
    if (!target) {
      if (m[2].startsWith('.')) unresolved.push([path, m[2]]);
      continue;
    }
    const info = parseClause(m[1]);
    if (info.namespace) namespaceImports.push([path, target]);
    addEdge(target, info);
  }
  // Side-effect, dynamic and require imports: the module itself must exist.
  const moduleRe = /(?:^\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/gm;
  while ((m = moduleRe.exec(src))) {
    const target = resolveSpec(path, m[1]);
    if (!target) {
      if (m[1].startsWith('.')) unresolved.push([path, m[1]]);
      continue;
    }
    addEdge(target, { names: new Set(), namespace: false, default: false, moduleOnly: true });
  }
  deps.set(path, map);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

// --------------------------------------------------------- forward fixpoint
// A forward edge exists only when the consumer imports a symbol that the BASE
// version of the dependency does not export yet.
const fixed = new Map(layerOf);
const moves = [];
let changedAny = true;
while (changedAny) {
  changedAny = false;
  for (const [file, map] of deps) {
    const lf = fixed.get(file);
    for (const [dep, info] of map) {
      const ld = fixed.get(dep);
      if (ld <= lf) continue;
      const baseSrc = content(base, dep);
      const baseNames = baseSrc == null ? new Set() : exportsOf(baseSrc).names;
      const missing = info.namespace
        ? []
        : [...info.names].filter((n) => !baseNames.has(n));
      // .astro/.vue/.svelte components expose an implicit default export.
      const hasDefault =
        baseNames.has('default') || /\.(astro|vue|svelte)$/.test(dep);
      if (info.default && !hasDefault) missing.push('default');
      if (baseSrc == null && !missing.length) missing.push('(module)');
      if (!missing.length) continue;
      moves.push({ path: dep, from: ld, to: lf, cause: file, symbols: missing });
      fixed.set(dep, lf);
      // A pulled dependency keeps ONE commit (the snapshot version); only an
      // explicit second line in the plan is a compat duplicate.
      if ((explicitCount.get(dep) ?? 1) > 1) occurrences.get(dep).add(lf);
      else occurrences.set(dep, new Set([lf]));
      changedAny = true;
    }
  }
}

// --------------------------------------------------------- compat windows
function clauseFor(ref, file, target) {
  const src = content(ref, file);
  if (src == null) return null;
  const re = /\bimport\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    if (resolveSpec(file, m[2]) === target) return m[1];
  }
  return null;
}

function importsSymbol(clause, name) {
  if (clause == null) return false;
  if (name === 'default') return !clause.trim().startsWith('{') && !clause.includes('*');
  if (clause.includes('*')) return true;
  // A named import must appear inside the braces. A default import whose local
  // name happens to equal `name` is not a named import (e.g. `import Dialog from
  // './Dialog'` must not count as `{ Dialog }`).
  const brace = clause.match(/\{([\s\S]*)\}/);
  if (!brace) return false;
  return new RegExp(`(^|[\\s,{}])${name.replace(/\$/g, '\\$')}(\\s|,|}|$)`).test(brace[1]);
}

// Consumer index from the BASE tree: a compat window exists only when a file
// imported the symbol before the batch and still exists in an earlier layer.
const consumers = new Map();
for (const path of baseTree) {
  if (!/\.(ts|tsx|astro|js|mjs|cjs)$/.test(path)) continue;
  const src = content(base, path);
  if (src == null) continue;
  const re = /\bimport\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const target = resolveSpec(path, m[2]);
    if (!target) continue;
    if (!consumers.has(target)) consumers.set(target, []);
    consumers.get(target).push({ file: path, clause: m[1] });
  }
}

const compat = [];
const unanalyzedStar = [];
for (const [path, layer] of fixed) {
  const baseSrc = content(base, path);
  const snapSrc = content(snapshot, path);
  if (baseSrc == null || snapSrc == null || baseSrc === snapSrc) continue;
  const b = exportsOf(baseSrc);
  const s = exportsOf(snapSrc);
  if (s.star) {
    unanalyzedStar.push(path);
    continue;
  }
  const removed = [...b.names].filter((n) => !s.names.has(n));
  if (!removed.length) continue;

  for (const { file, clause } of consumers.get(path) ?? []) {
    if (file === path) continue;
    const consumed = removed.filter((name) => importsSymbol(clause, name));
    if (!consumed.length) continue;

    const still = consumed.filter((name) =>
      importsSymbol(clauseFor(snapshot, file, path), name),
    );
    if (still.length) {
      compat.push({ definer: path, symbol: still.join(','), consumer: file, from: layer, until: null });
      continue;
    }

    const consumerLayer = fixed.get(file);
    if (consumerLayer == null) continue; // untouched consumer kept the import: caught above
    const removal = removalLayerOf(path);
    if (removal < consumerLayer) {
      compat.push({
        definer: path,
        symbol: consumed.join(','),
        consumer: file,
        from: layer,
        until: consumerLayer,
      });
    }
  }
}

// -------------------------------------------------------------------- report
const report = {
  snapshot,
  base,
  plannedPaths: occurrences.size,
  changedPaths: changed.size,
  missingCoverage,
  plannedButUnchanged,
  unresolved,
  namespaceImports,
  unanalyzedStar,
  moves,
  compat,
  drag: moves.length,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`plan-layers: ${occurrences.size} planned paths, ${changed.size} changed vs ${base}`);

  if (missingCoverage.length) {
    console.log(`\n✗ COVERAGE — changed but not in the plan (${missingCoverage.length}):`);
    for (const p of missingCoverage) console.log(`    ${p}`);
    console.log('  these keep their BASE content in every layer; add them or mark SKIP');
  }
  if (plannedButUnchanged.length) {
    console.log(`\n! ${plannedButUnchanged.length} planned path(s) identical to ${base}:`);
    for (const p of plannedButUnchanged) console.log(`    ${p}`);
  }
  if (unresolved.length) {
    console.log(`\n✗ BROKEN TREE — ${unresolved.length} relative import(s) resolve to nothing:`);
    for (const [f, spec] of unresolved) console.log(`    ${f} -> ${spec}`);
  }
  if (moves.length) {
    console.log(`\n→ FORWARD EDGES — pulling ${moves.length} path(s) earlier:`);
    for (const m of moves)
      console.log(
        `    ${fmt(m.from)} -> ${fmt(m.to)}  ${m.path}   (${m.symbols.join(', ')} needed by ${m.cause})`,
      );
    if (moves.length > maxDrag) {
      console.log(
        `\n! drag=${moves.length} > ${maxDrag}: this pull drags a subsystem early.` +
          `\n  Consider pushing the consumer up, or coarsening the layers (fewer, wider layers).`,
      );
    }
  }
  if (compat.length) {
    console.log(`\n→ COMPAT WINDOWS:`);
    for (const c of compat) {
      if (c.until == null) {
        console.log(`    ✗ ${c.definer}: "${c.symbol}" removed but ${c.consumer} still imports it`);
      } else {
        console.log(
          `    ${fmt(c.from)}..${fmt(c.until - 1)}  ${c.definer}: keep "${c.symbol}" as @deprecated` +
            ` for ${c.consumer} (migrates at ${fmt(c.until)})`,
        );
      }
    }
  }
  if (unanalyzedStar.length) {
    console.log(`\n! ${unanalyzedStar.length} file(s) use "export *"; removals there are not analysed:`);
    for (const p of unanalyzedStar) console.log(`    ${p}`);
  }
  if (namespaceImports.length) {
    console.log(`\n? ${namespaceImports.length} namespace import(s) of planned modules (not checked):`);
    for (const [f, t] of namespaceImports.slice(0, 10)) console.log(`    ${f} -> ${t}`);
  }
  if (!missingCoverage.length && !moves.length && !compat.length && !unresolved.length) {
    console.log('\n✓ plan is dependency-closed: no moves, no compat windows, no gaps');
  }
}

if (emitPath) {
  // A compat window needs TWO commits of the same file: the alias version at
  // `from`, the pristine snapshot at `until`. Encode the second one here.
  const notes = [];
  for (const c of compat) {
    if (c.until == null) continue;
    occurrences.get(c.definer).add(c.until);
    notes.push(
      `# COMPAT ${fmt(c.from)}..${fmt(c.until - 1)} ${c.definer} keep "${c.symbol}" for ${c.consumer}`,
    );
  }
  const rows = [];
  for (const [p, set] of occurrences) for (const l of set) rows.push([l, p]);
  rows.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  const out = notes.concat(rows.map(([l, p]) => `${fmt(l)}\t${p}`));
  for (const p of skipPaths) out.push(`${SKIP}\t${p}`);
  writeFileSync(emitPath, out.join('\n') + '\n');
  console.log(`\nwrote ${emitPath} (${rows.length} entries, ${notes.length} compat note(s))`);
}

const findings =
  missingCoverage.length +
  moves.length +
  unresolved.length +
  compat.filter((c) => c.until == null).length +
  (strict ? namespaceImports.length + unanalyzedStar.length : 0);
process.exit(findings ? 3 : 0);
