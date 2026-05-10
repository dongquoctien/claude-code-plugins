#!/usr/bin/env node
// Produce a single CSS file from a project's style sources, prioritizing
// already-compiled CSS bundles. Falls back to concatenating SCSS partials
// (raw, not compiled) for reference only.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './styles.compiled.css'));

if (!fs.existsSync(ROOT)) { console.error('input not found:', ROOT); process.exit(1); }

const exists = p => fs.existsSync(path.join(ROOT, p));
const read   = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const result = { mode: null, sources: [], warnings: [] };

// Strategy 1 — collect all candidate compiled CSS bundles, score each by
// (size + count of component-like selectors), keep the best one OR concat
// when multiple are needed (e.g. theme.css for vars + styles.css for components).
const compiledCandidates = [
  // Main app bundles
  'dist/styles.css', 'dist/main.css',
  'public/styles.css', 'public/build/styles.css',
  // Source-shipped compiled CSS
  'src/assets/css/styles.css',
  'src/assets/css/base-theme.css',
  'src/assets/css/basic-theme.css',
  'src/assets/css/theme.component.css',
  'src/styles.css',
];

function scoreCss(css) {
  // Component-style selectors signal real styling, not just :root vars
  const selectors = (css.match(/^[.#][\w-]+\s*[,{]/gm) || []).length;
  const customProps = (css.match(/--[\w-]+\s*:/g) || []).length;
  return selectors * 10 + customProps + Math.min(css.length / 1000, 500);
}

const scored = [];
for (const c of compiledCandidates) {
  if (!exists(c)) continue;
  const fullPath = path.join(ROOT, c);
  const size = fs.statSync(fullPath).size;
  if (size < 200) continue;  // skip empty/trivial files
  const css = read(c);
  scored.push({ path: c, size, css, score: scoreCss(css) });
}

// Sort by score desc, then dedupe by content (some projects have same file in multiple paths)
scored.sort((a, b) => b.score - a.score);
const seen = new Set();
const picked = [];
for (const s of scored) {
  const fingerprint = s.css.length + ':' + s.css.slice(0, 200);
  if (seen.has(fingerprint)) continue;
  seen.add(fingerprint);
  picked.push(s);
  if (picked.length >= 3) break;  // never concat more than 3
}

if (picked.length > 0) {
  // Concatenate the top picks (theme vars + component styles often live in different files)
  const sections = picked.map(p => {
    let css = p.css.replace(/@import\s*['"]~[^'"]+['"]\s*;?/g, '/* removed npm-package import */');
    return `/* ===== ${p.path} (score ${Math.round(p.score)}) ===== */\n${css}`;
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sections.join('\n\n'), 'utf8');
  result.mode = picked.length > 1 ? 'compiled-bundles-merged' : 'compiled-bundle';
  result.sources = picked.map(p => p.path);
} else {
  // Strategy 2: concatenate SCSS partials (raw, not real compile)
  const scssDirs = ['src/assets/scss', 'src/scss', 'src/styles'];
  const dir = scssDirs.find(d => exists(d));
  if (!dir) {
    console.error('Neither a compiled CSS bundle nor a SCSS dir was found.');
    process.exit(1);
  }
  const fullDir = path.join(ROOT, dir);
  let entries = [];
  try { entries = fs.readdirSync(fullDir).filter(f => f.endsWith('.scss')); } catch {}
  // Prefer base-theme/_variables first, then partials, then root
  entries.sort((a, b) => {
    const score = f => f.startsWith('_variables') ? 0 : f.startsWith('base-theme') ? 1 : f.startsWith('_') ? 2 : 3;
    return score(a) - score(b);
  });
  const parts = [];
  parts.push('/* Concatenated SCSS partials — reference only, not compiled. */');
  parts.push('/* Source: ' + dir + ' */\n');
  for (const f of entries) {
    parts.push('\n/* ===== ' + f + ' ===== */\n');
    let content = read(path.join(dir, f));
    // strip @import lines (would error in plain CSS)
    content = content.replace(/^\s*@import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    parts.push(content);
    result.sources.push(path.join(dir, f).replace(/\\/g, '/'));
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, parts.join('\n'), 'utf8');
  result.mode = 'concatenated-scss-raw';
  result.warnings.push('SCSS partials concatenated without compilation. Variables ($foo) and mixins (@include) will NOT resolve. Use as reference, not as a stylesheet.');
}

const finalSize = fs.statSync(OUT).size;
console.log(JSON.stringify({
  mode: result.mode,
  sources: result.sources,
  outputSize: finalSize,
  warnings: result.warnings,
}, null, 2));
