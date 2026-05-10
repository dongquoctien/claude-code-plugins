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
const SRC = arg('--src', 'src');

if (!fs.existsSync(path.join(ROOT, SRC))) {
  console.error('source dir not found:', path.join(ROOT, SRC));
  process.exit(1);
}

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
  const m = p.match(/[\\/]routes[\\/]([^\\/]+)[\\/]/);
  return m ? m[1] : null;
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
const SRC_ROOT = path.join(ROOT, SRC);

for (const file of walk(SRC_ROOT)) {
  if (scanned >= SCAN_LIMIT) break;
  const ext = path.extname(file).toLowerCase();
  if (!['.ts', '.tsx', '.jsx', '.js', '.html', '.vue', '.svelte'].includes(ext)) continue;
  scanned++;

  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (content.length > 200000) content = content.slice(0, 200000);

  // Detect framework from extension + content
  let framework = 'unknown';
  if (ext === '.vue') framework = 'vue';
  else if (ext === '.svelte') framework = 'svelte';
  else if (/\.component\.ts$/.test(file)) framework = 'angular';
  else if (/\.component\.html$/.test(file)) framework = 'angular';
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
  if (framework === 'react' || ext === '.tsx' || ext === '.jsx') {
    for (const m of content.matchAll(REACT_FN_RE)) {
      const methodName = m[1];
      const body = m[3];
      if (KEYWORDS.has(methodName)) continue;
      if (body && body.length >= 10) scanMethodBody(body, methodName, file, 'react');
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
  if (framework === 'react' && (ext === '.tsx' || ext === '.jsx')) {
    for (const m of content.matchAll(REACT_TEMPLATE_HANDLER_RE)) {
      recordTrigger(routeOf(file), m[1].toLowerCase(), m[2], file);
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
