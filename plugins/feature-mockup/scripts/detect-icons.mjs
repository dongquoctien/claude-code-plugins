#!/usr/bin/env node
// Detect the icon library and brand assets used by a frontend project.
// Output:
//   - iconLibrary: 'fontawesome' | 'lucide' | 'material-icons' | 'heroicons' | 'phosphor' | 'custom-svg' | 'custom-png' | 'none'
//   - iconSamples: a short list of actual icon class/name occurrences from templates
//   - brand.logo: path to the logo image (if found)
//   - brand.favicon: path to favicon
//
// The agent uses this so the prototype renders FontAwesome when the source
// uses FontAwesome, custom SVG sprites when the source uses sprites, etc.,
// instead of always falling back to Lucide.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './icon-detection.json'));

const exists = p => fs.existsSync(path.join(ROOT, p));
const readJson = p => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; } };

const result = {
  iconLibrary: 'none',
  iconLibraryConfidence: 0,
  iconSamples: [],
  brand: { logo: null, logoVariants: [], favicon: null },
  evidence: [],
  warnings: [],
};

// ─── 1. package.json signals ──────────────────────────────────────────
const pkg = readJson('package.json') || {};
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

const libSignals = [
  { lib: 'fontawesome', deps: ['@fortawesome/fontawesome-free', '@fortawesome/fontawesome-svg-core', '@fortawesome/angular-fontawesome', '@fortawesome/react-fontawesome', 'font-awesome'] },
  { lib: 'lucide',      deps: ['lucide', 'lucide-react', 'lucide-vue-next', 'lucide-svelte', 'lucide-angular'] },
  { lib: 'material-icons', deps: ['@angular/material', '@mui/icons-material', 'material-icons'] },
  { lib: 'heroicons',   deps: ['@heroicons/react', '@heroicons/vue'] },
  { lib: 'phosphor',    deps: ['@phosphor-icons/react', '@phosphor-icons/web', 'phosphor-react'] },
  { lib: 'tabler',      deps: ['@tabler/icons-react', '@tabler/icons'] },
  { lib: 'feather',     deps: ['feather-icons', 'react-feather'] },
  { lib: 'iconify',     deps: ['@iconify/react', '@iconify/vue', '@iconify/svelte'] },
  { lib: 'primeicons',  deps: ['primeicons'] },
];

for (const { lib, deps: depList } of libSignals) {
  if (depList.some(d => deps[d])) {
    result.iconLibrary = lib;
    result.iconLibraryConfidence = 0.7;
    result.evidence.push(`package.json has ${depList.find(d => deps[d])} → ${lib}`);
    break;
  }
}

// ─── 2. CSS @import / link signals ────────────────────────────────────
const stylesEntries = [
  'src/styles.scss', 'src/styles.css', 'src/index.css', 'src/main.scss',
  'src/assets/scss/base-theme.scss', 'src/assets/css/base-theme.css',
  'app/globals.css', 'styles/globals.css',
];
for (const f of stylesEntries) {
  if (!exists(f)) continue;
  let content = '';
  try { content = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
  if (/font-awesome|fontawesome/i.test(content) && result.iconLibrary === 'none') {
    result.iconLibrary = 'fontawesome';
    result.iconLibraryConfidence = 0.6;
    result.evidence.push(`${f} imports font-awesome CSS`);
  }
  if (/material-icons/i.test(content) && result.iconLibrary === 'none') {
    result.iconLibrary = 'material-icons';
    result.iconLibraryConfidence = 0.6;
    result.evidence.push(`${f} imports material-icons CSS`);
  }
}

// ─── 3. Template usage (strongest signal) ─────────────────────────────
// Scan a sample of *.component.html / *.tsx / *.vue files for icon class patterns.
function* walk(dir, depth = 0) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (['node_modules', 'dist', 'build', '.next', 'out', 'coverage'].includes(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full, depth + 1);
    else if (ent.isFile()) yield full;
  }
}

const TEMPLATE_EXT = new Set(['.html', '.tsx', '.jsx', '.vue', '.svelte']);
const ICON_PATTERNS = [
  { lib: 'fontawesome', re: /\bfa[srlb]?\b\s+fa-[\w-]+|class="fa[srlb]?\s+fa-[\w-]+/ },
  { lib: 'fontawesome', re: /<fa-icon\b|<FontAwesomeIcon\b/ },
  { lib: 'lucide',      re: /data-lucide="([\w-]+)"|<Lucide(?:Icon)?\b/ },
  { lib: 'material-icons', re: /<mat-icon\b|class="material-icons"/ },
  { lib: 'heroicons',   re: /<(?:[A-Z]\w+)Icon\s+(?:className|class)=/ }, // very loose
  { lib: 'phosphor',    re: /class="ph\b\s+ph-[\w-]+/ },
  { lib: 'primeicons',  re: /class="pi\b\s+pi-[\w-]+/ },
  { lib: 'tabler',      re: /class="ti\b\s+ti-[\w-]+/ },
];

const counts = {};
const samples = {};
let scanned = 0;
const SCAN_LIMIT = 600;

const SRC = path.join(ROOT, 'src');
if (fs.existsSync(SRC)) {
  for (const file of walk(SRC)) {
    if (scanned >= SCAN_LIMIT) break;
    if (!TEMPLATE_EXT.has(path.extname(file).toLowerCase())) continue;
    scanned++;
    let content = '';
    try { content = fs.readFileSync(file, 'utf8').slice(0, 30000); } catch { continue; }
    for (const { lib, re } of ICON_PATTERNS) {
      const matches = content.match(new RegExp(re.source, 'g'));
      if (matches) {
        counts[lib] = (counts[lib] || 0) + matches.length;
        if (!samples[lib]) samples[lib] = [];
        for (const m of matches.slice(0, 3)) {
          // Extract just the icon name where possible
          let name = m;
          const fa = /fa-([\w-]+)/.exec(m); if (fa) name = 'fa-' + fa[1];
          const lu = /data-lucide="([\w-]+)"/.exec(m); if (lu) name = 'data-lucide="' + lu[1] + '"';
          const ph = /ph-([\w-]+)/.exec(m); if (ph) name = 'ph-' + ph[1];
          if (samples[lib].length < 8 && !samples[lib].includes(name)) samples[lib].push(name);
        }
      }
    }
  }
}

// Pick the highest-count library from templates (overrides package.json signal)
const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
if (sorted.length > 0) {
  const [topLib, topCount] = sorted[0];
  if (topCount >= 5) {
    result.iconLibrary = topLib;
    result.iconLibraryConfidence = Math.min(0.95, 0.5 + topCount / 200);
    result.iconSamples = samples[topLib] || [];
    result.evidence.push(`templates use ${topLib} ${topCount}× (top sample: ${(samples[topLib] || []).slice(0, 3).join(', ')})`);
  }
}

if (result.iconLibrary === 'none' && scanned > 0) {
  // Last-ditch: look for any inline <img src="...icon..."> or <svg> patterns
  let imgIconCount = 0;
  let svgInlineCount = 0;
  scanned = 0;
  for (const file of walk(SRC)) {
    if (scanned >= 300) break;
    if (!TEMPLATE_EXT.has(path.extname(file).toLowerCase())) continue;
    scanned++;
    let content = '';
    try { content = fs.readFileSync(file, 'utf8').slice(0, 20000); } catch { continue; }
    imgIconCount += (content.match(/<img[^>]+\/(?:icons?\/|ico-)[^"]*\.(?:png|svg)/g) || []).length;
    svgInlineCount += (content.match(/<svg\b[\s\S]*?<\/svg>/g) || []).length;
  }
  if (imgIconCount > svgInlineCount && imgIconCount > 5) {
    result.iconLibrary = 'custom-png';
    result.iconLibraryConfidence = 0.6;
    result.evidence.push(`${imgIconCount} <img src="...ico-*.png|svg"> patterns in templates`);
  } else if (svgInlineCount > 5) {
    result.iconLibrary = 'custom-svg';
    result.iconLibraryConfidence = 0.5;
    result.evidence.push(`${svgInlineCount} inline <svg> blocks in templates`);
  }
}

// ─── 4. Brand logo detection ──────────────────────────────────────────
// 4a. Search common image folders for files matching logo patterns
const logoPatterns = [
  /^(header|app|brand|company)?-?logo[\w-]*\.(png|svg|jpg|webp)$/i,
  /^logo[\w-]*\.(png|svg|jpg|webp)$/i,
];
const imageDirs = [
  'src/assets/images/common', 'src/assets/images', 'src/assets/img',
  'public/images', 'public/assets/images', 'public', 'static',
];
for (const dir of imageDirs) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  let entries = [];
  try { entries = fs.readdirSync(full); } catch {}
  for (const f of entries) {
    if (logoPatterns.some(re => re.test(f))) {
      const rel = path.join(dir, f).replace(/\\/g, '/');
      if (!result.brand.logo) result.brand.logo = rel;
      result.brand.logoVariants.push(rel);
    }
    if (/^favicon\.(ico|png|svg)$/i.test(f) && !result.brand.favicon) {
      result.brand.favicon = path.join(dir, f).replace(/\\/g, '/');
    }
  }
}

// 4b. Search styles for `background: url(...logo...)` or `<img src="..logo..">` to confirm what's actually used
const stylesToScan = stylesEntries.filter(f => exists(f));
for (const f of stylesToScan) {
  try {
    const content = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = content.match(/url\((['"]?)([^'")]*logo[^'")]*\.(?:png|svg|jpg|webp))\1\)/i);
    if (m) {
      result.evidence.push(`${f} uses logo via background: url(${m[2]})`);
      // Normalize relative URL
      let resolved = m[2].replace(/^\/?assets\//, 'src/assets/').replace(/^\//, '');
      if (!result.brand.logo || !result.brand.logo.includes(path.basename(m[2]))) {
        // Prefer the actually-referenced one
        const candidate = result.brand.logoVariants.find(v => v.endsWith(path.basename(m[2])));
        if (candidate) result.brand.logo = candidate;
      }
    }
  } catch {}
}

// ─── 5. Output ────────────────────────────────────────────────────────
if (result.iconLibrary === 'none') {
  result.warnings.push('No icon library detected. Prototype will fall back to Lucide CDN unless you specify otherwise.');
}
if (!result.brand.logo) {
  result.warnings.push('No logo image detected. Prototype will fall back to text logo.');
}

fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  iconLibrary: result.iconLibrary,
  confidence: result.iconLibraryConfidence,
  samples: result.iconSamples,
  brandLogo: result.brand.logo,
  warnings: result.warnings,
}, null, 2));
