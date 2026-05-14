#!/usr/bin/env node
// Detect an Angular admin project's profile: framework versions, NgRx layout,
// shared modules path, routes path, domain prefixes, Kendo version, i18n flow.
//
// Output: JSON to stdout. Caller (aad-init skill) writes it into config.
//
// Usage:
//   node detect-profile.mjs --in <absolute-path-to-project-root>

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const warnings = [];

function exists(p) { return fs.existsSync(path.join(ROOT, p)); }
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }
  catch { return null; }
}

// ─── package.json ──────────────────────────────────────────────────────
const pkg = readJson('package.json');
if (!pkg) {
  console.error(JSON.stringify({ error: `No package.json at ${ROOT}` }));
  process.exit(1);
}
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
const scripts = pkg.scripts || {};

// ─── Sanity check: must be Angular ─────────────────────────────────────
if (!deps['@angular/core']) {
  console.error(JSON.stringify({ error: 'Not an Angular project (no @angular/core in package.json).' }));
  process.exit(1);
}
const angularVersion = deps['@angular/core'].replace(/^[~^]/, '');
const angularMajor = parseInt(angularVersion, 10);

// ─── Kendo detection ────────────────────────────────────────────────────
const kendoModules = Object.keys(deps)
  .filter(d => d.startsWith('@progress/kendo-angular-'))
  .map(d => d.replace('@progress/kendo-angular-', ''));
const kendoVersion = deps['@progress/kendo-angular-grid'] || deps['@progress/kendo-angular-buttons'] || null;

// ─── NgRx detection ─────────────────────────────────────────────────────
const hasNgRx = !!deps['@ngrx/store'];
if (!hasNgRx) warnings.push('Project does not depend on @ngrx/store. NgRx feature stores are mandatory in this plugin — codegen will still produce them but the project must install @ngrx/store, @ngrx/effects, @ngrx/entity.');

// ─── i18n flow detection ────────────────────────────────────────────────
let i18nFlow = 'none';
let i18nScanScript = null;
let i18nKeyFile = null;
if (scripts['scan:i18n'] && scripts['download:i18n']) {
  i18nFlow = 'scan-download';
  i18nScanScript = 'scan:i18n';
  // Look for the common partners pattern: a scanned source file.
  const candidates = [
    'src/assets/i18n/keys.ts',
    'src/app/shared/i18n/keys.ts',
    'src/i18n/keys.ts',
  ];
  for (const c of candidates) if (exists(c)) { i18nKeyFile = c; break; }
} else if (exists('src/assets/i18n') && fs.readdirSync(path.join(ROOT, 'src/assets/i18n')).some(f => f.endsWith('.json'))) {
  i18nFlow = 'json-inline';
} else if (deps['@ngx-translate/core']) {
  i18nFlow = 'ngx-translate-inline';
}

// ─── Path detection ─────────────────────────────────────────────────────
function pickFirst(...paths) { return paths.find(p => exists(p)) || null; }
const sharedModulesPath = pickFirst(
  'src/app/shared/modules',
  'src/app/shared/components',
  'src/app/components',
) || 'src/app/shared/modules';
const routesPath = pickFirst(
  'src/app/routes',
  'src/app/features',
  'src/app/pages',
  'src/app/modules',
) || 'src/app/routes';
if (!exists(sharedModulesPath)) warnings.push(`Shared modules path '${sharedModulesPath}' not found — using as default but indexer will return empty list.`);
if (!exists(routesPath)) warnings.push(`Routes path '${routesPath}' not found.`);

// ─── NgRx layout detection ──────────────────────────────────────────────
// Walk a couple of feature modules and observe which sub-folders exist.
// The plugin assumes Angular 9-style classic NgRx (no standalone, no signal store).
const ngrxLayoutCandidates = ['actions', 'reducers', 'effects', 'selectors', 'services', 'components', 'containers', 'models'];
const ngrxLayoutSeen = new Set();
let modulesSampled = 0;
if (exists(routesPath)) {
  const featureDirs = fs.readdirSync(path.join(ROOT, routesPath), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .slice(0, 5);
  for (const f of featureDirs) {
    const featAbs = path.join(ROOT, routesPath, f);
    let any = false;
    for (const c of ngrxLayoutCandidates) {
      if (fs.existsSync(path.join(featAbs, c))) { ngrxLayoutSeen.add(c); any = true; }
    }
    if (any) modulesSampled++;
  }
}
const ngrxLayout = (ngrxLayoutSeen.size > 0
  ? ngrxLayoutCandidates.filter(c => ngrxLayoutSeen.has(c))
  : ['actions', 'reducers', 'effects', 'services', 'components', 'containers', 'models']
).join(',');

// ─── Domain prefix detection ────────────────────────────────────────────
const domainPrefixes = new Set();
let defaultDomainPrefix = null;
if (exists(routesPath)) {
  const entries = fs.readdirSync(path.join(ROOT, routesPath), { withFileTypes: true })
    .filter(d => d.isDirectory());
  for (const e of entries) {
    const m = e.name.match(/^([a-z]{1,4})-/);
    if (m) domainPrefixes.add(m[1]);
  }
}
if (domainPrefixes.size === 0) {
  // Partners-style project may use seller/ vendor/ subtrees instead of prefix.
  if (exists(`${routesPath}/seller`)) domainPrefixes.add('seller');
  if (exists(`${routesPath}/vendor`)) domainPrefixes.add('vendor');
  if (domainPrefixes.size === 0) warnings.push(`No domain-prefix convention detected under '${routesPath}'. /aad-plan will ask the user for one.`);
}
// Heuristic: pick the most common one (skipped — would need parsing every folder; just leave for user).

// ─── Profile name guess ─────────────────────────────────────────────────
let profileName = pkg.name || 'angular-admin';
if (profileName === 'oh-admin' || profileName === 'ohmyhotel-partners') {
  // Use as-is — both projects have CLAUDE.md + claude-context already.
}

// ─── claude-context presence ────────────────────────────────────────────
const claudeContextFiles = [];
if (exists('claude-context')) {
  for (const f of fs.readdirSync(path.join(ROOT, 'claude-context'))) {
    if (f.endsWith('.md')) claudeContextFiles.push(`claude-context/${f}`);
  }
}
if (claudeContextFiles.length > 0) warnings.push(`Detected ${claudeContextFiles.length} claude-context/*.md docs — codegen will read these to honor project conventions.`);

// ─── Output ─────────────────────────────────────────────────────────────
const profile = {
  name: profileName,
  ngrxLayout,
  sharedModulesPath,
  routesPath,
  domainPrefixes: [...domainPrefixes].sort(),
  defaultDomainPrefix,
  kendoVersion,
  angularVersion,
  angularMajor,
  i18nFlow,
  i18nScanScript,
  i18nKeyFile,
};

console.log(JSON.stringify({
  profile,
  kendo: { version: kendoVersion, modules: kendoModules },
  ngrx: {
    hasNgRx,
    store: deps['@ngrx/store'] || null,
    effects: deps['@ngrx/effects'] || null,
    entity: deps['@ngrx/entity'] || null,
  },
  signals: {
    modulesSampled,
    claudeContextFiles,
  },
  warnings,
}, null, 2));
