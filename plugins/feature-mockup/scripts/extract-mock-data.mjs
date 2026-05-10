#!/usr/bin/env node
// Extract mock-data candidates from source service files: any hardcoded array
// of objects in *.ts files (Korean enterprise admins frequently keep label
// lists, status maps, dropdown options as in-source arrays).
//
// Output: per-route { entityName: [...records] } so the prototype can seed
// realistic mock data without inventing values.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './mock-data-detection.json'));
const SRC = arg('--src', 'src');
const MAX_RECORDS_PER_ARRAY = Number(arg('--max-records', '20'));

if (!fs.existsSync(path.join(ROOT, SRC))) {
  console.error('source dir not found:', path.join(ROOT, SRC));
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
function routeOf(p) {
  const m = p.match(/[\\/]routes[\\/]([^\\/]+)[\\/]/);
  return m ? m[1] : null;
}

// Match named exports of arrays of objects:
//   export const foo = [ { ... }, { ... } ];
//   const FOO_LIST: SomeType[] = [ { ... } ];
//   public bar: { code: string; label: string }[] = [ {...}, {...} ];
const ARRAY_OF_OBJECTS_RE = /(?:export\s+)?(?:const|let|var|public|private|readonly|static)?\s*(\w{2,40})\s*(?::[^=]+)?\s*=\s*\[\s*\{([\s\S]*?)\}\s*(?:,\s*\{([\s\S]*?)\}\s*)*\]/g;

// Lighter pattern: just find array literals with at least 2 object entries
// and capture the variable name.
const SIMPLE_ARRAY_RE = /(?:export\s+)?(?:const|let|var|public|private|readonly|static)\s+(\w{2,40})\s*(?::\s*[\w<>,[\]\s|]+)?\s*=\s*(\[[\s\S]*?\]);/g;

function tryParseLiteralArray(text) {
  // Naive JSON-ish parser: replace single quotes with double quotes,
  // strip TypeScript "as Foo" casts, drop trailing commas, drop // comments.
  let cleaned = text
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\bas\s+\w+(\.\w+)*/g, '')
    .replace(/'/g, '"')
    .replace(/,(\s*[\]}])/g, '$1');
  // Convert unquoted keys: { foo: 'bar' } → { "foo": "bar" }
  cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":');
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

const dataByRoute = {};
let scanned = 0;
const SCAN_LIMIT = 4000;

for (const file of walk(path.join(ROOT, SRC))) {
  const ext = path.extname(file).toLowerCase();
  if (!['.ts', '.tsx'].includes(ext)) continue;
  if (scanned >= SCAN_LIMIT) break;
  scanned++;

  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (content.length > 200000) content = content.slice(0, 200000);

  const route = routeOf(file) || '_global';

  // Find arrays of objects via the simpler pattern, then parse with the literal parser.
  for (const m of content.matchAll(SIMPLE_ARRAY_RE)) {
    const name = m[1];
    const arrayText = m[2];
    if (!arrayText.includes('{')) continue;       // skip primitive arrays
    if (arrayText.length < 30) continue;          // skip trivially small
    if (arrayText.length > 50000) continue;        // skip huge

    const parsed = tryParseLiteralArray(arrayText);
    if (!parsed) continue;
    if (parsed.length < 2) continue;

    if (!dataByRoute[route]) dataByRoute[route] = { entities: {}, sources: new Set() };
    if (!dataByRoute[route].entities[name]) {
      dataByRoute[route].entities[name] = {
        sourceFile: rel(file),
        records: parsed.slice(0, MAX_RECORDS_PER_ARRAY),
        recordCount: parsed.length,
        truncated: parsed.length > MAX_RECORDS_PER_ARRAY,
        keys: parsed[0] && typeof parsed[0] === 'object' ? Object.keys(parsed[0]) : [],
      };
      dataByRoute[route].sources.add(rel(file));
    }
  }
}

// Convert sets to arrays for JSON
for (const r of Object.keys(dataByRoute)) {
  dataByRoute[r].sources = [...dataByRoute[r].sources];
}

const totalEntities = Object.values(dataByRoute).reduce((s, r) => s + Object.keys(r.entities).length, 0);
const totalRecords = Object.values(dataByRoute).reduce((s, r) => s + Object.values(r.entities).reduce((a, e) => a + e.recordCount, 0), 0);

const summary = {
  generatedAt: new Date().toISOString(),
  filesScanned: scanned,
  totalRoutes: Object.keys(dataByRoute).length,
  totalEntities,
  totalRecords,
  dataByRoute,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  filesScanned: scanned,
  routes: Object.keys(dataByRoute).length,
  totalEntities,
  totalRecords,
  topRoutes: Object.entries(dataByRoute)
    .map(([k, v]) => ({
      route: k,
      entityCount: Object.keys(v.entities).length,
      sampleEntities: Object.keys(v.entities).slice(0, 5),
    }))
    .sort((a, b) => b.entityCount - a.entityCount)
    .slice(0, 10),
}, null, 2));
