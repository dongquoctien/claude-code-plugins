#!/usr/bin/env node
// Extract verbatim code snippets from 1+ "anchor" feature modules so the
// code-generator agent has REAL code to copy, instead of hand-written knowledge
// patterns that drift from the codebase.
//
// v0.2.0 — this script is what makes the plugin "anchor to project's actual
// code". Knowledge files (ngrx-feature-store.md, kendo-grid-patterns.md) point
// at reference-features.json as the source of truth.
//
// For each anchor feature, capture:
//   - module shape (imports, declarations, providers)
//   - routing module (route data, lazy-load pattern)
//   - actions/index re-export
//   - reducer outer + inner featureKey, State, initialState shape
//   - effects constructor + 1-2 representative createEffect blocks
//   - api service (`succeedYn` pattern, _addRowid helper)
//   - container component shape (private/public$/form/lifecycle order)
//   - template patterns for grid + form
//
// Output:
//   {
//     anchors: ["bs-event", "ho-reservation-list-ota", "ad-dashboard"],
//     features: {
//       "bs-event": {
//         module: { path, source },
//         routing: { path, source },
//         actions: { path, source },
//         reducerInner: { path, source, featureKey },
//         reducerOuter: { path, source, featureKey },
//         effects: { path, source },
//         apiService: { path, source },
//         container: { path, source },
//         containerHtml: { path, source }
//       },
//       ...
//     }
//   }
//
// Usage:
//   node extract-reference-features.mjs --in <project-root>
//                                       --routes-path <rel>
//                                       --anchors bs-event,ho-reservation-list-ota,ad-dashboard
//                                       --out <abs-path-to-reference-features.json>

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const ROUTES_PATH = arg('--routes-path', 'src/app/routes');
const ANCHORS = arg('--anchors', 'bs-event,ho-reservation-list-ota,ad-dashboard')
  .split(',').map(s => s.trim()).filter(Boolean);
const OUT = path.resolve(arg('--out', path.join(ROOT, '.claude/angular-admin-design/reference-features.json')));

const warnings = [];

function rel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }
function read(abs) { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } }
function exists(p) { return fs.existsSync(p); }

function pickFile(dir, ...filenames) {
  for (const f of filenames) {
    const p = path.join(dir, f);
    if (exists(p)) return p;
  }
  return null;
}

function pickAny(dir, suffix, excludeSuffix = null) {
  if (!exists(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(suffix) && (!excludeSuffix || !f.endsWith(excludeSuffix)));
  return files[0] ? path.join(dir, files[0]) : null;
}

function parseFeatureKey(src) {
  if (!src) return null;
  const m = src.match(/export\s+const\s+featureKey\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function snapshot(absPath) {
  if (!absPath || !exists(absPath)) return null;
  const src = read(absPath);
  if (src === null) return null;
  return {
    path: rel(absPath),
    source: src,
    lineCount: src.split('\n').length,
  };
}

function extractFeature(featureName) {
  const featDir = path.join(ROOT, ROUTES_PATH, featureName);
  if (!exists(featDir)) {
    warnings.push(`Anchor feature dir not found: ${rel(featDir)}`);
    return null;
  }

  // Module file
  const moduleFile = pickAny(featDir, '.module.ts', '-routing.module.ts');
  // Routing module
  const routingFile = pickAny(featDir, '-routing.module.ts');

  // Subfolders
  const actionsDir = path.join(featDir, 'actions');
  const reducersDir = path.join(featDir, 'reducers');
  const effectsDir = path.join(featDir, 'effects');
  const servicesDir = path.join(featDir, 'services');
  const containersDir = path.join(featDir, 'containers');

  // Actions: prefer the main *.actions.ts (not index.ts)
  const actionsFile = pickAny(actionsDir, '.actions.ts');
  const actionsIndex = exists(path.join(actionsDir, 'index.ts')) ? path.join(actionsDir, 'index.ts') : null;

  // Reducers: 2 files — outer (reducers/index.ts) + inner (*.reducer.ts)
  const reducerInnerFile = pickAny(reducersDir, '.reducer.ts');
  const reducerOuterFile = exists(path.join(reducersDir, 'index.ts')) ? path.join(reducersDir, 'index.ts') : null;

  // Effects: prefer first *.effects.ts
  const effectsFile = pickAny(effectsDir, '.effects.ts');

  // API service: prefer *-api.service.ts
  let apiServiceFile = pickAny(servicesDir, '-api.service.ts');
  if (!apiServiceFile) apiServiceFile = pickAny(servicesDir, '.service.ts');

  // Container: prefer *.component.ts in containers/
  const containerFile = pickAny(containersDir, '.component.ts');
  const containerHtmlFile = pickAny(containersDir, '.component.html');

  const result = {
    feature: featureName,
    featureDir: rel(featDir),
    module: snapshot(moduleFile),
    routing: snapshot(routingFile),
    actions: snapshot(actionsFile),
    actionsIndex: snapshot(actionsIndex),
    reducerInner: snapshot(reducerInnerFile),
    reducerOuter: snapshot(reducerOuterFile),
    effects: snapshot(effectsFile),
    apiService: snapshot(apiServiceFile),
    container: snapshot(containerFile),
    containerHtml: snapshot(containerHtmlFile),
  };

  // Parse featureKeys (inner + outer) for downstream knowledge to ref.
  if (result.reducerInner) {
    result.reducerInner.featureKey = parseFeatureKey(result.reducerInner.source);
  }
  if (result.reducerOuter) {
    result.reducerOuter.featureKey = parseFeatureKey(result.reducerOuter.source);
  }

  return result;
}

const features = {};
for (const a of ANCHORS) {
  const f = extractFeature(a);
  if (f) features[a] = f;
}

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  projectRoot: ROOT.replace(/\\/g, '/'),
  routesPath: ROUTES_PATH,
  anchors: ANCHORS,
  features,
  warnings,
  stats: {
    anchorCount: Object.keys(features).length,
    snapshotCount: Object.values(features).reduce((n, f) => {
      const fields = ['module', 'routing', 'actions', 'reducerInner', 'reducerOuter', 'effects', 'apiService', 'container', 'containerHtml'];
      return n + fields.filter(k => f[k] !== null).length;
    }, 0),
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(output, null, 2));

console.log(JSON.stringify({
  path: OUT,
  anchors: output.anchors,
  stats: output.stats,
  warnings: output.warnings,
}, null, 2));
