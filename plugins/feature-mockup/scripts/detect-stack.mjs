#!/usr/bin/env node
// Detect the front-end stack of a project: framework, CSS approach, UI library,
// likely token sources, and component directories.

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
function findOne(...candidates) { return candidates.find(c => exists(c)); }

// ─── package.json ─────────────────────────────────────────────────────
const pkg = readJson('package.json') || {};
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

// ─── Framework ────────────────────────────────────────────────────────
let framework = 'unknown';
let frameworkVersion = null;

if (exists('angular.json')) { framework = 'angular'; frameworkVersion = (deps['@angular/core'] || '').replace(/^[~^]/, ''); }
else if (deps['next']) { framework = 'nextjs'; frameworkVersion = deps['next'].replace(/^[~^]/, ''); }
else if (deps['nuxt'] || deps['nuxt3']) { framework = 'nuxt'; frameworkVersion = (deps['nuxt'] || deps['nuxt3']).replace(/^[~^]/, ''); }
else if (deps['vue']) { framework = 'vue'; frameworkVersion = deps['vue'].replace(/^[~^]/, ''); }
else if (deps['react']) { framework = 'react'; frameworkVersion = deps['react'].replace(/^[~^]/, ''); }
else if (deps['svelte'] || deps['@sveltejs/kit']) { framework = 'svelte'; }

// ─── CSS approach ─────────────────────────────────────────────────────
const css = [];
if (exists('tailwind.config.js') || exists('tailwind.config.ts') || exists('tailwind.config.cjs') || exists('tailwind.config.mjs') || deps['tailwindcss']) {
  css.push('tailwind');
}
// scan a few likely entry files for SCSS/CSS
const styleEntryCandidates = [
  'src/styles.scss', 'src/styles.css',
  'src/css/styles.css', 'src/css/main.css',
  'src/assets/styles.scss', 'src/assets/main.scss',
  'styles/globals.css', 'app/globals.css', // Next.js app router
  'src/global.css', 'src/global.scss',
];
const stylesEntries = styleEntryCandidates.filter(p => exists(p));
if (stylesEntries.some(p => p.endsWith('.scss')) || deps['sass'] || deps['node-sass']) css.push('scss');
if (stylesEntries.some(p => p.endsWith('.css'))) css.push('css');
if (css.length === 0) css.push('unknown');

// ─── UI library ───────────────────────────────────────────────────────
const uiLib = [];
if (Object.keys(deps).some(d => d.startsWith('@progress/kendo'))) uiLib.push('kendo');
if (Object.keys(deps).some(d => d.startsWith('@mui/') || d === '@material-ui/core')) uiLib.push('material');
if (deps['@radix-ui/react-slot'] || deps['class-variance-authority']) uiLib.push('shadcn');
if (deps['antd']) uiLib.push('antd');
if (deps['@chakra-ui/react']) uiLib.push('chakra');
if (deps['quasar']) uiLib.push('quasar');
if (deps['vuetify']) uiLib.push('vuetify');
if (deps['@nuxt/ui'] || deps['@headlessui/vue'] || deps['@headlessui/react']) uiLib.push('headlessui');
if (Object.keys(deps).some(d => d.startsWith('bootstrap'))) uiLib.push('bootstrap');
if (uiLib.length === 0) uiLib.push('none');

// ─── Token source candidates ──────────────────────────────────────────
const tokenSourceCandidates = [];

// Tailwind config (highest priority)
const tw = findOne('tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs');
if (tw) tokenSourceCandidates.push({ type: 'tailwind', path: tw });

// tokens.json (Style Dictionary or flat)
const tokens = findOne('tokens.json', 'design-tokens.json', 'src/tokens.json', 'src/design-tokens.json');
if (tokens) tokenSourceCandidates.push({ type: 'tokens-json', path: tokens });

// SCSS variables file (look for $color- patterns)
const scssVarFiles = [
  'src/styles.scss', 'src/styles/_variables.scss', 'src/styles/variables.scss',
  'src/scss/_variables.scss', 'src/scss/variables.scss',
  'src/assets/scss/_variables.scss', 'src/assets/scss/variables.scss',
  'src/assets/scss/base-theme.scss', 'src/assets/scss/_theme.scss',
  'src/assets/styles/_variables.scss', 'src/theme.scss',
];
const scssVar = scssVarFiles.find(p => exists(p));
if (scssVar) tokenSourceCandidates.push({ type: 'scss-vars', path: scssVar });

// CSS variables (fallback)
const cssVarFiles = stylesEntries.filter(p => p.endsWith('.css'));
for (const f of cssVarFiles) tokenSourceCandidates.push({ type: 'css-vars', path: f });

// ─── Component directories ────────────────────────────────────────────
const componentDirs = [];

const componentDirCandidates = {
  angular: ['src/app/shared', 'src/app/layout/components', 'src/app/components', 'src/app/core/components'],
  react:   ['src/components', 'src/ui', 'components', 'app/components'],
  nextjs:  ['components', 'src/components', 'app/components', 'components/ui'],
  vue:     ['src/components', 'components'],
  nuxt:    ['components', 'src/components'],
  svelte:  ['src/lib', 'src/lib/components'],
  unknown: ['src/components', 'components'],
};

for (const dir of componentDirCandidates[framework] || []) {
  if (exists(dir) && fs.statSync(path.join(ROOT, dir)).isDirectory()) {
    componentDirs.push(dir);
  }
}

if (componentDirs.length === 0) {
  warnings.push('No component directory detected. Pass --dirs explicitly to crawl-components.');
}

if (tokenSourceCandidates.length === 0) {
  warnings.push('No token source candidates found. Falling back to defaults during extraction.');
}

// ─── Output ───────────────────────────────────────────────────────────
const result = {
  framework,
  frameworkVersion,
  css,
  uiLib,
  stylesEntries,
  componentDirs,
  tokenSourceCandidates,
  packageName: pkg.name || null,
  packageVersion: pkg.version || null,
  warnings,
};

console.log(JSON.stringify(result, null, 2));
