#!/usr/bin/env node
// Crawl style files and produce a normalized tokens.json.
// Reuses extract-tokens logic where it can; adds SCSS variable parsing.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const SOURCE_TYPE = arg('--type', null);   // tailwind | tokens-json | scss-vars | css-vars
const SOURCE_PATH = arg('--path', null);   // relative to ROOT
const OUT = path.resolve(arg('--out', './tokens.json'));
const GLOBALS_OUT = arg('--globals-out', null);

if (!SOURCE_TYPE || !SOURCE_PATH) {
  console.error('Usage: crawl-styles.mjs --in <root> --type <tailwind|tokens-json|scss-vars|css-vars> --path <relative> --out <tokens.json> [--globals-out <globals.css>]');
  process.exit(2);
}

const DEFAULTS = {
  colors: { primary: '#6366f1', background: '#ffffff', foreground: '#0f172a',
            muted: '#64748b', border: '#e2e8f0', accent: '#6366f1',
            danger: '#dc2626', success: '#16a34a' },
  spacing: { xs: '0.25rem', sm: '0.5rem', md: '1rem', lg: '1.5rem', xl: '2rem' },
  radii: { sm: '0.25rem', md: '0.5rem', lg: '0.75rem' },
  typography: { fontSans: 'Inter, ui-sans-serif, system-ui, sans-serif',
                fontMono: 'ui-monospace, monospace' },
  shadows: { sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)', md: '0 4px 6px -1px rgb(0 0 0 / 0.1)', lg: '0 20px 25px -5px rgb(0 0 0 / 0.1)' },
};

function deepMerge(base, override) {
  const out = { ...base };
  for (const k of Object.keys(override || {})) {
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k])) {
      out[k] = deepMerge(base[k] || {}, override[k]);
    } else if (override[k] !== undefined && override[k] !== null) out[k] = override[k];
  }
  return out;
}

const warnings = [];

// ─── tokens.json ──────────────────────────────────────────────────────
function unwrapSD(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  if ('value' in obj && (typeof obj.value !== 'object' || obj.value === null)) return obj.value;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) out[k] = unwrapSD(obj[k]);
  return out;
}
function fromTokensJson(filePath) {
  const flat = unwrapSD(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  const result = {
    colors: flat.colors || flat.color || {},
    spacing: flat.spacing || flat.space || {},
    radii: flat.radii || flat.radius || flat.borderRadius || {},
    typography: {
      fontSans: flat.typography?.fontSans || flat.fonts?.sans || flat.font?.sans,
      fontMono: flat.typography?.fontMono || flat.fonts?.mono || flat.font?.mono,
    },
    shadows: flat.shadows || flat.shadow || flat.boxShadow || {},
  };
  return result;
}

// ─── tailwind ─────────────────────────────────────────────────────────
async function fromTailwind(filePath) {
  let mod;
  try { mod = await import(pathToFileURL(filePath).href); }
  catch (e) { warnings.push('tailwind import failed: ' + e.message); return {}; }
  const cfg = mod.default || mod;
  const t = cfg?.theme || {};
  const ext = t.extend || {};
  const colors = {};
  const colorsSrc = { ...(t.colors || {}), ...(ext.colors || {}) };
  for (const [k, v] of Object.entries(colorsSrc)) {
    if (typeof v === 'string') colors[k] = v;
    else if (v && typeof v === 'object') {
      const pick = v[500] || v.DEFAULT || Object.values(v)[0];
      if (typeof pick === 'string') colors[k] = pick;
    }
  }
  const spacing = {};
  for (const [k, v] of Object.entries({ ...(t.spacing || {}), ...(ext.spacing || {}) })) {
    if (typeof v === 'string') spacing[k] = v;
  }
  const radii = {};
  for (const [k, v] of Object.entries({ ...(t.borderRadius || {}), ...(ext.borderRadius || {}) })) {
    if (typeof v === 'string') radii[k.toLowerCase().replace('default', 'md')] = v;
  }
  const ff = { ...(t.fontFamily || {}), ...(ext.fontFamily || {}) };
  const typography = {};
  if (ff.sans) typography.fontSans = Array.isArray(ff.sans) ? ff.sans.join(', ') : ff.sans;
  if (ff.mono) typography.fontMono = Array.isArray(ff.mono) ? ff.mono.join(', ') : ff.mono;
  return { colors, spacing, radii, typography, shadows: {} };
}

// ─── SCSS variables ───────────────────────────────────────────────────
// Resolve $variables across imports (one level deep).
function expandScssImports(filePath, depth = 0) {
  if (depth > 2) return '';
  let content = '';
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return ''; }
  const dir = path.dirname(filePath);
  const lines = content.split(/\r?\n/);
  let out = '';
  for (const line of lines) {
    const m = /^\s*@import\s+['"]([^'"]+)['"]\s*;?\s*$/.exec(line);
    if (m) {
      const spec = m[1];
      // skip node_modules / kendo / npm packages
      if (spec.startsWith('~') || spec.startsWith('@')) { out += `// skipped: ${spec}\n`; continue; }
      // try common extensions and underscore prefix
      const tries = [
        spec, spec + '.scss', spec + '.css',
        path.join(path.dirname(spec), '_' + path.basename(spec) + '.scss'),
        path.join(path.dirname(spec), '_' + path.basename(spec)),
      ];
      let resolved = null;
      for (const t of tries) {
        const candidate = path.resolve(dir, t);
        if (fs.existsSync(candidate)) { resolved = candidate; break; }
      }
      if (resolved) out += expandScssImports(resolved, depth + 1) + '\n';
      else out += `// unresolved: ${spec}\n`;
    } else {
      out += line + '\n';
    }
  }
  return out;
}

function fromScssVars(filePath) {
  const expanded = expandScssImports(filePath);
  const vars = {};
  for (const m of expanded.matchAll(/^\s*\$([a-zA-Z0-9_-]+)\s*:\s*([^;!]+?)\s*(?:!default|!important)?\s*;/gm)) {
    vars[m[1].trim().toLowerCase()] = m[2].trim();
  }
  // Also pick up CSS vars in :root
  const cssVars = {};
  for (const r of expanded.matchAll(/:root\s*\{([^}]+)\}/gms)) {
    for (const m of r[1].matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      cssVars[m[1].trim().toLowerCase()] = m[2].trim();
    }
  }
  const all = { ...vars, ...cssVars };
  return classifyVars(all);
}

// ─── CSS variables ────────────────────────────────────────────────────
function fromCssVars(filePath) {
  const css = fs.readFileSync(filePath, 'utf8');
  const vars = {};
  for (const r of css.matchAll(/:root\s*\{([^}]+)\}/gm)) {
    for (const m of r[1].matchAll(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
      vars[m[1].trim().toLowerCase()] = m[2].trim();
    }
  }
  return classifyVars(vars);
}

// Classify a flat var map into the canonical token shape.
function classifyVars(vars) {
  const colors = {};
  const spacing = {};
  const radii = {};
  const typography = {};
  // Heuristic: a value is "color-like" if it's a hex, rgb(...), hsl(...), or named color.
  const COLOR_VALUE_RE = /^(#[0-9a-fA-F]{3,8}|rgb[a]?\(|hsl[a]?\(|var\(--|currentColor|transparent|inherit|initial|unset|black|white|red|blue|green|yellow|gray|grey|orange|purple|pink|cyan|magenta)/i;
  // A value is "size-like" if it's a number with a CSS unit.
  const SIZE_VALUE_RE = /^-?\d*\.?\d+(px|rem|em|%|vh|vw|ch|ex|pt|pc|in|cm|mm)?$/i;

  for (const [rawK, rawV] of Object.entries(vars)) {
    // Strip leading $ (SCSS) and leading -- (custom var-style SCSS names like $--primary)
    const k = rawK.replace(/^\$/, '').replace(/^--+/, '');
    const v = rawV.replace(/^var\(--[^)]+\)/, '').trim() || rawV.trim();
    // Reject quoted strings (filenames, font lists handled separately) — they're never color/spacing tokens.
    if (/^['"]/.test(v) && !/^(['"])([^'"]+,\s*)+/.test(v)) continue;
    // colors — name AND value must look like a color
    if (/^(color|primary|secondary|accent|danger|warning|success|info|brand|bg|background|foreground|fg|text|muted|border)/.test(k)
        && COLOR_VALUE_RE.test(v)) {
      let key = k.replace(/^color-/, '').replace(/^bg-?/, 'background').replace(/^fg-?/, 'foreground').replace(/^text-?/, 'foreground');
      if (key === '' || key === 'background-color') key = 'background';
      colors[key] = v;
    } else if (/^(space|spacing|gap|margin|padding)-/.test(k)) {
      const key = k.replace(/^(space|spacing|gap|margin|padding)-/, '');
      spacing[key] = v;
    } else if (/^(radius|border-radius|rounded)/.test(k)) {
      const key = k.replace(/^(radius|border-radius|rounded)-?/, '') || 'md';
      radii[key] = v;
    } else if (/^font-?(family-)?(sans|mono|serif|body|heading)/.test(k)) {
      const m = /^font-?(family-)?(sans|mono|serif|body|heading)/.exec(k);
      if (m && m[2] === 'mono') typography.fontMono = v;
      else if (m) typography.fontSans = v;
    }
  }
  return { colors, spacing, radii, typography };
}

// ─── Generate globals.css for traceability ───────────────────────────
function generateGlobalsCss(extracted) {
  const lines = [':root {'];
  for (const [k, v] of Object.entries(extracted.colors || {})) lines.push(`  --color-${k}: ${v};`);
  for (const [k, v] of Object.entries(extracted.spacing || {})) lines.push(`  --space-${k}: ${v};`);
  for (const [k, v] of Object.entries(extracted.radii || {})) lines.push(`  --radius-${k}: ${v};`);
  if (extracted.typography?.fontSans) lines.push(`  --font-sans: ${extracted.typography.fontSans};`);
  if (extracted.typography?.fontMono) lines.push(`  --font-mono: ${extracted.typography.fontMono};`);
  lines.push('}');
  return lines.join('\n') + '\n';
}

// ─── main ─────────────────────────────────────────────────────────────
async function main() {
  const fullPath = path.resolve(ROOT, SOURCE_PATH);
  if (!fs.existsSync(fullPath)) { console.error('source path not found:', fullPath); process.exit(1); }

  let extracted = {};
  switch (SOURCE_TYPE) {
    case 'tailwind':    extracted = await fromTailwind(fullPath); break;
    case 'tokens-json': extracted = fromTokensJson(fullPath);     break;
    case 'scss-vars':   extracted = fromScssVars(fullPath);       break;
    case 'css-vars':    extracted = fromCssVars(fullPath);        break;
    default: console.error('unknown --type', SOURCE_TYPE); process.exit(2);
  }

  const final = {
    colors:     deepMerge(DEFAULTS.colors,     extracted.colors || {}),
    spacing:    deepMerge(DEFAULTS.spacing,    extracted.spacing || {}),
    radii:      deepMerge(DEFAULTS.radii,      extracted.radii || {}),
    typography: deepMerge(DEFAULTS.typography, extracted.typography || {}),
    shadows:    deepMerge(DEFAULTS.shadows,    extracted.shadows || {}),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(final, null, 2) + '\n', 'utf8');

  if (GLOBALS_OUT) {
    fs.writeFileSync(path.resolve(GLOBALS_OUT), generateGlobalsCss(final), 'utf8');
  }

  // Distinguish what was actually extracted vs filled from defaults
  const extractedCounts = {
    colors: Object.keys(extracted.colors || {}).length,
    spacing: Object.keys(extracted.spacing || {}).length,
    radii: Object.keys(extracted.radii || {}).length,
    typography: Object.keys(extracted.typography || {}).filter(k => extracted.typography[k]).length,
  };
  const totalCounts = {
    colors: Object.keys(final.colors).length,
    spacing: Object.keys(final.spacing).length,
    radii: Object.keys(final.radii).length,
    typography: Object.keys(final.typography).length,
  };

  if (Object.values(extractedCounts).every(v => v === 0)) {
    warnings.push(`No tokens were actually extracted from ${SOURCE_PATH}. Output uses defaults only — the prototype will look generic, not like the real product. Consider pointing --path at a file with $variables or :root CSS vars.`);
  }

  console.log(JSON.stringify({
    source: { type: SOURCE_TYPE, path: SOURCE_PATH },
    extracted: extractedCounts,
    total: totalCounts,
    warnings,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
