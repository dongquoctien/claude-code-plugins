#!/usr/bin/env node
// Copy front-end design assets (images/icons/fonts/CSS partials) into the export.
// Output structure mirrors the source so url() references in CSS keep working.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

const ROOT = path.resolve(arg('--in', '.'));
const OUT_DIR = path.resolve(arg('--out', './assets-out'));
const SKIP_FONTS = flag('--skip-fonts');
const FONT_BUDGET_MB = Number(arg('--font-budget-mb', '8'));    // cap font copy
const IMAGE_BUDGET_MB = Number(arg('--image-budget-mb', '20')); // cap image copy

if (!fs.existsSync(ROOT)) { console.error('input not found:', ROOT); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

const stats = {
  images: { count: 0, bytes: 0, files: [] },
  icons:  { count: 0, bytes: 0, files: [] },
  fonts:  { count: 0, bytes: 0, files: [], skipped: 0 },
  styles: { count: 0, bytes: 0, files: [] },
  warnings: [],
};

const ASSETS_ROOT = ['src/assets', 'public/assets', 'public', 'static'].map(d => path.join(ROOT, d)).find(d => fs.existsSync(d));
if (!ASSETS_ROOT) {
  stats.warnings.push('No src/assets, public/assets, public/, or static/ directory found.');
  console.log(JSON.stringify(stats, null, 2));
  process.exit(0);
}

function bytesOf(p) { try { return fs.statSync(p).size; } catch { return 0; } }
function ext(p) { return path.extname(p).toLowerCase(); }

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (ent.name === 'node_modules') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile()) yield full;
  }
}

function categorize(absPath) {
  const e = ext(absPath);
  const rel = path.relative(ASSETS_ROOT, absPath).toLowerCase().replace(/\\/g, '/');
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(e)) {
    if (rel.includes('icon') || /[\\/]ico-/.test(rel) || /[\\/]icons[\\/]/.test(rel)) return 'icons';
    return 'images';
  }
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(e)) return 'fonts';
  if (['.css', '.scss', '.sass'].includes(e)) return 'styles';
  return null;
}

function copyFile(absPath, category) {
  const rel = path.relative(ASSETS_ROOT, absPath);
  const target = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(absPath, target);
  const size = bytesOf(absPath);
  stats[category].count++;
  stats[category].bytes += size;
  stats[category].files.push(rel.replace(/\\/g, '/'));
}

// Collect first, then enforce budgets
const candidates = { images: [], icons: [], fonts: [], styles: [] };
for (const f of walk(ASSETS_ROOT)) {
  const cat = categorize(f);
  if (!cat) continue;
  candidates[cat].push({ path: f, size: bytesOf(f) });
}

// Process each category
for (const cat of ['icons', 'images', 'styles']) {
  const budget = cat === 'images' ? IMAGE_BUDGET_MB * 1024 * 1024 : Infinity;
  let used = 0;
  // Sort smallest first so under-budget items always get copied
  candidates[cat].sort((a, b) => a.size - b.size);
  for (const c of candidates[cat]) {
    if (used + c.size > budget) {
      stats.warnings.push(`Skipped ${path.relative(ROOT, c.path)} (${cat} budget exceeded)`);
      continue;
    }
    copyFile(c.path, cat);
    used += c.size;
  }
}

// Fonts — special handling: skip whole category when --skip-fonts, else cap by budget,
// and prefer woff2 + non-subset (highest quality) within budget.
if (!SKIP_FONTS) {
  const budget = FONT_BUDGET_MB * 1024 * 1024;
  // Score: woff2 + non-subset preferred
  const scored = candidates.fonts.map(c => {
    const name = path.basename(c.path).toLowerCase();
    let score = 0;
    if (name.endsWith('.woff2')) score += 10;
    else if (name.endsWith('.woff')) score += 5;
    else if (name.endsWith('.ttf')) score += 3;
    if (!name.includes('subset')) score += 2;
    return { ...c, score };
  }).sort((a, b) => b.score - a.score || a.size - b.size);
  let used = 0;
  for (const c of scored) {
    if (used + c.size > budget) { stats.fonts.skipped++; continue; }
    copyFile(c.path, 'fonts');
    used += c.size;
  }
} else {
  stats.fonts.skipped = candidates.fonts.length;
  if (candidates.fonts.length > 0) {
    stats.warnings.push(`Skipped ${candidates.fonts.length} font files (--skip-fonts). Prototypes will fall back to web fonts via CDN.`);
  }
}

// Manifest of what was copied
const manifest = {
  exportedAt: new Date().toISOString(),
  assetsRoot: path.relative(ROOT, ASSETS_ROOT).replace(/\\/g, '/'),
  totals: {
    icons: { count: stats.icons.count, bytes: stats.icons.bytes },
    images: { count: stats.images.count, bytes: stats.images.bytes },
    fonts: { count: stats.fonts.count, bytes: stats.fonts.bytes, skipped: stats.fonts.skipped },
    styles: { count: stats.styles.count, bytes: stats.styles.bytes },
  },
  files: {
    icons: stats.icons.files,
    images: stats.images.files,
    fonts: stats.fonts.files,
    styles: stats.styles.files,
  },
};
fs.writeFileSync(path.join(OUT_DIR, '_assets-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  totals: manifest.totals,
  warnings: stats.warnings,
}, null, 2));
