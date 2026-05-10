#!/usr/bin/env node
// Walk a project's source tree and concatenate every framework-component
// stylesheet (Angular *.component.scss/css, Vue <style> blocks, Svelte <style>)
// into a single file. Output is RAW — variables, @include, :host, etc. remain
// unresolved. The caller (theme-extractor agent) is expected to feed this
// through an AI cleanup pass with tokens.json so the final CSS is usable in
// a static prototype.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './component-styles.raw.scss'));
const SRC = arg('--src', 'src');
const MAX_BYTES = Number(arg('--max-bytes', String(8 * 1024 * 1024)));

if (!fs.existsSync(path.join(ROOT, SRC))) {
  console.error('source dir not found:', path.join(ROOT, SRC));
  process.exit(1);
}

const COMPONENT_PATTERNS = [
  { match: /\.component\.scss$/, kind: 'angular-scss' },
  { match: /\.component\.css$/,  kind: 'angular-css'  },
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'out', '__tests__', 'e2e', '.git']);
const SKIP_RE = /\.(spec|test|stories|story)\.(scss|css|ts|tsx|js|jsx)$/i;

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile() && !SKIP_RE.test(ent.name)) yield full;
  }
}

const out = [];
const stats = { angularScss: 0, angularCss: 0, vue: 0, svelte: 0, totalBytes: 0, skipped: [] };
let usedBytes = 0;

function append(filePath, content, kind) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const size = Buffer.byteLength(content, 'utf8');
  if (usedBytes + size > MAX_BYTES) {
    stats.skipped.push({ path: rel, reason: 'budget exceeded' });
    return false;
  }
  out.push(`\n/* ===== ${rel} (${kind}) ===== */\n`);
  out.push(content);
  usedBytes += size;
  stats.totalBytes += size;
  return true;
}

const SRC_ROOT = path.join(ROOT, SRC);
for (const file of walk(SRC_ROOT)) {
  const lower = file.toLowerCase();

  let matched = false;
  for (const pat of COMPONENT_PATTERNS) {
    if (pat.match.test(lower)) {
      const content = fs.readFileSync(file, 'utf8');
      if (append(file, content, pat.kind)) {
        if (pat.kind.includes('scss')) stats.angularScss++;
        else stats.angularCss++;
      }
      matched = true;
      break;
    }
  }
  if (matched) continue;

  if (lower.endsWith('.vue')) {
    const content = fs.readFileSync(file, 'utf8');
    const blocks = [...content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)];
    if (blocks.length) {
      const merged = blocks.map(m => m[1]).join('\n');
      if (append(file, merged, 'vue-style')) stats.vue++;
    }
  }

  if (lower.endsWith('.svelte')) {
    const content = fs.readFileSync(file, 'utf8');
    const m = content.match(/<style\b[^>]*>([\s\S]*?)<\/style>/);
    if (m && append(file, m[1], 'svelte-style')) stats.svelte++;
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.join('\n'), 'utf8');

console.log(JSON.stringify({
  output: path.relative(ROOT, OUT).replace(/\\/g, '/'),
  fileCount: stats.angularScss + stats.angularCss + stats.vue + stats.svelte,
  byKind: {
    'angular-scss': stats.angularScss,
    'angular-css': stats.angularCss,
    'vue': stats.vue,
    'svelte': stats.svelte,
  },
  totalBytes: stats.totalBytes,
  skipped: stats.skipped,
  note: 'Output is RAW — feed through an AI cleanup pass (resolve $variables, strip :host, dedupe) before linking from a prototype.',
}, null, 2));
