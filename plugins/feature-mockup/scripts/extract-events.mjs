#!/usr/bin/env node
// Extract event handlers (click, submit, change, ...) and the actions they
// trigger from framework component classes. Multi-stack — works on Angular
// component.ts, Vue SFC <script setup>, React tsx, Svelte. Output groups
// events by feature route + tags each action so the BA-side prototype can
// auto-wire onclick handlers with the correct flow.
//
// Detected action patterns (per handler body):
//   • toast / alert / snackBar / sonner / message
//   • dialog open / close / confirm / modal show
//   • route navigate / router.push / Link href
//   • store mutation / reducer dispatch / setState / useState
//   • HTTP call / fetch / axios / HttpClient
//   • emit / output / event-bus
//   • form submit / reset / validate

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './events-detection.json'));
const SRC_RAW = arg('--src', 'src');
const SRC_LIST = SRC_RAW.split(',').map(s => s.trim()).filter(Boolean);

// Auto-include app/ for Remix
if (!SRC_LIST.includes('app') && fs.existsSync(path.join(ROOT, 'app/routes'))) {
  SRC_LIST.push('app');
}

const validSrc = SRC_LIST.filter(s => fs.existsSync(path.join(ROOT, s)));
if (validSrc.length === 0) {
  console.error('source dir not found. Tried:', SRC_LIST.join(', '));
  process.exit(1);
}
const SRC = validSrc[0];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'out', '.git', 'coverage', '.angular']);
function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(full);
    else if (ent.isFile()) yield full;
  }
}

const rel = p => path.relative(ROOT, p).replace(/\\/g, '/');
function routeOf(p) {
  const norm = p.replace(/\\/g, '/');
  // Angular: /routes/<feature>/...
  let m = norm.match(/\/routes\/([^/]+)\//);
  if (m) return m[1];
  // Astro: /src/pages/<segment>/... or /src/pages/<segment>.astro
  m = norm.match(/\/src\/pages\/([^/.]+)/);
  if (m && m[1] !== 'index') return m[1];
  // Gatsby: /src/pages/<segment>/... or /src/pages/<segment>.tsx
  if (norm.includes('/src/pages/')) {
    const after = norm.split('/src/pages/')[1];
    const seg = after.split('/')[0].split('.')[0];
    if (seg && seg !== 'index') return seg;
  }
  // Remix v2 flat: /app/routes/<segment>.<...>.tsx
  m = norm.match(/\/app\/routes\/([^/.]+)/);
  if (m && !m[1].startsWith('_')) return m[1];
  // Vue/Nuxt: /pages/<segment>/...
  m = norm.match(/\/pages\/([^/.]+)/);
  if (m && m[1] !== 'index') return m[1];
  // Next.js App Router: /app/<segment>/page.tsx
  m = norm.match(/\/app\/([^/]+)\/(page|layout|loading|error)\.(tsx|jsx|ts|js)/);
  if (m && !m[1].startsWith('(') && !m[1].startsWith('_')) return m[1];
  // SvelteKit: /src/routes/<segment>/+page.svelte
  m = norm.match(/\/src\/routes\/([^/]+)\//);
  if (m) return m[1];
  return null;
}

// ─── Action signature regexes ─────────────────────────────────────────
// Each pattern: { kind, regex, captureMessage? }
const ACTION_PATTERNS = [
  // Toast / snackbar / alert
  { kind: 'toast',          re: /\b(toastr|toast|messageService|message)\.(success|error|warn(?:ing)?|info|show|create)\s*\(\s*(['"`])([^'"`]+)\3/g, msg: 4 },
  { kind: 'toast',          re: /\b(?:this\.)?\$?(?:notify|message)\s*\(\s*(['"`])([^'"`]+)\1/g, msg: 2 },
  { kind: 'snackbar',       re: /\bsnackBar\.open\s*\(\s*(['"`])([^'"`]+)\1/g, msg: 2 },
  { kind: 'sonner-toast',   re: /\btoast\.(success|error|info|warning|message)\s*\(\s*(['"`])([^'"`]+)\2/g, msg: 3 },
  { kind: 'window-alert',   re: /\b(?:alertService\.alert|window\.alert|alert)\s*\(\s*(['"`])([^'"`]+)\1/g, msg: 2 },
  // Dialog open/close
  { kind: 'dialog-open',    re: /\bopen(?:Dialog|Modal|Popup)\s*\(/g },
  { kind: 'dialog-open',    re: /\b(?:dialog|modal)\.open\s*\(\s*(\w+)/g, target: 1 },
  { kind: 'dialog-close',   re: /\bclose(?:Dialog|Modal|Popup|Handler)\s*\(/g },
  { kind: 'dialog-close',   re: /\b(?:dialogRef|modalRef)\.close\s*\(/g },
  { kind: 'dialog-visible-true', re: /\bisOpen\w*Popup\$?\.next\s*\(\s*true\s*\)/g },
  { kind: 'dialog-visible-false', re: /\bisOpen\w*Popup\$?\.next\s*\(\s*false\s*\)/g },
  // Route navigation
  { kind: 'navigate',       re: /\b(?:router|this\.router|navigate)\.navigate(?:ByUrl)?\s*\(\s*\[?\s*(['"`])([^'"`]+)\1/g, target: 2 },
  { kind: 'navigate',       re: /\brouter\.push\s*\(\s*(['"`])([^'"`]+)\1/g, target: 2 }, // Vue/Next
  // HTTP
  { kind: 'http-get',       re: /\.get(?:<[^>]+>)?\s*\(\s*(['"`])([^'"`]+)\1/g, target: 2 },
  { kind: 'http-post',      re: /\.post(?:<[^>]+>)?\s*\(\s*(['"`])([^'"`]+)\1/g, target: 2 },
  { kind: 'http-put',       re: /\.put(?:<[^>]+>)?\s*\(\s*(['"`])([^'"`]+)\1/g, target: 2 },
  { kind: 'http-delete',    re: /\.delete(?:<[^>]+>)?\s*\(\s*(['"`])([^'"`]+)\1/g, target: 2 },
  // State / store
  { kind: 'ngrx-dispatch',  re: /\b(?:store|this\.store)\.dispatch\s*\(\s*(\w+)/g, target: 1 },
  { kind: 'pinia-action',   re: /\b(\w+Store)\.(\w+)\s*\(/g, target: 2 },
  { kind: 'react-setstate', re: /\bsetState\s*\(/g },
  { kind: 'react-set-store',re: /\b(?:set|update|create|add|remove|delete)(\w{2,})\s*\(/g },
  // Form
  { kind: 'form-submit',    re: /\bform(?:Group)?\.value\b|\bonSubmit\s*\(/g },
  { kind: 'form-reset',     re: /\bform(?:Group)?\.reset\s*\(/g },
  { kind: 'form-valid',     re: /\bform(?:Group)?\.valid\b/g },
  // Emit
  { kind: 'event-emit',     re: /\bthis\.\w+\.emit\s*\(/g },
  { kind: 'event-emit',     re: /\bemit\s*\(\s*(['"`])([^'"`]+)\1/g, target: 2 },
];

// ─── Method extraction (Angular component class) ──────────────────────
// Match: `methodName(args) { body... }` or `public methodName = (args) => { body }`
const METHOD_RE = /(?:public\s+|private\s+|protected\s+|async\s+|static\s+)*(\w+)\s*\(\s*([^)]*)\s*\)\s*(?::\s*[\w<>,\s|[\]]+)?\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

// ─── Vue <script setup> functions ─────────────────────────────────────
const VUE_FN_RE = /(?:const|function)\s+(\w+)\s*=?\s*(?:async\s*)?(?:\([^)]*\)\s*=>\s*)?\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

// ─── React arrow functions ────────────────────────────────────────────
const REACT_FN_RE = /const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

// ─── Template handlers (events that trigger methods) ──────────────────
// Angular: (click)="methodName($event)" or (submit)="methodName()"
// Vue: @click="methodName" or v-on:click="methodName"
// React: onClick={methodName} or onClick={(e) => methodName(e)}
const NG_TEMPLATE_HANDLER_RE = /\((click|submit|change|input|keyup|blur|focus|valueChanges)\)="(\w+)/g;
const VUE_TEMPLATE_HANDLER_RE = /(?:@|v-on:)(click|submit|change|input|keyup|blur|focus)(?:\.\w+)?="(\w+)/g;
const REACT_TEMPLATE_HANDLER_RE = /\bon(Click|Submit|Change|Input|KeyUp|Blur|Focus)=\{(\w+)/g;

const eventsByRoute = {};

function recordEvent(route, methodName, actions, sourceFile, framework) {
  if (!route) route = '_global';
  if (!eventsByRoute[route]) eventsByRoute[route] = { handlers: {}, triggers: {}, sources: new Set() };
  if (!eventsByRoute[route].handlers[methodName]) {
    eventsByRoute[route].handlers[methodName] = {
      actions: [],
      sourceFiles: new Set(),
      framework,
      _seen: new Set(),
    };
  }
  const h = eventsByRoute[route].handlers[methodName];
  if (!h.actions) h.actions = [];
  if (!h._seen) h._seen = new Set();
  if (!h.sourceFiles || !h.sourceFiles.add) h.sourceFiles = new Set();
  for (const a of actions) {
    // Dedupe by kind+target+message
    const key = `${a.kind}|${a.target || ''}|${a.message || ''}`;
    if (!h._seen.has(key)) {
      h._seen.add(key);
      h.actions.push(a);
    }
  }
  h.sourceFiles.add(rel(sourceFile));
  eventsByRoute[route].sources.add(rel(sourceFile));
}

function recordTrigger(route, eventName, methodName, sourceFile) {
  if (!route) route = '_global';
  if (!eventsByRoute[route]) eventsByRoute[route] = { handlers: {}, triggers: {}, sources: new Set() };
  if (!eventsByRoute[route].triggers[methodName]) eventsByRoute[route].triggers[methodName] = [];
  const t = eventsByRoute[route].triggers[methodName];
  const key = `${eventName}|${rel(sourceFile)}`;
  if (!t.find(x => x._key === key)) {
    t.push({ event: eventName, sourceFile: rel(sourceFile), _key: key });
  }
}

function scanMethodBody(body, methodName, file, framework) {
  const actions = [];
  for (const pat of ACTION_PATTERNS) {
    const re = new RegExp(pat.re.source, pat.re.flags);
    for (const m of body.matchAll(re)) {
      const action = { kind: pat.kind };
      if (pat.msg && m[pat.msg]) action.message = m[pat.msg];
      if (pat.target && m[pat.target]) action.target = m[pat.target];
      actions.push(action);
    }
  }
  if (actions.length > 0) {
    const route = routeOf(file);
    recordEvent(route, methodName, actions, file, framework);
  }
}

let scanned = 0;
const SCAN_LIMIT = 5000;

// Walk every src dir (e.g. ['src', 'app'] for Remix projects)
function* walkAll() {
  for (const s of validSrc) yield* walk(path.join(ROOT, s));
}

const SRC_ROOT = path.join(ROOT, SRC); // primary, kept for backwards compat references

// Astro page <script> in frontmatter — detect handlers exported or local in <script> setup-like
const ASTRO_FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---/;
// Remix loader/action — `export async function loader(...)` or `export const action = async (...)`
const REMIX_LOADER_ACTION_RE = /export\s+(?:async\s+)?(?:function|const)\s+(loader|action|clientLoader|clientAction)\b[\s\S]{0,500}?\{([\s\S]{0,4000}?)\}/g;

for (const file of walkAll()) {
  if (scanned >= SCAN_LIMIT) break;
  const ext = path.extname(file).toLowerCase();
  if (!['.ts', '.tsx', '.jsx', '.js', '.html', '.vue', '.svelte', '.astro'].includes(ext)) continue;
  scanned++;

  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (content.length > 200000) content = content.slice(0, 200000);

  const norm = file.replace(/\\/g, '/');
  const isRemixRoute = /\/app\/routes\//.test(norm) && /\.(tsx|jsx|ts|js)$/.test(file);
  const isGatsbyPage = /\/src\/pages\//.test(norm) && /\.(tsx|jsx)$/.test(file);

  // Detect framework from extension + content
  let framework = 'unknown';
  if (ext === '.astro') framework = 'astro';
  else if (ext === '.vue') framework = 'vue';
  else if (ext === '.svelte') framework = 'svelte';
  else if (/\.component\.ts$/.test(file)) framework = 'angular';
  else if (/\.component\.html$/.test(file)) framework = 'angular';
  else if (isRemixRoute) framework = 'remix';
  else if (isGatsbyPage) framework = 'gatsby';
  else if (ext === '.tsx' || ext === '.jsx') framework = 'react';
  else if (ext === '.ts' || ext === '.js') framework = /Component|@Component|@Injectable/.test(content) ? 'angular' : 'js';

  // ── Method body scanning ─────────────────────────────────────────
  // Skip language keywords that look like methods to the regex
  const KEYWORDS = new Set(['if', 'else', 'switch', 'case', 'for', 'while', 'do', 'try', 'catch', 'finally', 'return', 'throw', 'function']);

  if (framework === 'angular' && (ext === '.ts')) {
    for (const m of content.matchAll(METHOD_RE)) {
      const methodName = m[1];
      const body = m[3];
      if (body.length < 10) continue;
      if (KEYWORDS.has(methodName)) continue;
      scanMethodBody(body, methodName, file, 'angular');
    }
  }
  if (framework === 'vue' && ext === '.vue') {
    const setupMatch = content.match(/<script\s+setup[\s\S]*?>([\s\S]*?)<\/script>/);
    const scriptBody = setupMatch ? setupMatch[1] : '';
    for (const m of scriptBody.matchAll(VUE_FN_RE)) {
      const methodName = m[1];
      const body = m[2];
      if (KEYWORDS.has(methodName)) continue;
      if (body && body.length >= 10) scanMethodBody(body, methodName, file, 'vue');
    }
  }
  if ((framework === 'react' || framework === 'remix' || framework === 'gatsby') || ext === '.tsx' || ext === '.jsx') {
    for (const m of content.matchAll(REACT_FN_RE)) {
      const methodName = m[1];
      const body = m[3];
      if (KEYWORDS.has(methodName)) continue;
      if (body && body.length >= 10) scanMethodBody(body, methodName, file, framework === 'unknown' ? 'react' : framework);
    }
  }

  // Astro frontmatter — JS expressions inside --- ... --- block at top of file
  // Plus inline <script> blocks and <script is:inline>
  if (framework === 'astro' && ext === '.astro') {
    const fmMatch = content.match(ASTRO_FRONTMATTER_RE);
    if (fmMatch) {
      const fm = fmMatch[1];
      // Treat top-level const/function declarations as handlers (rare in Astro;
      // most pages just compute data — but action-style helpers do appear)
      for (const m of fm.matchAll(/(?:const|function)\s+(\w+)\s*=?\s*(?:async\s*)?\(([^)]*)\)\s*(?:=>\s*)?\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
        const methodName = m[1];
        const body = m[3];
        if (KEYWORDS.has(methodName)) continue;
        if (body && body.length >= 10) scanMethodBody(body, methodName, file, 'astro');
      }
    }
    // Inline <script> blocks (client-side handlers)
    for (const sm of content.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
      const scriptBody = sm[1];
      for (const m of scriptBody.matchAll(REACT_FN_RE)) {
        const methodName = m[1];
        const body = m[3];
        if (KEYWORDS.has(methodName)) continue;
        if (body && body.length >= 10) scanMethodBody(body, methodName, file, 'astro');
      }
    }
  }

  // Remix loaders/actions — server-side handlers that affect UI flow
  if (framework === 'remix') {
    for (const m of content.matchAll(REMIX_LOADER_ACTION_RE)) {
      const methodName = m[1]; // loader / action / clientLoader / clientAction
      const body = m[2];
      if (body && body.length >= 10) scanMethodBody(body, methodName, file, 'remix');
    }
  }

  // ── Template handler detection ──────────────────────────────────
  if (framework === 'angular' && ext === '.html') {
    for (const m of content.matchAll(NG_TEMPLATE_HANDLER_RE)) {
      recordTrigger(routeOf(file), m[1], m[2], file);
    }
  }
  if (framework === 'vue' && ext === '.vue') {
    const tplMatch = content.match(/<template[\s\S]*?>([\s\S]*?)<\/template>/);
    const tpl = tplMatch ? tplMatch[1] : content;
    for (const m of tpl.matchAll(VUE_TEMPLATE_HANDLER_RE)) {
      recordTrigger(routeOf(file), m[1], m[2], file);
    }
  }
  if ((framework === 'react' || framework === 'remix' || framework === 'gatsby') && (ext === '.tsx' || ext === '.jsx')) {
    for (const m of content.matchAll(REACT_TEMPLATE_HANDLER_RE)) {
      recordTrigger(routeOf(file), m[1].toLowerCase(), m[2], file);
    }
  }
  // Astro: HTML-ish in template body uses on:click attribute (Astro client directives) or plain JS
  if (framework === 'astro' && ext === '.astro') {
    // After frontmatter, scan markup for on:click="handler" / onclick="handler"
    const afterFm = content.replace(ASTRO_FRONTMATTER_RE, '');
    for (const m of afterFm.matchAll(/\bon(?:click|submit|change|input|keyup|blur|focus)="(\w+)/gi)) {
      // m[0] like 'onclick="handler"', extract event name
      const evName = m[0].split('=')[0].replace(/^on/i, '').toLowerCase();
      recordTrigger(routeOf(file), evName, m[1], file);
    }
  }
}

// Convert sets / cleanup
for (const r of Object.keys(eventsByRoute)) {
  const route = eventsByRoute[r];
  for (const h of Object.values(route.handlers)) {
    delete h._seen;
    h.sourceFiles = [...h.sourceFiles];
  }
  route.sources = [...route.sources];
}

// Stats
const totalHandlers = Object.values(eventsByRoute).reduce((s, r) => s + Object.keys(r.handlers).length, 0);
const totalActions = Object.values(eventsByRoute).reduce((s, r) =>
  s + Object.values(r.handlers).reduce((a, h) => a + h.actions.length, 0), 0);
const totalTriggers = Object.values(eventsByRoute).reduce((s, r) =>
  s + Object.values(r.triggers).reduce((a, t) => a + t.length, 0), 0);

const summary = {
  generatedAt: new Date().toISOString(),
  filesScanned: scanned,
  totalRoutes: Object.keys(eventsByRoute).length,
  totalHandlers,
  totalActions,
  totalTriggers,
  eventsByRoute,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  filesScanned: scanned,
  routes: Object.keys(eventsByRoute).length,
  totalHandlers,
  totalActions,
  totalTriggers,
  topRoutes: Object.entries(eventsByRoute)
    .map(([k, v]) => ({
      route: k,
      handlers: Object.keys(v.handlers).length,
      actions: Object.values(v.handlers).reduce((s, h) => s + h.actions.length, 0),
      sampleHandlers: Object.keys(v.handlers).slice(0, 4),
    }))
    .sort((a, b) => b.actions - a.actions)
    .slice(0, 10),
}, null, 2));
