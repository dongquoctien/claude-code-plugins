#!/usr/bin/env node
// Extract user-visible text strings + inline color hints from a prototype
// snapshot (.txt for Chrome DevTools, .md for Playwright) AND/OR source
// findings JSON (from parse-prototype-source.mjs).
//
// v1.0.0 — feeds plan.i18n.keys[] auto-suggestions and flags color/styling
// drift between prototype and project design tokens.
//
// Output JSON:
//   {
//     textStrings: [{ text, role, context, source, line }],     // user-visible labels
//     colorHints: [{ color, kind: 'fg'|'bg'|'border', context, source, line }],
//     stats: { totalTexts, totalColors, sourcesScanned }
//   }
//
// Usage:
//   node extract-prototype-text.mjs --in <abs-path-to-snapshot-or-source>
//                                   [--in <another>] ...
//                                   [--feature <kebab>]    # for i18n key prefix hint

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function allArgs(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && i + 1 < process.argv.length) out.push(process.argv[i + 1]);
  }
  return out;
}

const inFiles = allArgs('--in');
const FEATURE = arg('--feature', '');

if (inFiles.length === 0) {
  console.error(JSON.stringify({ error: 'No --in given' }));
  process.exit(1);
}

const textStrings = [];
const colorHints = [];
const seenTexts = new Set();
const seenColors = new Set();
let sourcesScanned = 0;

// ─── Skip noise — common UI labels that don't need i18n keys ───────────
const NOISE_TEXTS = new Set([
  '●', '○', '✓', '✗', '✕', '×', '+', '-', '→', '←', '↑', '↓', '...',
  'Logout', 'Login', 'English', 'Change Password',
  'Toggle sidebar',
]);

// ─── Role filter — only roles that typically have user-facing text ─────
const RELEVANT_ROLES = new Set([
  'button', 'link', 'heading', 'StaticText',
  'tab', 'alert', 'cell',
]);

// ─── Color regex ────────────────────────────────────────────────────────
const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_COLOR_RE = /rgb(?:a)?\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;

// ─── Snapshot parser (Chrome DevTools .txt format) ─────────────────────
// Format per line: `<indent>uid=X_Y <role> "<label>" <attrs>`
function parseChromeSnapshot(text, sourceLabel) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Extract role and label
    const m = line.match(/^\s*uid=[\w_]+\s+(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?/);
    if (!m) continue;
    const [, role, label] = m;
    if (!label) continue;
    if (!RELEVANT_ROLES.has(role)) continue;
    if (NOISE_TEXTS.has(label.trim())) continue;
    if (label.trim().length < 2) continue;
    if (/^\d+$/.test(label.trim())) continue;   // pure numbers — likely counts, not i18n

    // Skip nodes inside non-feature chrome (banner/sidebar/navigation/complementary)
    const ctx = extractParentContext(lines, i);
    if (/banner|complementary|navigation/i.test(ctx) &&
        !/dialog|main:V\.Comm|main:Period/i.test(ctx)) {
      continue;
    }

    const key = `${role}::${label}`;
    if (seenTexts.has(key)) continue;
    seenTexts.add(key);

    textStrings.push({
      text: label,
      role,
      context: ctx,
      source: sourceLabel,
      line: i + 1,
    });
  }

  // Extract colors from anywhere in the snapshot (rare but possible if styling info leaks through)
  extractColors(text, sourceLabel);
}

// ─── Snapshot parser (Playwright .md format) ───────────────────────────
// Format: indented dash-prefixed lines, e.g.:
//   - button "Save" [ref=e15] [cursor=pointer]:
//   - heading "Period-Based V.Comm" [level=2]
function parsePlaywrightSnapshot(text, sourceLabel) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*-\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/);
    if (!m) continue;
    const [, role, label] = m;
    if (!RELEVANT_ROLES.has(role) && !['generic'].includes(role)) {
      // Playwright sometimes labels heading + button + link distinctly. Generic catches StaticText analog.
      if (role !== 'generic') continue;
    }
    if (NOISE_TEXTS.has(label.trim())) continue;
    if (label.trim().length < 2) continue;
    if (/^\d+$/.test(label.trim())) continue;

    const key = `${role}::${label}`;
    if (seenTexts.has(key)) continue;
    seenTexts.add(key);

    textStrings.push({
      text: label,
      role,
      context: extractParentContextPlaywright(lines, i),
      source: sourceLabel,
      line: i + 1,
    });
  }

  extractColors(text, sourceLabel);
}

// ─── Source findings parser (from parse-prototype-source.mjs JSON) ─────
function parseSourceFindings(text, sourceLabel) {
  let data;
  try { data = JSON.parse(text); }
  catch { return; }
  // Components may have prop values that are user-visible strings — extract literal string props
  if (Array.isArray(data.components)) {
    for (const c of data.components) {
      // Component props are just names in this format; literal values not captured.
      // Skip — source parser doesn't preserve string-literal prop values.
    }
  }
  // No direct text strings in source findings — but colors might be referenced
  // via inline style attribute somehow. Skip for now; source parsing is mostly
  // for handler/state extraction.
}

// ─── Color extractor (works on any text) ───────────────────────────────
function extractColors(text, sourceLabel) {
  let m;
  HEX_COLOR_RE.lastIndex = 0;
  while ((m = HEX_COLOR_RE.exec(text)) !== null) {
    const color = m[0].toLowerCase();
    if (seenColors.has(color)) continue;
    // Filter common transparent / shorthand placeholders
    if (color === '#000' || color === '#fff' || color === '#000000' || color === '#ffffff') continue;
    seenColors.add(color);
    // Determine context — peek at surrounding text
    const surroundStart = Math.max(0, m.index - 50);
    const surrounds = text.slice(surroundStart, m.index + 50);
    let kind = 'unknown';
    if (/background|bg-|fill/i.test(surrounds)) kind = 'bg';
    else if (/border|stroke/i.test(surrounds)) kind = 'border';
    else if (/color|text-|fg-/i.test(surrounds)) kind = 'fg';
    colorHints.push({
      color,
      kind,
      context: surrounds.replace(/\s+/g, ' ').trim().slice(0, 80),
      source: sourceLabel,
      line: text.slice(0, m.index).split('\n').length,
    });
  }
  RGB_COLOR_RE.lastIndex = 0;
  while ((m = RGB_COLOR_RE.exec(text)) !== null) {
    const color = m[0].toLowerCase().replace(/\s+/g, '');
    if (seenColors.has(color)) continue;
    seenColors.add(color);
    colorHints.push({
      color,
      kind: 'unknown',
      context: '',
      source: sourceLabel,
      line: text.slice(0, m.index).split('\n').length,
    });
  }
}

// ─── Parent context helpers (use ancestor labels for i18n key composition) ─

function extractParentContext(lines, idx) {
  // Walk backwards; track parent labels by decreasing indent
  const me = lines[idx].match(/^(\s*)/)[1].length;
  const ancestors = [];
  for (let j = idx - 1; j >= 0 && ancestors.length < 3; j--) {
    const m = lines[j].match(/^(\s*)uid=[\w_]+\s+(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?/);
    if (!m) continue;
    const indent = m[1].length;
    if (indent < me) {
      const role = m[2];
      const label = m[3];
      if (label) ancestors.push(`${role}:${label.slice(0, 30)}`);
      else if (role) ancestors.push(role);
    }
  }
  return ancestors.reverse().join(' > ');
}

function extractParentContextPlaywright(lines, idx) {
  const me = lines[idx].match(/^(\s*)/)[1].length;
  const ancestors = [];
  for (let j = idx - 1; j >= 0 && ancestors.length < 3; j--) {
    const m = lines[j].match(/^(\s*)-\s+(\S+)(?:\s+"((?:[^"\\]|\\.)*)")?/);
    if (!m) continue;
    const indent = m[1].length;
    if (indent < me) {
      const role = m[2];
      const label = m[3];
      if (label) ancestors.push(`${role}:${label.slice(0, 30)}`);
      else if (role) ancestors.push(role);
    }
  }
  return ancestors.reverse().join(' > ');
}

// ─── i18n key suggestion ────────────────────────────────────────────────
function suggestI18nKey(text, role, context) {
  // Dot-path: feature.section.role-or-purpose.shortText
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const sectionHint = context.match(/dialog|section|drawer|modal/i)?.[0]?.toLowerCase() || '';
  const featurePart = FEATURE
    ? FEATURE.replace(/-/g, '').replace(/^(\w)/, (_, c) => c.toLowerCase())
    : 'feature';
  const sectionPart = sectionHint || role || 'common';
  return `${featurePart}.${sectionPart}.${slug}`.replace(/-/g, '_');
}

// ─── Drive ─────────────────────────────────────────────────────────────
for (const f of inFiles) {
  const abs = path.resolve(f);
  if (!fs.existsSync(abs)) continue;
  sourcesScanned++;
  const content = fs.readFileSync(abs, 'utf8');
  const ext = path.extname(abs).toLowerCase();
  const sourceLabel = path.basename(abs);

  if (ext === '.txt' && /^uid=/m.test(content)) {
    parseChromeSnapshot(content, sourceLabel);
  } else if (ext === '.md' && /^\s*-\s+\w+\s+"/m.test(content)) {
    parsePlaywrightSnapshot(content, sourceLabel);
  } else if (ext === '.json') {
    parseSourceFindings(content, sourceLabel);
  } else {
    // Unknown — try color extraction anyway
    extractColors(content, sourceLabel);
  }
}

// Annotate text strings with i18n key suggestions
const textsWithKeys = textStrings.map(t => ({
  ...t,
  suggestedI18nKey: suggestI18nKey(t.text, t.role, t.context),
}));

console.log(JSON.stringify({
  textStrings: textsWithKeys,
  colorHints,
  stats: {
    totalTexts: textsWithKeys.length,
    totalColors: colorHints.length,
    sourcesScanned,
  },
}, null, 2));
