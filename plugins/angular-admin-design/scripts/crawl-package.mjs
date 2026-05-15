#!/usr/bin/env node
// Read package.json and produce a dependency catalog so /aad-generate can
// verify any `import 'x'` statement before writing it.
//
// CRITICAL: this fixes the v0.1.0 bug where the agent imported `file-saver`
// blindly — oh-admin does NOT install file-saver, so the generated effects
// failed at build time.
//
// Output:
//   {
//     dependencies: { "<name>": "<version>" },     ← runtime deps
//     devDependencies: { "<name>": "<version>" },
//     all: { "<name>": { version, kind: 'dep'|'dev' } },
//     installed: ["<name>", ...],                  ← only those present in node_modules/
//     missingFromLockfile: ["<name>", ...]         ← declared but not installed
//   }
//
// Usage:
//   node crawl-package.mjs --in <project-root>

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const PKG = path.join(ROOT, 'package.json');

if (!fs.existsSync(PKG)) {
  console.error(JSON.stringify({ error: `No package.json at ${PKG}` }));
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const deps = pkg.dependencies || {};
const dev = pkg.devDependencies || {};
const all = {};
for (const [name, version] of Object.entries(deps)) {
  all[name] = { version, kind: 'dep' };
}
for (const [name, version] of Object.entries(dev)) {
  all[name] = { version, kind: 'dev' };
}

const nodeModulesDir = path.join(ROOT, 'node_modules');
const installed = [];
const missing = [];

// Check whether each declared package actually exists in node_modules/.
// Handle scoped packages (@org/name).
function isInstalled(name) {
  const dirName = name.startsWith('@')
    ? path.join(nodeModulesDir, ...name.split('/'))
    : path.join(nodeModulesDir, name);
  return fs.existsSync(dirName);
}

if (fs.existsSync(nodeModulesDir)) {
  for (const name of Object.keys(all)) {
    if (isInstalled(name)) installed.push(name);
    else missing.push(name);
  }
} else {
  // node_modules absent — caller should run `npm install` first
}

console.log(JSON.stringify({
  projectName: pkg.name || null,
  projectVersion: pkg.version || null,
  dependencies: deps,
  devDependencies: dev,
  all,
  installed: installed.sort(),
  missingFromLockfile: missing.sort(),
  nodeModulesExists: fs.existsSync(nodeModulesDir),
}, null, 2));
