#!/usr/bin/env node
// Scan a project's *.ts files for Angular reactive form Validators and Vue/React
// equivalent validation patterns, plus class-validator @Decorator usage.
// Output: per-form-control validation rules so the prototype can reproduce them.

import fs from 'node:fs';
import path from 'node:path';
import { resolveSrcRoots, routeOf as routeOfFile } from './_lib/src-roots.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './validators-detection.json'));
const { roots: SRC_ROOTS, primary: SRC } = resolveSrcRoots(ROOT, arg('--src', 'src'));

if (!SRC) {
  console.error('source dir not found:', path.join(ROOT, arg('--src', 'src')));
  process.exit(1);
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'out', '.git', 'coverage']);
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

// Use shared multi-framework router resolver
const routeOf = routeOfFile;

// Match Angular reactive form patterns:
//   email: ['', [Validators.required, Validators.email]],
//   age: new FormControl(0, [Validators.min(18), Validators.max(99)]),
const NG_FORMCONTROL_RE = /(['"]?)(\w+)\1\s*:\s*(?:new\s+FormControl\s*\(|\[)\s*(?:[^,\]]+,\s*)?\[([^\]]+)\]/g;
const NG_VALIDATOR_RE = /Validators\.(\w+)(?:\((['"]?)([^'")]+)\2?\))?/g;

// Match class-validator decorators on a field:
//   @IsEmail()  email: string;
//   @MinLength(8)  password: string;
const CLASS_VALIDATOR_RE = /@(Is\w+|MinLength|MaxLength|Min|Max|Length|Matches|IsNotEmpty|IsOptional|IsEnum|IsDate)(?:\(([^)]*)\))?[\s\S]{0,200}?(\w+)\s*[?:]?\s*(string|number|boolean|Date|any)/g;

// HTML attributes signal validation too: required, type=email, pattern=, minlength=
const HTML_REQUIRED_RE = /<(input|textarea|select)\b([^>]*\brequired\b[^>]*)>/g;
const HTML_TYPE_EMAIL_RE = /<input\b([^>]*\btype=["']email["'][^>]*)>/g;
const HTML_PATTERN_RE = /<(input|textarea)\b([^>]*\bpattern=["']([^"']+)["'][^>]*)>/g;
const HTML_MINLENGTH_RE = /<(input|textarea)\b([^>]*\bminlength=["'](\d+)["'][^>]*)>/g;
const HTML_NAME_RE = /\b(name|formControlName|id)=["']([^"']+)["']/;

const validatorsByRoute = {};
let scannedTs = 0, scannedHtml = 0;
const SCAN_LIMIT = 5000;

function* walkAll() { for (const r of SRC_ROOTS) yield* walk(path.join(ROOT, r)); }

for (const file of walkAll()) {
  const ext = path.extname(file).toLowerCase();
  // Add .jsx + .vue + .svelte + .astro so framework-specific schemas are caught too
  if (!['.ts', '.tsx', '.jsx', '.html', '.vue', '.svelte', '.astro'].includes(ext)) continue;
  if (scannedTs + scannedHtml >= SCAN_LIMIT) break;

  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (content.length > 200000) content = content.slice(0, 200000);

  const route = routeOf(file) || '_global';
  if (!validatorsByRoute[route]) validatorsByRoute[route] = { fields: {}, sources: new Set() };

  if (ext === '.ts' || ext === '.tsx') {
    scannedTs++;
    // Angular reactive forms: name: ['', [Validators.required, Validators.email]]
    for (const m of content.matchAll(NG_FORMCONTROL_RE)) {
      const fieldName = m[2];
      const validatorBlock = m[3];
      const rules = [];
      for (const v of validatorBlock.matchAll(NG_VALIDATOR_RE)) {
        const kind = v[1];
        const arg = v[3];
        rules.push({ type: mapValidatorKind(kind), value: arg, source: 'angular-validators' });
      }
      if (rules.length > 0) {
        if (!validatorsByRoute[route].fields[fieldName]) validatorsByRoute[route].fields[fieldName] = [];
        validatorsByRoute[route].fields[fieldName].push(...rules);
        validatorsByRoute[route].sources.add(rel(file));
      }
    }
    // class-validator decorators
    for (const m of content.matchAll(CLASS_VALIDATOR_RE)) {
      const decorator = m[1];
      const arg = m[2];
      const fieldName = m[3];
      if (!validatorsByRoute[route].fields[fieldName]) validatorsByRoute[route].fields[fieldName] = [];
      validatorsByRoute[route].fields[fieldName].push({
        type: mapDecoratorToType(decorator),
        value: arg,
        source: 'class-validator',
      });
      validatorsByRoute[route].sources.add(rel(file));
    }
  } else if (ext === '.html') {
    scannedHtml++;
    // required attribute
    for (const m of content.matchAll(HTML_REQUIRED_RE)) {
      const tag = m[2];
      const nameMatch = HTML_NAME_RE.exec(tag);
      if (nameMatch) {
        const name = nameMatch[2];
        if (!validatorsByRoute[route].fields[name]) validatorsByRoute[route].fields[name] = [];
        validatorsByRoute[route].fields[name].push({ type: 'required', source: 'html-attr' });
        validatorsByRoute[route].sources.add(rel(file));
      }
    }
    for (const m of content.matchAll(HTML_TYPE_EMAIL_RE)) {
      const tag = m[1];
      const nameMatch = HTML_NAME_RE.exec(tag);
      if (nameMatch) {
        const name = nameMatch[2];
        if (!validatorsByRoute[route].fields[name]) validatorsByRoute[route].fields[name] = [];
        validatorsByRoute[route].fields[name].push({ type: 'email', source: 'html-attr' });
      }
    }
    for (const m of content.matchAll(HTML_PATTERN_RE)) {
      const tag = m[2];
      const pattern = m[3];
      const nameMatch = HTML_NAME_RE.exec(tag);
      if (nameMatch) {
        const name = nameMatch[2];
        if (!validatorsByRoute[route].fields[name]) validatorsByRoute[route].fields[name] = [];
        validatorsByRoute[route].fields[name].push({ type: 'pattern', value: pattern, source: 'html-attr' });
      }
    }
    for (const m of content.matchAll(HTML_MINLENGTH_RE)) {
      const tag = m[2];
      const minLen = m[3];
      const nameMatch = HTML_NAME_RE.exec(tag);
      if (nameMatch) {
        const name = nameMatch[2];
        if (!validatorsByRoute[route].fields[name]) validatorsByRoute[route].fields[name] = [];
        validatorsByRoute[route].fields[name].push({ type: 'minLength', value: minLen, source: 'html-attr' });
      }
    }
  }
}

// De-dup rules per field + convert source Sets to arrays
function dedup(rules) {
  const seen = new Set();
  return rules.filter(r => {
    const key = r.type + '|' + (r.value || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
for (const r of Object.keys(validatorsByRoute)) {
  for (const f of Object.keys(validatorsByRoute[r].fields)) {
    validatorsByRoute[r].fields[f] = dedup(validatorsByRoute[r].fields[f]);
  }
  validatorsByRoute[r].sources = [...validatorsByRoute[r].sources];
}

function mapValidatorKind(kind) {
  const k = kind.toLowerCase();
  if (k === 'required') return 'required';
  if (k === 'email') return 'email';
  if (k === 'min') return 'min';
  if (k === 'max') return 'max';
  if (k === 'minlength') return 'minLength';
  if (k === 'maxlength') return 'maxLength';
  if (k === 'pattern') return 'pattern';
  if (k === 'requiredtrue') return 'requiredTrue';
  if (k === 'nullvalidator') return null;
  return kind;
}
function mapDecoratorToType(d) {
  if (d === 'IsNotEmpty') return 'required';
  if (d === 'IsEmail') return 'email';
  if (d === 'MinLength') return 'minLength';
  if (d === 'MaxLength') return 'maxLength';
  if (d === 'Min') return 'min';
  if (d === 'Max') return 'max';
  if (d === 'Length') return 'length';
  if (d === 'Matches') return 'pattern';
  if (d === 'IsDate') return 'date';
  if (d === 'IsEnum') return 'enum';
  return d;
}

// Emit
const totalFields = Object.values(validatorsByRoute).reduce((s, r) => s + Object.keys(r.fields).length, 0);
const totalRules = Object.values(validatorsByRoute).reduce((s, r) => s + Object.values(r.fields).reduce((a, rules) => a + rules.length, 0), 0);

const summary = {
  generatedAt: new Date().toISOString(),
  filesScanned: scannedTs + scannedHtml,
  totalRoutes: Object.keys(validatorsByRoute).length,
  totalFields,
  totalRules,
  validatorsByRoute,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  filesScanned: scannedTs + scannedHtml,
  routes: Object.keys(validatorsByRoute).length,
  totalFields,
  totalRules,
  topRoutes: Object.entries(validatorsByRoute)
    .map(([k, v]) => ({ route: k, fieldCount: Object.keys(v.fields).length, ruleCount: Object.values(v.fields).reduce((a, r) => a + r.length, 0) }))
    .sort((a, b) => b.ruleCount - a.ruleCount)
    .slice(0, 10),
}, null, 2));
