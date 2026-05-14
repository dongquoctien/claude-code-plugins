#!/usr/bin/env node
// Walk routes/ to produce a feature inventory: each feature module's name,
// domain prefix, NgRx-store-or-not, containers, components, services, imports.
// Handles two patterns:
//   1. Flat: routes/<prefix>-<feature>/  (oh-admin)
//   2. Subtree: routes/seller/<feature>/, routes/vendor/<feature>/ (partners)
//
// Output: JSON array to stdout.
//
// Usage:
//   node crawl-routes.mjs --in <project-root> --routes-path <relative-path>

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const ROUTES_PATH = arg('--routes-path', 'src/app/routes');
const ROUTES_ABS = path.join(ROOT, ROUTES_PATH);

if (!fs.existsSync(ROUTES_ABS)) {
  console.error(JSON.stringify({ error: `Routes path not found: ${ROUTES_ABS}` }));
  process.exit(1);
}

const warnings = [];
const features = [];

function rel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }
function readFile(abs) { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } }

// Subtree roots known by convention. If a folder under routes/ matches one of these
// AND only contains other folders (no *.module.ts), descend into it.
const SUBTREE_ROOTS = new Set(['seller', 'vendor', 'common', 'public', 'shared']);

function listFeatureDirs(rootAbs) {
  const result = [];
  const top = fs.readdirSync(rootAbs, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const d of top) {
    const abs = path.join(rootAbs, d.name);
    const hasModuleFile = fs.readdirSync(abs).some(f => f.endsWith('.module.ts'));
    if (hasModuleFile) {
      result.push({ path: abs, scope: null, name: d.name });
    } else if (SUBTREE_ROOTS.has(d.name) || /^[a-z][a-z0-9-]*$/.test(d.name)) {
      // Descend one level for subtree (seller/, vendor/, etc.)
      const inner = fs.readdirSync(abs, { withFileTypes: true }).filter(x => x.isDirectory());
      for (const i of inner) {
        const innerAbs = path.join(abs, i.name);
        const innerHas = fs.readdirSync(innerAbs).some(f => f.endsWith('.module.ts'));
        if (innerHas) result.push({ path: innerAbs, scope: d.name, name: i.name });
      }
    }
  }
  return result;
}

function parseDomain(name) {
  const m = name.match(/^([a-z]{1,4})-/);
  return m ? m[1] : null;
}

function parseImports(moduleSrc) {
  // Capture the `imports: [ ... ]` array shallowly. We only need module class names,
  // not full path resolution.
  const m = moduleSrc.match(/@NgModule\s*\(\s*\{[\s\S]*?imports\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  const block = m[1];
  // Pull bare identifiers and "Class.forRoot(...)" → keep just "Class"
  const ids = new Set();
  const re = /([A-Z][A-Za-z0-9_]*)(?:\s*\.\s*for(?:Root|Child|Feature)\s*\([^)]*\))?/g;
  let mm;
  while ((mm = re.exec(block)) !== null) ids.add(mm[1]);
  return [...ids];
}

function parseClassDecls(src, suffix) {
  // Returns class names declared in the file matching pattern XxxSuffix.
  const out = [];
  const re = new RegExp(`export\\s+class\\s+([A-Z][A-Za-z0-9_]*${suffix})\\b`, 'g');
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

function walkComponentFiles(featAbs) {
  // BFS find every .component.ts under feat dir (depth-limited at 4).
  const found = [];
  const queue = [{ dir: featAbs, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > 4) continue;
    let dirents;
    try { dirents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of dirents) {
      if (d.isDirectory()) {
        if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
        queue.push({ dir: path.join(dir, d.name), depth: depth + 1 });
      } else if (d.name.endsWith('.component.ts')) {
        found.push(path.join(dir, d.name));
      }
    }
  }
  return found;
}

function walkServiceFiles(featAbs) {
  const found = [];
  const queue = [{ dir: featAbs, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > 4) continue;
    let dirents;
    try { dirents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of dirents) {
      if (d.isDirectory()) {
        if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
        queue.push({ dir: path.join(dir, d.name), depth: depth + 1 });
      } else if (d.name.endsWith('.service.ts')) {
        found.push(path.join(dir, d.name));
      }
    }
  }
  return found;
}

const featureDirs = listFeatureDirs(ROUTES_ABS);
for (const fd of featureDirs) {
  const moduleFile = fs.readdirSync(fd.path).find(f => f.endsWith('.module.ts') && !f.endsWith('-routing.module.ts'));
  if (!moduleFile) { warnings.push(`No .module.ts in ${rel(fd.path)}`); continue; }
  const moduleSrc = readFile(path.join(fd.path, moduleFile)) || '';
  const moduleClassName = (moduleSrc.match(/export\s+class\s+([A-Z][A-Za-z0-9_]*Module)\b/) || [])[1] || null;

  const hasNgRxStore = /StoreModule\s*\.\s*forFeature/.test(moduleSrc);
  const imports = parseImports(moduleSrc);
  const domain = parseDomain(fd.name);

  // Containers — typically in containers/
  const containersDir = path.join(fd.path, 'containers');
  let containerClasses = [];
  if (fs.existsSync(containersDir)) {
    for (const f of fs.readdirSync(containersDir)) {
      if (f.endsWith('.component.ts')) {
        const s = readFile(path.join(containersDir, f));
        if (s) containerClasses.push(...parseClassDecls(s, 'Component'));
      }
    }
  }

  // Components — anything else .component.ts under feat
  const componentFiles = walkComponentFiles(fd.path);
  const componentClasses = new Set();
  for (const f of componentFiles) {
    if (f.startsWith(containersDir + path.sep)) continue;
    const s = readFile(f);
    if (!s) continue;
    for (const c of parseClassDecls(s, 'Component')) componentClasses.add(c);
  }

  // Services
  const serviceFiles = walkServiceFiles(fd.path);
  const serviceClasses = new Set();
  for (const f of serviceFiles) {
    const s = readFile(f);
    if (!s) continue;
    for (const c of parseClassDecls(s, 'Service')) serviceClasses.add(c);
  }

  features.push({
    name: fd.name,
    domain,
    scope: fd.scope, // null for flat oh-admin, 'seller'/'vendor' for partners
    path: rel(fd.path),
    moduleClassName,
    moduleFile: rel(path.join(fd.path, moduleFile)),
    hasNgRxStore,
    containers: [...new Set(containerClasses)],
    components: [...componentClasses],
    services: [...serviceClasses],
    imports,
  });
}

console.log(JSON.stringify({ features, warnings }, null, 2));
