#!/usr/bin/env node
// Copy framework component sources (templates + component classes + services) into the export
// so the BA agent can read them WITHOUT having access to the dev's source repo.
//
// Output structure mirrors the source so paths in source-index.json keep resolving:
//   {out}/src/app/routes/<route-folder>/components/<component>/...component.html
//   {out}/src/app/routes/<route-folder>/services/...service.ts
//
// Budget-aware: caps total size, prefers smaller files, skips test/spec/story files.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './source-copy'));
// SRC may be a comma-separated list of source roots (e.g. "src,app" for Remix
// projects which split between src/components and app/routes).
const SRC_RAW = arg('--src', 'src');
const SRC_LIST = SRC_RAW.split(',').map(s => s.trim()).filter(Boolean);

// Auto-add app/ when present (Remix, Next.js App Router) so we don't miss routes.
if (!SRC_LIST.includes('app') && fs.existsSync(path.join(ROOT, 'app'))) {
  // Heuristic: include app/ if it contains routes/ (Remix) or any *.tsx file
  try {
    const appHasRoutes = fs.existsSync(path.join(ROOT, 'app/routes')) ||
                         fs.existsSync(path.join(ROOT, 'app/root.tsx')) ||
                         fs.existsSync(path.join(ROOT, 'app/root.jsx'));
    if (appHasRoutes) SRC_LIST.push('app');
  } catch {}
}

const MAX_BYTES = Number(arg('--max-bytes', String(20 * 1024 * 1024)));  // 20MB
const INCLUDE_SERVICES = !flag('--no-services');

const validSrcDirs = SRC_LIST.filter(s => fs.existsSync(path.join(ROOT, s)));
if (validSrcDirs.length === 0) {
  console.error('source dir not found. Tried:', SRC_LIST.map(s => path.join(ROOT, s)).join(', '));
  process.exit(1);
}

// Backwards compat: SRC variable still references the first dir (for paths in manifest)
const SRC = validSrcDirs[0];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'out', '.git', 'coverage', '.angular', '.cache', 'public', 'static']);
const SKIP_FILE_RE = /\.(spec|test|stories|story|d|map)\.(ts|tsx|js|jsx|html)$/i;

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile() && !SKIP_FILE_RE.test(ent.name)) yield full;
  }
}

function classify(absPath) {
  const lower = absPath.toLowerCase();
  const rel = absPath.replace(/\\/g, '/');
  const base = path.basename(absPath);

  // Global style partials in src/assets/scss/, src/scss/, src/styles/
  // These are critical for prototypes to inherit real layout/component styles
  // (e.g., enterprise admin _layout.scss has .page-sidebar / .page-wrap / .page-logo;
  // _buttons.scss has .btn / .btn-primary / .btn-xs/md/lg etc.)
  if (/[\\/]assets[\\/]scss[\\/]/.test(rel) && /\.scss$/.test(base)) return 'global-scss';
  if (/[\\/](scss|styles)[\\/]/.test(rel) && /\.scss$/.test(base) && !/[\\/]node_modules[\\/]/.test(rel)) return 'global-scss';
  if (/[\\/]assets[\\/]css[\\/]/.test(rel) && /\.css$/.test(base)) return 'global-css';

  // Angular
  if (/\.component\.html$/.test(base)) return 'angular-template';
  if (/\.component\.ts$/.test(base)) return 'angular-component';
  if (/\.module\.ts$/.test(base)) return 'angular-module';
  if (/\.service\.ts$/.test(base) && INCLUDE_SERVICES) return 'angular-service';
  if (/\.directive\.ts$/.test(base)) return 'angular-directive';
  if (/\.pipe\.ts$/.test(base)) return 'angular-pipe';
  // Vue
  if (/\.vue$/.test(base)) return 'vue-sfc';
  // Svelte
  if (/\.svelte$/.test(base)) return 'svelte-sfc';
  // Astro
  if (/\.astro$/.test(base)) {
    if (/[\\/]layouts[\\/]/.test(rel)) return 'astro-layout';
    if (/[\\/]pages[\\/]/.test(rel)) return 'astro-page';
    return 'astro-component';
  }
  // Remix v2 — flat routes in app/routes/
  if (/[\\/]app[\\/]routes[\\/]/.test(rel) && /\.(tsx|jsx)$/.test(base)) return 'remix-route';
  // Remix root + entry files
  if (/[\\/]app[\\/]root\.(tsx|jsx)$/.test(rel)) return 'remix-root';
  // Remix server modules — loaders/actions live in route files but can be standalone
  if (/[\\/]app[\\/].+\.server\.(ts|js)$/.test(rel) && INCLUDE_SERVICES) return 'remix-server';
  // Gatsby — pages in src/pages/, gatsby-{node,browser,ssr,config}.js are configuration
  if (/[\\/]src[\\/]pages[\\/]/.test(rel) && /\.(tsx|jsx)$/.test(base)) return 'gatsby-page';
  if (/[\\/]src[\\/]templates[\\/]/.test(rel) && /\.(tsx|jsx)$/.test(base)) return 'gatsby-template';
  if (/^gatsby-(node|browser|ssr|config)\.(js|ts|mjs)$/.test(base)) return 'gatsby-config';
  // React (PascalCase tsx/jsx — likely components)
  if (/\.(tsx|jsx)$/.test(base) && /^[A-Z]/.test(base.replace(/\.(tsx|jsx)$/, ''))) return 'react-component';
  // Index files often re-export
  if (base === 'index.tsx' || base === 'index.ts') {
    // Skip unless small
    return null;
  }
  return null;
}

const SRC_ROOT = path.join(ROOT, SRC); // primary src root (for backwards-compat paths)
const candidates = [];
for (const srcDir of validSrcDirs) {
  const root = path.join(ROOT, srcDir);
  for (const file of walk(root)) {
    const kind = classify(file);
    if (!kind) continue;
    let size = 0;
    try { size = fs.statSync(file).size; } catch { continue; }
    candidates.push({ file, kind, size });
  }
}

// Sort smallest first so under-budget items always get copied; cap by category quotas
candidates.sort((a, b) => a.size - b.size);

const stats = {};
let usedBytes = 0;
const copied = [];
const skipped = [];

for (const c of candidates) {
  if (usedBytes + c.size > MAX_BYTES) {
    skipped.push({ path: path.relative(ROOT, c.file).replace(/\\/g, '/'), reason: 'budget exceeded', kind: c.kind });
    continue;
  }
  // Mirror source path under OUT
  const relFromRoot = path.relative(ROOT, c.file);
  const target = path.join(OUT, relFromRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(c.file, target);
  usedBytes += c.size;
  stats[c.kind] = (stats[c.kind] || 0) + 1;
  copied.push(relFromRoot.replace(/\\/g, '/'));
}

const manifest = {
  exportedAt: new Date().toISOString(),
  sourceRoot: path.relative(ROOT, SRC_ROOT).replace(/\\/g, '/'),
  totalBytes: usedBytes,
  byKind: stats,
  copiedCount: copied.length,
  skippedCount: skipped.length,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '_source-copy-manifest.json'), JSON.stringify({ ...manifest, files: copied, skipped }, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  totalBytes: usedBytes,
  totalMb: Math.round(usedBytes / 1024 / 1024 * 10) / 10,
  byKind: stats,
  copiedCount: copied.length,
  skippedCount: skipped.length,
}, null, 2));
