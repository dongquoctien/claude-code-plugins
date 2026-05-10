#!/usr/bin/env node
// Extract per-route UI patterns from real source templates so the BA-side
// prototype-builder doesn't have to hardcode admin shell defaults.
//
// Output route-patterns.json with three sections:
//   1. filterGrids   — per-route detected filter-area grid columns
//                      (parsed from *-search.component.html / filter templates)
//   2. cellPatterns  — per-route grid cell shape: primary line + secondary line
//                      sample text (e.g. BK-2026-0142 / 1128814857440366)
//                      so prototype renders realistic two-line cells
//   3. routePrefixGroups — auto-derived domain prefix → group name map
//                      from manifest.stack.routes list. No hardcoded
//                      ho-→Hotels, bs-→System fallbacks.
//
// Multi-stack: Angular templates, Vue SFC <template>, React JSX.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './route-patterns.json'));
import { resolveSrcRoots, routeOf as routeOfFile } from './_lib/src-roots.mjs';
const { roots: SRC_ROOTS, primary: SRC } = resolveSrcRoots(ROOT, arg('--src', 'src'));

if (!SRC) {
  console.error('source dir not found:', path.join(ROOT, arg('--src', 'src')));
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

const routeOf = routeOfFile;

// ─── 1. Filter grid columns ──────────────────────────────────────────────
// Parse *-search.component.html / filter-area templates for label/control
// pairs. Output the grid-template-columns value to use for each route.
//
// Heuristic:
//   • A label cell is `<label>...</label>` or `<th>...` or `<dt>...`
//   • A control cell is the next <input>, <select>, <kendo-combobox>,
//     <ng-select>, <kendo-datepicker> sibling
//   • Count label/control pairs per row by detecting `<tr>` / `<div class="filter-row">`
//   • Output `90px 240px` repeated by pair count

function detectFilterGrid(html) {
  // Strategy: count matching label-control pairs per row, return template
  // string. We approximate by counting label tokens between <tr> / form-row
  // boundaries.
  const rowMatches = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>|<div[^>]*class="[^"]*(?:filter-row|form-row|search-row)[^"]*"[\s\S]*?<\/div>/gi);
  if (!rowMatches || rowMatches.length === 0) return null;

  const pairCounts = rowMatches.map(row => {
    const labels = (row.match(/<(?:label|th|dt)\b[^>]*>/gi) || []).length;
    return labels;
  }).filter(n => n > 0);

  if (pairCounts.length === 0) return null;
  const maxPairs = Math.max(...pairCounts);
  if (maxPairs > 6) return null; // unlikely a filter grid past 6 pairs/row

  // Default: 90px label, 240px control. Slightly wider for date/range columns.
  const widePairs = (html.match(/datepicker|date-range|range-picker/gi) || []).length;
  const labelW = 90, controlW = widePairs > 0 ? 260 : 240;
  const cells = [];
  for (let i = 0; i < maxPairs; i++) cells.push(`${labelW}px`, `${controlW}px`);
  return {
    template: cells.join(' '),
    pairsPerRow: maxPairs,
    rowCount: rowMatches.length,
  };
}

// ─── 2. Cell secondary-line patterns ─────────────────────────────────────
// Parse Kendo grid columns / table cells for two-line patterns:
//   <div>{{row.primary}}</div>
//   <div class="row-line2">{{row.secondary}}</div>
// or `*ngIf` containing both. Emit the column field name + a guess at the
// shape (id-like, numeric, mixed) for the prototype to use.

function detectCellPatterns(html) {
  const cols = [];
  const colRe = /<kendo-grid-column[^>]*field="([^"]+)"[^>]*>([\s\S]*?)<\/kendo-grid-column>/gi;
  let m;
  while ((m = colRe.exec(html)) !== null) {
    const field = m[1];
    const inner = m[2];
    const hasTwoLines =
      /class="[^"]*row-line2[^"]*"/.test(inner) ||
      (inner.match(/<(?:div|span|p)\b/gi) || []).length >= 2;
    if (hasTwoLines) {
      cols.push({ field, twoLine: true });
    }
  }
  return cols;
}

// ─── 3. Route prefix → group ─────────────────────────────────────────────
// Derive group names from prefix frequency. If many routes share `ho-`
// prefix, that prefix is its own group. Group name comes from a heuristic:
// look up the longest substring shared by routes in that prefix and Title-Case
// it. Fallback to UPPER(prefix).

function deriveRoutePrefixGroups(routeNames) {
  const byPrefix = {};
  for (const name of routeNames) {
    const m = name.match(/^([a-z]{2,4})-/);
    if (!m) continue;
    const p = m[1];
    if (!byPrefix[p]) byPrefix[p] = [];
    byPrefix[p].push(name);
  }
  // Only keep prefixes shared by >=2 routes
  const groups = {};
  for (const [prefix, list] of Object.entries(byPrefix)) {
    if (list.length < 2) continue;
    // Try to derive a group label from common keywords in the route names
    const stripped = list.map(n => n.slice(prefix.length + 1));
    // Pick a representative word: most common first-word of the stripped names
    const wordFreq = {};
    for (const n of stripped) {
      const w = n.split('-')[0];
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
    const rep = Object.entries(wordFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || prefix;
    const label = rep.charAt(0).toUpperCase() + rep.slice(1);
    groups[prefix] = {
      label: label + 's', // pluralize naively
      routeCount: list.length,
      sample: list.slice(0, 3),
    };
  }
  return groups;
}

// ─── Walk source ─────────────────────────────────────────────────────────
const filterGrids = {};
const cellPatterns = {};
const routesSeen = new Set();
function* walkAll() { for (const r of SRC_ROOTS) yield* walk(path.join(ROOT, r)); }

for (const file of walkAll()) {
  const route = routeOf(file);
  if (route) routesSeen.add(route);

  const isTemplate =
    file.endsWith('.component.html') ||
    file.endsWith('.vue') ||
    file.endsWith('.svelte') ||
    file.endsWith('.astro') ||
    /\.(tsx|jsx)$/.test(file);
  if (!isTemplate) continue;

  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }

  const isSearchTemplate =
    /search\.component\.html$/.test(file) ||
    /filter\.component\.html$/.test(file) ||
    /\bfilter-area\b/.test(content) ||
    /<form[^>]*search/i.test(content);

  if (route && isSearchTemplate) {
    const grid = detectFilterGrid(content);
    if (grid && !filterGrids[route]) filterGrids[route] = grid;
  }

  if (route && /grid\.component\.html$/.test(file)) {
    const cols = detectCellPatterns(content);
    if (cols.length > 0) {
      cellPatterns[route] = (cellPatterns[route] || []).concat(cols);
    }
  }
}

const routePrefixGroups = deriveRoutePrefixGroups([...routesSeen]);

const out = {
  extractedAt: new Date().toISOString(),
  routesScanned: routesSeen.size,
  filterGrids,
  cellPatterns,
  routePrefixGroups,
  stats: {
    routesWithFilterGrid: Object.keys(filterGrids).length,
    routesWithCellPattern: Object.keys(cellPatterns).length,
    prefixGroups: Object.keys(routePrefixGroups).length,
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(out.stats, null, 2));
