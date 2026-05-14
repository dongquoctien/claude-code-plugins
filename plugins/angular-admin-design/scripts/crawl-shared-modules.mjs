#!/usr/bin/env node
// Walk src/app/shared/modules/* and parse every *.component.ts to produce
// a structured entry: { name, selector, inputs[], outputs[], implementsCVA, kind, moduleName, modulePath }.
//
// Output: JSON array to stdout.
//
// Usage:
//   node crawl-shared-modules.mjs --in <project-root> --shared-path <relative-path>

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const SHARED_PATH = arg('--shared-path', 'src/app/shared/modules');
const SHARED_ABS = path.join(ROOT, SHARED_PATH);

if (!fs.existsSync(SHARED_ABS)) {
  console.error(JSON.stringify({ error: `Shared modules path not found: ${SHARED_ABS}` }));
  process.exit(1);
}

const warnings = [];
const entries = [];

// ─── Parse helpers ─────────────────────────────────────────────────────
// We don't run TS — use regex. Each pattern is narrow enough to handle
// Angular 9 component code without false positives in 90% of cases.
// Anything weird gets reported in `warnings`.

function readFile(abs) {
  try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
}

function rel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }

function parseSelector(src) {
  const m = src.match(/@Component\s*\(\s*\{[\s\S]*?selector\s*:\s*['"`]([^'"`]+)['"`]/);
  return m ? m[1] : null;
}

function parseClassName(src, fileBaseName) {
  // Prefer `export class XxxComponent`
  const m = src.match(/export\s+class\s+([A-Z][A-Za-z0-9_]*Component)\b/);
  if (m) return m[1];
  // Fallback from filename: foo-bar.component.ts → FooBarComponent
  const base = fileBaseName.replace(/\.component\.ts$/, '');
  return base.split(/[-_]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('') + 'Component';
}

function parseImplementsCVA(src) {
  return /ControlValueAccessor/.test(src) || /NG_VALUE_ACCESSOR/.test(src);
}

function parseInputs(src) {
  // Form 1: simple field — "@Input() name: type;" or "@Input() name = default;"
  // Form 2: getter/setter — "@Input() get foo(): T {...} ... set foo(val: T) {...}"
  // Form 3: aliased — "@Input('alias') name"
  const inputs = [];
  const seen = new Set();
  // Combined regex catches: optional alias, optional get/set keyword, identifier, optional ?, optional : type
  const re = /@Input\s*\(\s*(?:['"`]([^'"`]+)['"`])?\s*\)\s*(?:public\s+|private\s+|protected\s+)?(get\s+|set\s+)?([a-zA-Z_$][\w$]*)\s*(\??)\s*(?::\s*([^=;{)\n]+))?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, alias, accessor, ident, q, typeRaw] = m;
    const name = alias || ident;
    if (seen.has(name) && accessor === 'set ') continue; // skip the setter sibling
    seen.add(name);
    inputs.push({
      name,
      type: typeRaw ? typeRaw.trim() : null,
      required: q !== '?', // Angular 9 has no Input({required:true}); use ? as a heuristic
      kind: accessor ? 'getter-setter' : 'field',
    });
  }
  return inputs;
}

function parseOutputs(src) {
  // "@Output() name = new EventEmitter<T>();"  (T optional)
  const outputs = [];
  const re = /@Output\s*\(\s*(?:['"`]([^'"`]+)['"`])?\s*\)\s*(?:public\s+|private\s+|protected\s+)?([a-zA-Z_$][\w$]*)\s*(?::\s*EventEmitter\s*<([^>]+)>)?\s*=\s*new\s+EventEmitter\s*<?([^>(\s]+)?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, alias, ident, type1, type2] = m;
    outputs.push({ name: alias || ident, type: (type1 || type2 || 'any').trim() });
  }
  return outputs;
}

function classifyKind(name, selector, implementsCVA) {
  const n = (selector || name || '').toLowerCase();
  if (implementsCVA) {
    if (/grid/.test(n)) return 'grid';
    if (/dialog|modal/.test(n)) return 'dialog';
    return 'form-control';
  }
  if (/grid|table/.test(n)) return 'grid';
  if (/dialog|modal|popup/.test(n)) return 'dialog';
  if (/tab|sidebar|header|footer|nav/.test(n)) return 'layout';
  if (/picker|input|select|dropdown|radio|checkbox|switch|slider/.test(n)) return 'input';
  if (/badge|chip|alert|toast|tooltip|icon|avatar|card|list/.test(n)) return 'data-display';
  return 'other';
}

function findModuleFile(moduleDir) {
  // Pick the *.module.ts in this folder, if any.
  const files = fs.readdirSync(moduleDir).filter(f => f.endsWith('.module.ts'));
  if (files.length === 0) return null;
  return files[0];
}

function parseModuleName(moduleSrc, fallback) {
  const m = moduleSrc && moduleSrc.match(/export\s+class\s+([A-Z][A-Za-z0-9_]*Module)\b/);
  return m ? m[1] : fallback;
}

function suggestSummary(name, kind, inputs) {
  const cleanName = name.replace(/Component$/, '');
  const pretty = cleanName.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  if (kind === 'form-control') return `Reusable form control: ${pretty}.`;
  if (kind === 'grid') return `Reusable grid wrapper: ${pretty}.`;
  if (kind === 'dialog') return `Reusable dialog/modal: ${pretty}.`;
  if (kind === 'input') return `Reusable input widget: ${pretty}.`;
  if (kind === 'layout') return `Layout component: ${pretty}.`;
  return `Shared component: ${pretty}.`;
}

// ─── Walk shared/modules ────────────────────────────────────────────────
const moduleDirs = fs.readdirSync(SHARED_ABS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

for (const mod of moduleDirs) {
  const modDir = path.join(SHARED_ABS, mod);
  // Each module can have N components; index each.
  const allFiles = fs.readdirSync(modDir);
  const compFiles = allFiles.filter(f => f.endsWith('.component.ts'));
  if (compFiles.length === 0) continue;

  const moduleFile = findModuleFile(modDir);
  const moduleSrc = moduleFile ? readFile(path.join(modDir, moduleFile)) : null;
  const moduleName = parseModuleName(moduleSrc, null);
  const modulePath = moduleFile
    ? rel(path.join(modDir, moduleFile)).replace(/\.ts$/, '')
    : null;

  for (const cf of compFiles) {
    const abs = path.join(modDir, cf);
    const src = readFile(abs);
    if (!src) { warnings.push(`Unreadable file: ${rel(abs)}`); continue; }
    if (!/@Component\s*\(/.test(src)) continue;
    const className = parseClassName(src, cf);
    const selector = parseSelector(src);
    if (!selector) { warnings.push(`No selector parsed in ${rel(abs)}`); }
    const implementsCVA = parseImplementsCVA(src);
    const inputs = parseInputs(src);
    const outputs = parseOutputs(src);
    const kind = classifyKind(className, selector, implementsCVA);

    entries.push({
      name: className,
      selector,
      moduleName,
      modulePath,
      componentPath: rel(abs),
      inputs,
      outputs,
      implementsCVA,
      kind,
      summary: suggestSummary(className, kind, inputs),
    });
  }
}

console.log(JSON.stringify({ entries, warnings }, null, 2));
