#!/usr/bin/env node
// Walk a project's source tree and produce a single index.json describing
// every CSS/SCSS file, component, image, font, and route folder — with one-line
// summaries derived from filename + first selector + size.
//
// The downstream AI agent reads this index BEFORE reading individual files so it
// can prioritize: styles.scss + base-theme.scss + button.component.scss matter,
// node_modules and demo pages don't.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const SRC = arg('--src', 'src');
const OUT = path.resolve(arg('--out', './source-index.json'));
const MAX_FILES_PER_BUCKET = Number(arg('--max-files-per-bucket', '500'));

if (!fs.existsSync(path.join(ROOT, SRC))) {
  console.error('source dir not found:', path.join(ROOT, SRC));
  process.exit(1);
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'out', '.git', '__tests__', 'e2e', 'coverage', '.angular', '.cache']);
const SKIP_FILE_RE = /\.(spec|test|stories|story|d|map)\.(scss|css|ts|tsx|js|jsx)$/i;

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

const ext = p => path.extname(p).toLowerCase();
const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');

// One-line summary heuristics per file type
function summarize(absPath, e) {
  const size = (() => { try { return fs.statSync(absPath).size; } catch { return 0; } })();
  const base = path.basename(absPath);

  // Skip reading anything > 500KB just to summarize
  let head = '';
  if (size < 500 * 1024 && (e === '.css' || e === '.scss' || e === '.html' || e === '.ts' || e === '.tsx' || e === '.vue' || e === '.svelte' || e === '.json' || e === '.md')) {
    try { head = fs.readFileSync(absPath, 'utf8').slice(0, 4000); } catch {}
  }

  if (e === '.scss' || e === '.css') {
    // First few selectors / variables
    const vars = [...head.matchAll(/^\s*\$([\w-]+)\s*:/gm)].slice(0, 5).map(m => '$' + m[1]);
    const selectors = [...head.matchAll(/^([.#][\w-]+(?:\s*[,>+~]\s*[.#]?[\w-]+)?)\s*\{/gm)].slice(0, 5).map(m => m[1].trim());
    const importsLine = (head.match(/@import\s+['"][^'"]+['"]/g) || []).length;
    const customProps = (head.match(/--[\w-]+\s*:/g) || []).length;
    return {
      size,
      vars: vars.length ? vars : undefined,
      selectors: selectors.length ? selectors : undefined,
      importsCount: importsLine || undefined,
      customPropCount: customProps || undefined,
    };
  }

  if (e === '.ts' || e === '.tsx') {
    // Component metadata: selector, templateUrl, styleUrls
    const ngSelector = (head.match(/selector:\s*['"]([^'"]+)['"]/) || [])[1];
    const templateUrl = (head.match(/templateUrl:\s*['"]([^'"]+)['"]/) || [])[1];
    const styleUrls = [...head.matchAll(/styleUrls:\s*\[\s*((?:['"][^'"]+['"][\s,]*)+)\]/g)].flatMap(m => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]));
    const classNames = [...head.matchAll(/(?:export\s+)?class\s+(\w+)/g)].slice(0, 3).map(m => m[1]);
    const isComponent = !!ngSelector || /\.component\.tsx?$/.test(base);
    return {
      size,
      kind: isComponent ? 'angular-component' : 'typescript',
      ngSelector,
      templateUrl,
      styleUrls: styleUrls.length ? styleUrls : undefined,
      classes: classNames.length ? classNames : undefined,
    };
  }

  if (e === '.html') {
    // Template — grab top-level tag tags
    const tagSelectors = [...head.matchAll(/<(app-[\w-]+|kendo-[\w-]+|mat-[\w-]+)\b/g)].slice(0, 5).map(m => m[1]);
    const classes = [...head.matchAll(/class="([^"]+)"/g)].slice(0, 5).map(m => m[1]);
    return {
      size,
      tags: [...new Set(tagSelectors)].slice(0, 5),
      classSamples: [...new Set(classes.flatMap(c => c.split(/\s+/)))].slice(0, 8),
    };
  }

  if (e === '.vue' || e === '.svelte') {
    const hasStyle = /<style/.test(head);
    const hasScript = /<script/.test(head);
    return { size, hasStyle, hasScript };
  }

  if (e === '.json') {
    return { size };
  }

  return { size };
}

const buckets = {
  globalStyles: [],   // entry SCSS + global partials (_buttons.scss, _form.scss...)
  themeFiles: [],     // base-theme, sky-theme, *-theme files
  componentStyles: [],// *.component.scss / .css inside src/app/**
  components: [],     // *.component.ts / *.tsx / *.vue / *.svelte
  templates: [],      // *.component.html / .vue templates
  routes: [],         // immediate folders under src/app/routes (or equivalent)
  icons: [],          // svg/png with `ico-` or in `icons/`
  images: [],         // other raster/vector
  fonts: [],          // woff/woff2/ttf
  assetsCss: [],      // CSS files inside assets/
  configs: [],        // angular.json, package.json, tsconfig
  other: [],
};

const SRC_ROOT = path.join(ROOT, SRC);
let totalFiles = 0;

function classify(absPath) {
  const r = rel(absPath).toLowerCase();
  const e = ext(absPath);
  const base = path.basename(absPath);

  // configs at project root only
  if (/^(angular\.json|package\.json|tsconfig\.json|tailwind\.config\.[a-z]+|nuxt\.config\.[a-z]+|vue\.config\.[a-z]+|vite\.config\.[a-z]+|next\.config\.[a-z]+)$/.test(base) && path.dirname(absPath) === ROOT) {
    return 'configs';
  }

  // assets dir handling
  if (/\bassets[\\/]/.test(r)) {
    if (e === '.css') return 'assetsCss';
    if (e === '.scss') {
      // Theme files inside assets/scss
      if (/theme/.test(base)) return 'themeFiles';
      return 'globalStyles';
    }
    if (['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e)) {
      if (/[\\/]icons[\\/]/.test(r) || /^ico-/.test(base)) return 'icons';
      return 'images';
    }
    if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(e)) return 'fonts';
    return 'other';
  }

  // Component stylesheets
  if (/\.component\.s?css$/i.test(base) || /\.module\.s?css$/i.test(base)) return 'componentStyles';
  if (/\.component\.html$/i.test(base)) return 'templates';
  if (/\.component\.tsx?$/i.test(base)) return 'components';
  if (/\.(tsx|jsx)$/i.test(base) && /^[A-Z]/.test(base)) return 'components';
  if (/\.(vue|svelte)$/i.test(base)) return 'components';

  // Top-level styles
  if ((e === '.scss' || e === '.css') && /^(styles|main|app|index)\.s?css$/.test(base)) return 'globalStyles';
  if (e === '.scss' || e === '.css') return 'globalStyles';  // partials elsewhere

  return null;  // ignore
}

// Routes: top-level subfolders under src/app/routes (or pages/views)
const routeDirCandidates = ['src/app/routes', 'src/app/pages', 'src/views', 'src/pages', 'app/routes'];
for (const rd of routeDirCandidates) {
  const full = path.join(ROOT, rd);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
  let entries = [];
  try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch {}
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    buckets.routes.push({ path: path.join(rd, ent.name).replace(/\\/g, '/'), name: ent.name });
  }
  break;
}

for (const file of walk(ROOT)) {
  totalFiles++;
  const bucket = classify(file);
  if (!bucket) continue;
  if (buckets[bucket].length >= MAX_FILES_PER_BUCKET) continue;
  buckets[bucket].push({ path: rel(file), ...summarize(file, ext(file)) });
}

// Sort each bucket by size desc, except routes (alpha)
for (const k of Object.keys(buckets)) {
  if (k === 'routes') buckets[k].sort((a, b) => a.name.localeCompare(b.name));
  else buckets[k].sort((a, b) => (b.size || 0) - (a.size || 0));
}

const summary = {
  generatedAt: new Date().toISOString(),
  root: rel(ROOT) || '.',
  totalFilesScanned: totalFiles,
  counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
  // Top-level guidance for the AI
  guide: {
    readForTokens: ['globalStyles', 'themeFiles', 'assetsCss'],
    readForComponentStyles: ['componentStyles'],
    readForLayoutShape: ['templates', 'components'],
    readForMenuStructure: ['routes'],
    referenceForAssets: ['icons', 'images', 'fonts'],
  },
  buckets,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  output: rel(OUT),
  totalFilesScanned: totalFiles,
  counts: summary.counts,
}, null, 2));
