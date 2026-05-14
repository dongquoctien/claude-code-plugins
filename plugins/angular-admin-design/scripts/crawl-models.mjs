#!/usr/bin/env node
// Walk src/app/**/*.model.ts and *.models.ts to collect I-prefixed interfaces.
// These are the fallback shapes aad-mock uses when there's no captured fixture.
//
// Output: JSON array to stdout.
//
// Usage:
//   node crawl-models.mjs --in <project-root> [--src-path src/app]

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const SRC_PATH = arg('--src-path', 'src/app');
const SRC_ABS = path.join(ROOT, SRC_PATH);

if (!fs.existsSync(SRC_ABS)) {
  console.error(JSON.stringify({ error: `Src path not found: ${SRC_ABS}` }));
  process.exit(1);
}

const warnings = [];
const models = [];

function rel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }
function readFile(abs) { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } }

function walk(dir, depth = 0, acc = []) {
  if (depth > 8) return acc;
  let dirents;
  try { dirents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const d of dirents) {
    if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) walk(abs, depth + 1, acc);
    else if (/\.models?\.ts$/.test(d.name) || d.name === 'models.ts') acc.push(abs);
  }
  return acc;
}

function stripBlockComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseInterfaces(src) {
  // Match `export interface IXxx { ... }` — body is balanced; we capture the
  // body up to the matching closing brace by scanning manually.
  const out = [];
  const decoded = stripBlockComments(src);
  const re = /export\s+interface\s+(I[A-Z][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*(?:extends\s+[^\{]+)?\{/g;
  let m;
  while ((m = re.exec(decoded)) !== null) {
    const name = m[1];
    const start = re.lastIndex;
    // Find matching closing brace
    let depth = 1;
    let i = start;
    while (i < decoded.length && depth > 0) {
      const ch = decoded[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth !== 0) { warnings.push(`Unbalanced braces in interface ${name}`); continue; }
    const body = decoded.slice(start, i - 1);
    out.push({ name, fields: parseFields(body) });
  }
  return out;
}

function parseFields(body) {
  // Each property is roughly: `name?: type;` or `name: type;`
  // Strip nested braces (sub-interfaces inline) — we count depth and emit at depth=0.
  const lines = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if ((ch === ';' || ch === ',' || ch === '\n') && depth === 0) {
      if (buf.trim()) lines.push(buf.trim());
      buf = '';
    } else buf += ch;
  }
  if (buf.trim()) lines.push(buf.trim());

  const fields = [];
  for (const line of lines) {
    // Skip method-like declarations and decorators
    if (/^\/\//.test(line)) continue;
    const m = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*(.+)$/);
    if (!m) continue;
    const [, name, q, typeRaw] = m;
    if (/^get\s/.test(name) || /^set\s/.test(name)) continue;
    fields.push({
      name,
      type: typeRaw.replace(/\s*$/, '').replace(/;+$/, '').trim(),
      optional: q === '?',
    });
  }
  return fields;
}

const files = walk(SRC_ABS);
for (const f of files) {
  const src = readFile(f);
  if (!src) continue;
  const interfaces = parseInterfaces(src);
  for (const iface of interfaces) {
    models.push({
      name: iface.name,
      path: rel(f),
      fields: iface.fields,
    });
  }
}

console.log(JSON.stringify({ models, warnings, stats: { fileCount: files.length, modelCount: models.length } }, null, 2));
