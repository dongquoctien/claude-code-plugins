#!/usr/bin/env node
// Crawl component directories and produce a list (and JSON) of components,
// classified into presentational / business / unknown.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) {
  return process.argv.includes(name);
}

const ROOT = path.resolve(arg('--in', '.'));
const FRAMEWORK = arg('--framework', 'unknown');
const DIRS = (arg('--dirs', '') || '').split(',').filter(Boolean).map(d => path.resolve(ROOT, d));
const INCLUDE = (arg('--include', 'presentational,unknown') || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT_MD = arg('--out', null);
const OUT_JSON = arg('--json-out', null);
const CLASSIFY_ONLY = flag('--classify');

if (DIRS.length === 0) {
  console.error('Pass --dirs <comma-separated-relative-paths>');
  process.exit(2);
}

const FRAMEWORK_PATTERNS = {
  angular: { ext: ['.ts'], suffix: '.component.ts' },
  react:   { ext: ['.tsx', '.jsx'], suffix: null },
  nextjs:  { ext: ['.tsx', '.jsx'], suffix: null },
  vue:     { ext: ['.vue'], suffix: null },
  nuxt:    { ext: ['.vue'], suffix: null },
  svelte:  { ext: ['.svelte'], suffix: null },
  unknown: { ext: ['.tsx', '.jsx', '.vue', '.ts', '.svelte'], suffix: null },
};

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile()) yield full;
  }
}

function pascalCase(name) {
  return name.replace(/(^|[-_.])([a-z])/g, (_, __, c) => c.toUpperCase()).replace(/\.[^.]+$/, '');
}

function deriveComponentName(file) {
  const base = path.basename(file);
  if (FRAMEWORK === 'angular' && base.endsWith('.component.ts')) {
    return pascalCase(base.replace(/\.component\.ts$/, ''));
  }
  if (base.endsWith('.tsx') || base.endsWith('.jsx')) {
    const stem = base.replace(/\.(tsx|jsx)$/, '');
    // PascalCase only — usually components
    return /^[A-Z]/.test(stem) ? stem : null;
  }
  if (base.endsWith('.vue') || base.endsWith('.svelte')) {
    return pascalCase(base.replace(/\.(vue|svelte)$/, ''));
  }
  return null;
}

// Heuristic classification — read the file, look for tells.
function classify(file) {
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { return 'unknown'; }
  const lower = src.toLowerCase();

  // Strong "business" signals
  const businessSignals = [
    /constructor\s*\([^)]*service[^)]*\)/i,
    /import\s+[^;]+from\s+['"][^'"]*\/services\//,
    /import\s+[^;]+from\s+['"][^'"]*\/api\//,
    /import\s+[^;]+from\s+['"][^'"]*\/store\//,
    /import\s+[^;]+from\s+['"][^'"]*\/hooks\/use[A-Z]/,
    /useNavigate|useRouter|useDispatch|useSelector|useQuery|useMutation/,
    /HttpClient|axios|fetch\s*\(/,
    /@Injectable|@NgRx|createReducer|createEffect/,
    /\.subscribe\s*\(/,
  ];
  const businessHits = businessSignals.filter(re => re.test(src)).length;
  if (businessHits >= 2) return 'business';
  if (businessHits === 1) return 'unknown';

  // Strong "presentational" signals
  const presentationalKeywords = [
    'button', 'card', 'badge', 'modal', 'dialog', 'tooltip', 'tabs', 'accordion',
    'avatar', 'chip', 'icon', 'spinner', 'skeleton', 'progress', 'banner', 'toast',
    'alert', 'dropdown', 'select', 'input', 'checkbox', 'radio', 'switch', 'slider',
    'pagination', 'breadcrumb', 'stepper', 'list', 'table', 'panel', 'header', 'footer',
    'sidebar', 'navbar', 'menu', 'divider', 'empty',
  ];
  const filename = path.basename(file).toLowerCase();
  const dirname = path.basename(path.dirname(file)).toLowerCase();
  const namedAfterPresentational = presentationalKeywords.some(k => filename.includes(k) || dirname.includes(k));

  // file size — presentational are usually small
  const sizeKb = Math.round(src.length / 1024);

  if (namedAfterPresentational && sizeKb < 8) return 'presentational';
  if (sizeKb < 3) return 'presentational';
  if (sizeKb > 15) return 'business';
  return 'unknown';
}

// ─── crawl ────────────────────────────────────────────────────────────
const componentsByKind = { presentational: [], business: [], unknown: [] };
const all = [];
const pat = FRAMEWORK_PATTERNS[FRAMEWORK] || FRAMEWORK_PATTERNS.unknown;

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const ext = path.extname(file).toLowerCase();
    if (!pat.ext.includes(ext)) continue;
    if (pat.suffix && !file.endsWith(pat.suffix)) continue;
    if (FRAMEWORK === 'react' || FRAMEWORK === 'nextjs') {
      // React: only PascalCase files OR files in a folder that uses index pattern
      const base = path.basename(file).replace(/\.(tsx|jsx)$/, '');
      if (!/^[A-Z]/.test(base) && base !== 'index') continue;
    }
    const name = deriveComponentName(file);
    if (!name) continue;
    const kind = classify(file);
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const entry = { name, framework: FRAMEWORK, path: rel, kind };
    componentsByKind[kind].push(entry);
    all.push(entry);
  }
}

if (CLASSIFY_ONLY) {
  console.log(JSON.stringify({
    counts: {
      presentational: componentsByKind.presentational.length,
      business: componentsByKind.business.length,
      unknown: componentsByKind.unknown.length,
    },
    sample: {
      presentational: componentsByKind.presentational.slice(0, 5).map(c => c.name),
      business: componentsByKind.business.slice(0, 5).map(c => c.name),
      unknown: componentsByKind.unknown.slice(0, 5).map(c => c.name),
    },
  }, null, 2));
  process.exit(0);
}

// Filter by --include
const filtered = all.filter(c => INCLUDE.includes(c.kind));

// Write JSON
if (OUT_JSON) {
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ components: filtered }, null, 2) + '\n', 'utf8');
}

// Write Markdown
if (OUT_MD) {
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  const out = [];
  out.push(`# Components in ${FRAMEWORK} project`);
  out.push('');
  out.push(`Detected ${all.length} components (${filtered.length} included).`);
  out.push('');
  for (const kind of ['presentational', 'unknown', 'business']) {
    const items = componentsByKind[kind];
    if (items.length === 0) continue;
    if (!INCLUDE.includes(kind)) continue;
    out.push(`## ${kind.charAt(0).toUpperCase() + kind.slice(1)} (${items.length})`);
    out.push('');
    for (const c of items) out.push(`- **${c.name}** — \`${c.path}\``);
    out.push('');
  }
  out.push('## Notes');
  out.push('');
  out.push(`Source files are NOT included. The prototype target (HTML/Tailwind or React) often can't run ${FRAMEWORK} templates directly. The BA's prototype generator uses these names — together with the imported tokens — to render equivalent prototypes that match your design language.`);
  out.push('');
  fs.writeFileSync(OUT_MD, out.join('\n'), 'utf8');
}

console.log(JSON.stringify({
  framework: FRAMEWORK,
  total: all.length,
  byKind: {
    presentational: componentsByKind.presentational.length,
    business: componentsByKind.business.length,
    unknown: componentsByKind.unknown.length,
  },
  included: filtered.length,
}, null, 2));
