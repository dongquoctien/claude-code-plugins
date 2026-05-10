#!/usr/bin/env node
// Compile global SCSS partials to a single CSS file at export time, so BA-side
// agents don't have to convert $variables / darken() / @include themselves.
//
// Strategy:
//   1. Locate sass module — first try project's node_modules/sass, fall back to
//      a globally-installed npm sass. If neither, write a "best-effort"
//      concatenated SCSS-as-CSS warning file and exit cleanly.
//   2. Build a synthetic entry SCSS that imports base-theme + every layout/
//      buttons/form/table/components partial in the right order.
//   3. Compile to CSS, strip vendor @import (~package paths), write to out.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './styles.compiled.css'));

if (!fs.existsSync(ROOT)) { console.error('input dir not found:', ROOT); process.exit(1); }

// 1. Find SCSS partials directory
const scssDirCandidates = ['src/assets/scss', 'src/scss', 'src/styles', 'app/assets/scss'];
const scssDir = scssDirCandidates.map(d => path.join(ROOT, d)).find(d => fs.existsSync(d));
if (!scssDir) {
  console.error(JSON.stringify({ status: 'no-scss-dir', warning: 'Project has no SCSS directory; nothing to compile.' }, null, 2));
  process.exit(0);
}

const partials = fs.readdirSync(scssDir).filter(f => f.endsWith('.scss'));
if (partials.length === 0) {
  console.error(JSON.stringify({ status: 'no-scss-files' }, null, 2));
  process.exit(0);
}

// 2. Locate sass
function findSass() {
  const candidates = [
    path.join(ROOT, 'node_modules/sass'),
    path.join(process.env.APPDATA || '', 'npm/node_modules/sass'),
    '/usr/local/lib/node_modules/sass',
    'C:/nvm4w/nodejs/node_modules/sass',
    'C:/Users/' + (process.env.USERNAME || '') + '/AppData/Roaming/npm/node_modules/sass',
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      // CJS require — works for both old (sass < 1.45) and new sass
      const mod = require(p);
      return mod;
    } catch {}
  }
  return null;
}

const sass = findSass();
if (!sass) {
  // Fallback: concat raw SCSS with stripped @import as best-effort
  const concat = ['/* sass not available — concatenated raw SCSS partials. $variables and @include will NOT resolve. */'];
  // Order: base-theme first, then partials, then top-level
  const ordered = [
    ...partials.filter(f => /^base-theme/.test(f)),
    ...partials.filter(f => /^_(layout|buttons|form|table|components|common|fonts|icons)\.scss$/.test(f)),
    ...partials.filter(f => /^_/.test(f) && !/^_(layout|buttons|form|table|components|common|fonts|icons)\.scss$/.test(f)),
    ...partials.filter(f => !f.startsWith('_') && !f.startsWith('base-theme')),
  ];
  for (const f of ordered) {
    const content = fs.readFileSync(path.join(scssDir, f), 'utf8')
      .replace(/^\s*@import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    concat.push(`\n/* ===== ${f} ===== */\n` + content);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, concat.join('\n'), 'utf8');
  console.log(JSON.stringify({
    status: 'fallback-concat',
    warning: 'sass module not found — output is raw SCSS, not compiled CSS. Install sass globally (npm i -g sass) for proper compile.',
    output: path.relative(ROOT, OUT),
    partials: partials.length,
  }, null, 2));
  process.exit(0);
}

// 3. Build synthetic entry
const entryParts = [];
// base-theme first (defines $variables)
const themeFiles = partials.filter(f => /^base-theme/.test(f) || /^[a-z-]+-theme\.scss$/.test(f));
themeFiles.forEach(f => entryParts.push(`@import "${path.basename(f, '.scss')}";`));
// Core partials in canonical order
for (const name of ['_common', '_fonts', '_icons', '_layout', '_buttons', '_form', '_table', '_components', '_modal', '_modules']) {
  if (partials.includes(name + '.scss')) entryParts.push(`@import "${name.slice(1)}";`);
}
// Remaining partials (skip duplicates and theme files)
const used = new Set([...themeFiles, ...['_common','_fonts','_icons','_layout','_buttons','_form','_table','_components','_modal','_modules'].map(n => n + '.scss')]);
for (const f of partials) {
  if (!used.has(f) && f.startsWith('_')) entryParts.push(`@import "${path.basename(f, '.scss').slice(1)}";`);
}

const entry = entryParts.join('\n');

// 4. Compile — try modern API first, fall back to legacy renderSync for old sass versions
let result;
try {
  if (typeof sass.compileString === 'function') {
    result = sass.compileString(entry, {
      loadPaths: [scssDir],
      style: 'expanded',
      quietDeps: true,
      silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin', 'color-functions', 'mixed-decls'],
    });
  } else if (typeof sass.renderSync === 'function') {
    // Legacy API (sass < 1.45)
    const legacyOut = sass.renderSync({
      data: entry,
      includePaths: [scssDir],
      outputStyle: 'expanded',
    });
    result = { css: legacyOut.css.toString() };
  } else {
    throw new Error('sass module has neither compileString nor renderSync');
  }
} catch (e) {
  console.error(JSON.stringify({ status: 'compile-error', message: e.message.slice(0, 500) }, null, 2));
  // Fall back to concat
  const concat = ['/* sass compile failed — falling back to concat. Error: ' + e.message.slice(0, 200) + ' */'];
  for (const f of partials) {
    const content = fs.readFileSync(path.join(scssDir, f), 'utf8')
      .replace(/^\s*@import\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    concat.push(`\n/* ===== ${f} ===== */\n` + content);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, concat.join('\n'), 'utf8');
  process.exit(0);
}

// 5. Strip remaining vendor imports + write
let css = result.css;
css = css.replace(/@import\s+url\(['"]?~[^'")]+['")]?\)\s*;?/g, '/* removed vendor @import */');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, css, 'utf8');

console.log(JSON.stringify({
  status: 'compiled',
  output: path.relative(ROOT, OUT),
  partialsImported: entryParts.length,
  outputBytes: css.length,
}, null, 2));
