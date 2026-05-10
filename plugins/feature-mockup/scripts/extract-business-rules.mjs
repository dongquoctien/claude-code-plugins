#!/usr/bin/env node
// Extract business rules / domain logic from framework component classes
// without an LLM. We scan for:
//   1. Top-of-file comments / JSDoc annotations describing intent
//   2. Inline `// BR-001` / `/* business: ... */` / `// must / cannot / should`
//   3. `if (...)` blocks with descriptive conditions + alert/error messages
//   4. Custom validator functions (Validators.something + return error key)
//   5. Conditional disable/hide patterns ([disabled], [hidden], v-if, ngIf)
//   6. Constants with "MAX_", "MIN_", "DEFAULT_", "ERR_" prefixes
//
// Output groups rules by feature route. The BA-side prototype consumes this
// to add helper text, disabled states, and behavior comments alongside the
// extracted form fields. Multi-stack — works on Angular / Vue / React /
// Svelte / vanilla TS/JS.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './business-rules.json'));
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

const rulesByRoute = {};

function recordRule(route, rule) {
  if (!route) route = '_global';
  if (!rulesByRoute[route]) rulesByRoute[route] = { rules: [], constants: [], errorMessages: [], sources: new Set() };
  rulesByRoute[route].rules.push(rule);
  rulesByRoute[route].sources.add(rule.sourceFile);
}

function recordConstant(route, c) {
  if (!route) route = '_global';
  if (!rulesByRoute[route]) rulesByRoute[route] = { rules: [], constants: [], errorMessages: [], sources: new Set() };
  rulesByRoute[route].constants.push(c);
  rulesByRoute[route].sources.add(c.sourceFile);
}

function recordError(route, e) {
  if (!route) route = '_global';
  if (!rulesByRoute[route]) rulesByRoute[route] = { rules: [], constants: [], errorMessages: [], sources: new Set() };
  rulesByRoute[route].errorMessages.push(e);
  rulesByRoute[route].sources.add(e.sourceFile);
}

// ─── Patterns ─────────────────────────────────────────────────────────

// 1. Tagged business-rule comments: // BR-001 / // ERR-REG-014 / //  R12 /
//    /* business: Region must... */ / @business
const TAGGED_COMMENT_RE = /\/\/\s*((?:BR|ERR|US|FR|AC|R\d+|OQ)[-_]?\d+(?:\w*)?)\s*[:\-]?\s*([^\n]+)|\/\*+\s*(?:business|rule|invariant|constraint|note)\s*[:\-]\s*([\s\S]+?)\*\//gi;

// 2. Imperative comments: // must / cannot / should / always / never
const IMPERATIVE_COMMENT_RE = /\/\/\s*(?:(?:must|cannot|should|always|never|require|disallow|forbid|allow only)\b[^\n]+)|\/\/\s*(?:max|min|maximum|minimum|limit|cap)\s+\w[^\n]+/gi;

// 3. Conditional alert: if (condition) { alert/throw/error("message"); }
const COND_ALERT_RE = /if\s*\(\s*([^)]{5,200})\s*\)\s*\{[^{}]*?(?:alert|throw|messageService\.error|toastr\.error|showError|alertService\.alert)\s*\(\s*[^,)]*?(['"`])([^'"`]{5,200})\2/g;

// 4. Custom validator: function name(...){ ... return { errorKey: ... } }
const CUSTOM_VALIDATOR_RE = /(?:function|const)\s+(\w*[Vv]alidat\w*)\s*[=:]?\s*[^{]*\{[\s\S]{20,500}?return\s*\{\s*(\w+):/g;

// 5. Constants: export const MAX_FOO = 20;  / private static readonly ERR_X = 'msg';
const CONSTANT_RE = /(?:export\s+)?(?:const|let|public|private|static|readonly)\s+([A-Z][A-Z0-9_]{2,}(?:_\w+)*)\s*[:=]\s*([^;]{1,200});/g;

// 6. Error code pattern: ERR-REG-003 / ERR_VALIDATION_xxx / 'errorKey'
const ERROR_CODE_RE = /(['"`])(ERR[-_][A-Z0-9_-]{4,40})\1/g;

// 7. Conditional disabled/hidden: [disabled]="someCondition" or :disabled or disabled={x}
const CONDITIONAL_DISABLE_RE = /(\[?(?:disabled|hidden|readonly)\]?|:disabled|:hidden|:readonly)=["']([^"']{3,80})["']/g;

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

  const route = routeOf(file);
  const sourceFile = rel(file);

  // 1. Tagged comments
  for (const m of content.matchAll(TAGGED_COMMENT_RE)) {
    const tag = m[1];
    const text = (m[2] || m[3] || '').trim().slice(0, 300);
    if (text.length < 3) continue;
    recordRule(route, { kind: 'tagged-comment', tag, text, sourceFile });
  }

  // 2. Imperative comments — only TS/component files (HTML has more noise)
  if (ext === '.ts' || ext === '.tsx' || ext === '.jsx' || ext === '.js') {
    for (const m of content.matchAll(IMPERATIVE_COMMENT_RE)) {
      const text = m[0].replace(/^\/\/\s*/, '').trim().slice(0, 250);
      if (text.length < 8) continue;
      recordRule(route, { kind: 'imperative-comment', text, sourceFile });
    }
  }

  // 3. Conditional alerts (alert message preserved, condition for context)
  if (ext === '.ts' || ext === '.tsx' || ext === '.jsx' || ext === '.js') {
    for (const m of content.matchAll(COND_ALERT_RE)) {
      const condition = m[1].trim().slice(0, 150);
      const message = m[3];
      recordRule(route, { kind: 'conditional-alert', condition, message, sourceFile });
      recordError(route, { code: null, message, sourceFile });
    }
  }

  // 4. Custom validators
  if (ext === '.ts' || ext === '.tsx' || ext === '.jsx' || ext === '.js') {
    for (const m of content.matchAll(CUSTOM_VALIDATOR_RE)) {
      const name = m[1];
      const errorKey = m[2];
      recordRule(route, { kind: 'custom-validator', name, errorKey, sourceFile });
    }
  }

  // 5. Constants
  if (ext === '.ts' || ext === '.tsx' || ext === '.jsx' || ext === '.js') {
    for (const m of content.matchAll(CONSTANT_RE)) {
      const name = m[1];
      let value = m[2].trim();
      if (value.length > 80) value = value.slice(0, 80) + '...';
      // Skip irrelevant ALL_CAPS imports
      if (/^(true|false|null|undefined|require|import)/i.test(value)) continue;
      // Only record if it looks meaningful (MAX_/MIN_/DEFAULT_/ERR_/MSG_/REGEX_)
      if (!/^(MAX|MIN|DEFAULT|ERR|MSG|REGEX|LIMIT|TIMEOUT|CACHE|API|PATH|TOKEN|KEY|RULE|TYPE|STATUS)_/.test(name)) continue;
      recordConstant(route, { name, value, sourceFile });
    }
  }

  // 6. Error codes
  for (const m of content.matchAll(ERROR_CODE_RE)) {
    recordError(route, { code: m[2], message: null, sourceFile });
  }

  // 7. Conditional disable / hide (templates)
  if (ext === '.html' || ext === '.vue' || ext === '.svelte' || ext === '.tsx' || ext === '.jsx') {
    for (const m of content.matchAll(CONDITIONAL_DISABLE_RE)) {
      const attr = m[1].replace(/[\[\]]/g, '');
      const expr = m[2].trim().slice(0, 100);
      // Filter trivial true/false / static
      if (['true', 'false', '0', '1', 'null'].includes(expr)) continue;
      recordRule(route, { kind: 'conditional-state', attr, expr, sourceFile });
    }
  }
}

// Dedupe + cleanup
for (const r of Object.keys(rulesByRoute)) {
  const route = rulesByRoute[r];

  // Dedupe rules by kind + key fields
  const seen = new Set();
  route.rules = route.rules.filter(rule => {
    const key = [rule.kind, rule.tag || '', rule.text || '', rule.condition || '', rule.message || '', rule.expr || ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Dedupe constants by name+value
  const cseen = new Set();
  route.constants = route.constants.filter(c => {
    const key = c.name + '|' + c.value;
    if (cseen.has(key)) return false;
    cseen.add(key);
    return true;
  });

  // Dedupe error messages
  const eseen = new Set();
  route.errorMessages = route.errorMessages.filter(e => {
    const key = (e.code || '') + '|' + (e.message || '');
    if (eseen.has(key)) return false;
    eseen.add(key);
    return true;
  });

  route.sources = [...route.sources];
}

// Stats
const totalRules = Object.values(rulesByRoute).reduce((s, r) => s + r.rules.length, 0);
const totalConstants = Object.values(rulesByRoute).reduce((s, r) => s + r.constants.length, 0);
const totalErrors = Object.values(rulesByRoute).reduce((s, r) => s + r.errorMessages.length, 0);

const summary = {
  generatedAt: new Date().toISOString(),
  filesScanned: scanned,
  totalRoutes: Object.keys(rulesByRoute).length,
  totalRules,
  totalConstants,
  totalErrors,
  rulesByRoute,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  filesScanned: scanned,
  routes: Object.keys(rulesByRoute).length,
  totalRules,
  totalConstants,
  totalErrors,
  topRoutes: Object.entries(rulesByRoute)
    .map(([k, v]) => ({
      route: k,
      rules: v.rules.length,
      constants: v.constants.length,
      errors: v.errorMessages.length,
      sampleTags: v.rules.filter(r => r.kind === 'tagged-comment').slice(0, 3).map(r => r.tag),
    }))
    .sort((a, b) => (b.rules + b.constants + b.errors) - (a.rules + a.constants + a.errors))
    .slice(0, 10),
}, null, 2));
