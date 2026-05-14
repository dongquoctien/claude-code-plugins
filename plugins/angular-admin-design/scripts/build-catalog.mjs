#!/usr/bin/env node
// Orchestrate: detect-profile + crawl-shared-modules + crawl-routes + crawl-models
// → write component-catalog.json conforming to schemas/component-catalog.schema.json.
//
// Usage:
//   node build-catalog.mjs --in <project-root> --out <abs-path-to-catalog.json>
//                          [--shared-path <rel>] [--routes-path <rel>] [--src-path <rel>]
//                          [--quiet]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', path.join(ROOT, '.claude/angular-admin-design/component-catalog.json')));
const QUIET = flag('--quiet');

function log(...a) { if (!QUIET) console.error(...a); }

function runJson(scriptName, extraArgs = []) {
  const script = path.join(__dirname, scriptName);
  try {
    const out = execFileSync(process.execPath, [script, '--in', ROOT, ...extraArgs], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(out);
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : e.message;
    console.error(`! ${scriptName} failed:`, stderr);
    process.exit(1);
  }
}

log(`Building catalog for ${ROOT}`);

// Step 1: profile
log('  • detect-profile');
const profile = runJson('detect-profile.mjs');
const sharedPath = arg('--shared-path', profile.profile.sharedModulesPath);
const routesPath = arg('--routes-path', profile.profile.routesPath);

// Step 2: shared modules
log(`  • crawl-shared-modules (${sharedPath})`);
const shared = runJson('crawl-shared-modules.mjs', ['--shared-path', sharedPath]);

// Step 3: routes
log(`  • crawl-routes (${routesPath})`);
const routes = runJson('crawl-routes.mjs', ['--routes-path', routesPath]);

// Step 4: models
log('  • crawl-models');
const models = runJson('crawl-models.mjs');

// Step 5: assemble
const catalog = {
  version: 1,
  projectRoot: ROOT.replace(/\\/g, '/'),
  indexedAt: new Date().toISOString(),
  stats: {
    sharedCount: shared.entries.length,
    featureCount: routes.features.length,
    modelCount: models.models.length,
    kendoModules: profile.kendo.modules,
    warnings: [
      ...(profile.warnings || []).map(w => `[profile] ${w}`),
      ...(shared.warnings || []).map(w => `[shared] ${w}`),
      ...(routes.warnings || []).map(w => `[routes] ${w}`),
      ...(models.warnings || []).map(w => `[models] ${w}`),
    ],
  },
  shared: shared.entries,
  features: routes.features,
  models: models.models,
  kendo: profile.kendo,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2));
log(`✓ Wrote ${OUT}`);
log(`  ${catalog.stats.sharedCount} shared · ${catalog.stats.featureCount} features · ${catalog.stats.modelCount} models · ${catalog.stats.warnings.length} warnings`);

// Also print a one-line JSON summary to stdout so the skill can capture it.
console.log(JSON.stringify({
  path: OUT,
  stats: catalog.stats,
  profile: profile.profile,
}));
