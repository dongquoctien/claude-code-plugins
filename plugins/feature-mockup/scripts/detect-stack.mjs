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

// Detection order matters — more-specific frameworks first.
// e.g. Astro/Remix/Gatsby may pull in react as a dep, so they must come BEFORE the
// generic "deps['react']" check.
if (exists('angular.json')) { framework = 'angular'; frameworkVersion = (deps['@angular/core'] || '').replace(/^[~^]/, ''); }
else if (deps['astro'] || findOne('astro.config.js', 'astro.config.ts', 'astro.config.mjs', 'astro.config.cjs')) {
  framework = 'astro';
  frameworkVersion = (deps['astro'] || '').replace(/^[~^]/, '');
}
else if (deps['@remix-run/dev'] || deps['@remix-run/react'] || findOne('remix.config.js', 'remix.config.ts')) {
  framework = 'remix';
  frameworkVersion = (deps['@remix-run/react'] || deps['@remix-run/dev'] || '').replace(/^[~^]/, '');
}
else if (deps['gatsby'] || findOne('gatsby-config.js', 'gatsby-config.ts', 'gatsby-config.mjs')) {
  framework = 'gatsby';
  frameworkVersion = (deps['gatsby'] || '').replace(/^[~^]/, '');
}
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
  // Astro: src/styles/global.css; layouts often link <BaseLayout>
  'src/styles/global.css', 'src/styles/global.scss', 'src/styles/main.scss',
  // Remix: app/styles or app/tailwind.css; root.tsx links <Links>
  'app/tailwind.css', 'app/styles/app.css', 'app/styles/global.css',
  'app/root.css',
  // Gatsby: src/styles/global.css; gatsby-browser.js imports
  'src/styles/global.css',
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

// SCSS variables file — pick the one that actually contains $variables, not just the first existing.
const scssVarFiles = [
  'src/styles/_variables.scss', 'src/styles/variables.scss',
  'src/scss/_variables.scss', 'src/scss/variables.scss',
  'src/assets/scss/_variables.scss', 'src/assets/scss/variables.scss',
  'src/assets/scss/base-theme.scss', 'src/assets/scss/_theme.scss',
  'src/assets/styles/_variables.scss', 'src/theme.scss',
  'src/styles.scss',
];
const SCSS_VAR_RE = /^\s*\$[\w-]+\s*:/m;
const scssVarsScored = scssVarFiles
  .filter(p => exists(p))
  .map(p => {
    let score = 0;
    try {
      const content = fs.readFileSync(path.join(ROOT, p), 'utf8');
      const matches = content.match(/^\s*\$[\w-]+\s*:/gm);
      score = matches ? matches.length : 0;
    } catch {}
    return { path: p, score };
  })
  .filter(c => c.score > 0)
  .sort((a, b) => b.score - a.score);
if (scssVarsScored[0]) tokenSourceCandidates.push({ type: 'scss-vars', path: scssVarsScored[0].path });

// Detect active theme variant + ALL available variants for multi-theme systems
// (Angular/Vue admin patterns). The full list lets the prototype render a
// runtime variant switcher that demos brand multi-tenancy in one prototype.
let activeThemeVariant = null;
let themeVariants = [];
const themeServiceCandidates = [
  'src/app/layout/components/theme/theme.component.ts',
  'src/app/shared/theme/theme.service.ts',
  'src/app/core/theme/theme.service.ts',
  'src/services/theme.service.ts',
];
for (const tc of themeServiceCandidates) {
  if (!exists(tc)) continue;
  try {
    const content = fs.readFileSync(path.join(ROOT, tc), 'utf8');
    // Parse the whole themeList array to capture every variant
    const listBlockMatch = content.match(/themeList\s*=\s*\[([\s\S]*?)\]/);
    if (listBlockMatch) {
      const block = listBlockMatch[1];
      const variantRe = /\{\s*title:\s*['"]([^'"]+)['"]\s*,\s*value:\s*['"]([^'"]+)['"]/g;
      let vm;
      while ((vm = variantRe.exec(block)) !== null) {
        themeVariants.push({ title: vm[1], value: vm[2] });
      }
      // Fallback: { title: 'Sky' } only — value === title.toLowerCase()
      if (themeVariants.length === 0) {
        const titleOnlyRe = /\{\s*title:\s*['"]([^'"]+)['"]/g;
        let tm;
        while ((tm = titleOnlyRe.exec(block)) !== null) {
          themeVariants.push({ title: tm[1], value: tm[1].toLowerCase() });
        }
      }
      if (themeVariants[0]) activeThemeVariant = themeVariants[0].value || themeVariants[0].title;
      if (activeThemeVariant) break;
    }
    // Fallback: look for default attribute setter
    const da = content.match(/setAttribute\(['"]data-theme['"]\s*,\s*['"]([^'"]+)['"]/);
    if (da) { activeThemeVariant = da[1]; break; }
  } catch {}
}

// Also scan the global theme.css / styles.scss for `html[data-theme=X]` blocks —
// this is the source-of-truth: any variant declared in CSS is renderable, even if
// the theme service doesn't list it.
const cssVariantSet = new Set();
for (const cssPath of [...stylesEntries, 'src/assets/css/theme.css', 'src/styles.css']) {
  if (!exists(cssPath)) continue;
  try {
    const content = fs.readFileSync(path.join(ROOT, cssPath), 'utf8');
    const re = /html\[data-theme=['"]?([a-zA-Z0-9_-]+)['"]?\]/g;
    let m;
    while ((m = re.exec(content)) !== null) cssVariantSet.add(m[1]);
  } catch {}
}
// Merge: any CSS variant not in themeVariants gets added with title === value
for (const v of cssVariantSet) {
  if (!themeVariants.some(tv => tv.value === v || tv.title === v)) {
    themeVariants.push({ title: v.charAt(0).toUpperCase() + v.slice(1), value: v });
  }
}

// CSS variables — score by content (count of -- declarations) and prefer compiled theme files
const cssVarCandidates = [
  ...stylesEntries.filter(p => p.endsWith('.css')),
  // Compiled theme CSS files often live here (Angular/Vue admin patterns)
  'src/assets/css/base-theme.css', 'src/assets/css/basic-theme.css',
  'src/assets/css/theme.css', 'src/assets/css/sky-theme.css',
  'src/assets/styles/theme.css', 'public/theme.css',
];
const cssVarsScored = [...new Set(cssVarCandidates)]
  .filter(p => exists(p))
  .map(p => {
    let score = 0;
    try {
      const content = fs.readFileSync(path.join(ROOT, p), 'utf8');
      const matches = content.match(/--[\w-]+\s*:/g);
      score = matches ? matches.length : 0;
    } catch {}
    return { path: p, score };
  })
  .filter(c => c.score > 0)
  .sort((a, b) => b.score - a.score);
for (const c of cssVarsScored) tokenSourceCandidates.push({ type: 'css-vars', path: c.path });

// ─── Component directories ────────────────────────────────────────────
const componentDirs = [];

const componentDirCandidates = {
  angular: ['src/app/shared', 'src/app/layout/components', 'src/app/components', 'src/app/core/components'],
  react:   ['src/components', 'src/ui', 'components', 'app/components'],
  nextjs:  ['components', 'src/components', 'app/components', 'components/ui'],
  vue:     ['src/components', 'components'],
  nuxt:    ['components', 'src/components'],
  svelte:  ['src/lib', 'src/lib/components'],
  // Astro: components live in src/components; .astro / .tsx / .vue / .svelte all valid here
  astro:   ['src/components', 'src/components/ui', 'src/layouts'],
  // Remix v2: components in app/components (custom convention, no built-in)
  remix:   ['app/components', 'app/components/ui', 'app/lib/components'],
  // Gatsby: src/components is conventional
  gatsby:  ['src/components', 'src/components/ui'],
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

// ─── Routes (admin menu source) ───────────────────────────────────────
// Different frameworks store routes very differently:
//   Angular:    src/app/routes/<feature>/   (folder per feature)
//   Next.js:    app/<segment>/page.tsx OR pages/<segment>.tsx
//   Vue/Nuxt:   pages/<file>.vue OR src/pages/<file>.vue
//   Svelte:     src/routes/<segment>/+page.svelte
//   Astro:      src/pages/<file>.astro (recursive — file-based, [slug] for dynamic)
//   Remix:      app/routes/<file>.tsx (flat with . separators, e.g. booking.$id.tsx)
//   Gatsby:     src/pages/<file>.tsx + createPages programmatic
let routesDir = null;
const routeDirCandidates = {
  angular:  ['src/app/routes', 'src/app/pages'],
  nextjs:   ['app', 'pages', 'src/app', 'src/pages'],
  nuxt:     ['pages', 'src/pages', 'app/pages'],
  vue:      ['src/views', 'src/pages', 'pages'],
  react:    ['src/views', 'src/pages', 'src/routes'],
  svelte:   ['src/routes'],
  astro:    ['src/pages'],
  remix:    ['app/routes'],
  gatsby:   ['src/pages'],
  unknown:  ['src/app/routes', 'src/views', 'src/pages', 'pages', 'app/routes'],
};
for (const rd of routeDirCandidates[framework] || routeDirCandidates.unknown) {
  if (exists(rd) && fs.statSync(path.join(ROOT, rd)).isDirectory()) { routesDir = rd; break; }
}

let routes = [];
if (routesDir) {
  try {
    if (framework === 'astro') {
      // Astro: src/pages/**/*.astro, but also nested folders. Treat each
      // top-level page file (without extension) as a route name. For nested
      // folders, treat the folder as the route.
      const entries = fs.readdirSync(path.join(ROOT, routesDir), { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
        if (e.isDirectory()) routes.push(e.name);
        else if (e.isFile() && /\.(astro|md|mdx)$/.test(e.name) && !e.name.startsWith('index.')) {
          routes.push(e.name.replace(/\.(astro|md|mdx)$/, ''));
        }
      }
    } else if (framework === 'remix') {
      // Remix v2 flat: e.g. "booking._index.tsx", "booking.$id.tsx", "_index.tsx"
      // The route name is the segment before the first '.' (or the whole filename if no '.')
      const entries = fs.readdirSync(path.join(ROOT, routesDir), { withFileTypes: true });
      const seenSegments = new Set();
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name.startsWith('_index')) continue;
        if (e.isFile() && /\.(tsx|jsx|ts|js)$/.test(e.name)) {
          const stem = e.name.replace(/\.(tsx|jsx|ts|js)$/, '');
          const topSegment = stem.split('.')[0];
          if (topSegment && !topSegment.startsWith('_')) seenSegments.add(topSegment);
        } else if (e.isDirectory() && !e.name.startsWith('_')) {
          seenSegments.add(e.name);
        }
      }
      routes = [...seenSegments];
    } else if (framework === 'gatsby') {
      // Gatsby: src/pages/<file>.tsx (file-based) + may have programmatic via gatsby-node.js
      const entries = fs.readdirSync(path.join(ROOT, routesDir), { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
        if (e.isDirectory()) routes.push(e.name);
        else if (e.isFile() && /\.(tsx|jsx|ts|js|md|mdx)$/.test(e.name) && !e.name.startsWith('index.')) {
          routes.push(e.name.replace(/\.(tsx|jsx|ts|js|md|mdx)$/, ''));
        }
      }
    } else {
      // Default behavior: each direct subdirectory is a route name
      // (Angular convention; also acceptable for Next/Nuxt/Vue/Svelte).
      routes = fs.readdirSync(path.join(ROOT, routesDir), { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_') && !e.name.startsWith('('))
        .map(e => e.name);
    }
  } catch {}
}

// ─── Output ───────────────────────────────────────────────────────────
const result = {
  framework,
  frameworkVersion,
  css,
  uiLib,
  activeThemeVariant,   // null when not multi-theme; otherwise the title of themeList[0]
  themeVariants,        // all declared variants [{ title, value }]; empty when single-theme
  stylesEntries,
  componentDirs,
  tokenSourceCandidates,
  routesDir,
  routes: routes.slice(0, 100),  // cap so JSON stays reasonable
  packageName: pkg.name || null,
  packageVersion: pkg.version || null,
  warnings,
};

console.log(JSON.stringify(result, null, 2));
