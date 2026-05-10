#!/usr/bin/env node
// Extract design tokens from a dev export directory and write a normalized tokens.json.
//
// Source priority: tokens.json > tailwind.config.* > globals.css.
// Always writes a complete tokens shape — missing keys are filled with defaults
// so downstream consumers never have to handle nulls.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') out.in = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  if (!out.in || !out.out) {
    console.error('Usage: extract-tokens.mjs --in <export-dir> --out <tokens.json>');
    process.exit(2);
  }
  return out;
}

const DEFAULTS = {
  colors: {
    primary: '#6366f1',
    background: '#ffffff',
    foreground: '#0f172a',
    muted: '#64748b',
    border: '#e2e8f0',
    accent: '#6366f1',
    danger: '#dc2626',
    success: '#16a34a',
  },
  spacing: { xs: '0.25rem', sm: '0.5rem', md: '1rem', lg: '1.5rem', xl: '2rem' },
  radii:   { sm: '0.25rem', md: '0.5rem', lg: '0.75rem' },
  typography: { fontSans: 'Inter, ui-sans-serif, system-ui, sans-serif', fontMono: 'ui-monospace, monospace' },
  shadows: { sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)', md: '0 4px 6px -1px rgb(0 0 0 / 0.1)', lg: '0 20px 25px -5px rgb(0 0 0 / 0.1)' },
};

function deepMerge(base, override) {
  const out = { ...base };
  for (const k of Object.keys(override || {})) {
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k])) {
      out[k] = deepMerge(base[k] || {}, override[k]);
    } else if (override[k] !== undefined && override[k] !== null) {
      out[k] = override[k];
    }
  }
  return out;
}

// ─── tokens.json parser ───────────────────────────────────────────────

function unwrapStyleDictionary(obj) {
  // Style Dictionary uses { value: "..." } at leaves. Recursively unwrap.
  if (obj == null || typeof obj !== 'object') return obj;
  if ('value' in obj && Object.keys(obj).length === 1) return obj.value;
  if ('value' in obj && typeof obj.value !== 'object') return obj.value;
  const out = Array.isArray(obj) ? [] : {};
  for (const k of Object.keys(obj)) out[k] = unwrapStyleDictionary(obj[k]);
  return out;
}

function readTokensJson(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const flat = unwrapStyleDictionary(raw);
  // Accept both singular and plural key names: color/colors, radius/radii, spacing/spacing
  const result = {
    colors: flat.colors || flat.color || {},
    spacing: flat.spacing || flat.space || {},
    radii: flat.radii || flat.radius || flat.borderRadius || {},
    typography: flat.typography || flat.fonts || flat.font || {},
    shadows: flat.shadows || flat.shadow || flat.boxShadow || {},
  };
  // typography normalization
  if (typeof result.typography === 'object') {
    result.typography = {
      fontSans: result.typography.fontSans || result.typography.sans || result.typography.body,
      fontMono: result.typography.fontMono || result.typography.mono,
    };
  }
  return result;
}

// ─── tailwind.config parser ───────────────────────────────────────────

async function readTailwindConfig(filePath) {
  // Try native import. Works for ESM and most CJS via Node's interop.
  let mod;
  try {
    mod = await import(pathToFileURL(filePath).href);
  } catch (e) {
    return { _error: 'Could not import tailwind config: ' + e.message };
  }
  const cfg = mod.default || mod;
  const t = cfg?.theme || {};
  const ext = t.extend || {};

  const colorsSrc = { ...(t.colors || {}), ...(ext.colors || {}) };
  const colors = {};
  for (const [k, v] of Object.entries(colorsSrc)) {
    if (typeof v === 'string') colors[k] = v;
    else if (v && typeof v === 'object') {
      // Tailwind palettes: { 50: ..., 500: ... }. Pick 500 as primary, fall back to first.
      const pick = v[500] || v.DEFAULT || Object.values(v)[0];
      if (typeof pick === 'string') colors[k] = pick;
    }
  }

  const spacingSrc = { ...(t.spacing || {}), ...(ext.spacing || {}) };
  const spacing = {};
  for (const [k, v] of Object.entries(spacingSrc)) {
    if (typeof v === 'string') spacing[k] = v;
  }

  const radiiSrc = { ...(t.borderRadius || {}), ...(ext.borderRadius || {}) };
  const radii = {};
  for (const [k, v] of Object.entries(radiiSrc)) {
    if (typeof v === 'string') radii[k.toLowerCase().replace('default', 'md')] = v;
  }

  const fontFamilySrc = { ...(t.fontFamily || {}), ...(ext.fontFamily || {}) };
  const typography = {};
  if (fontFamilySrc.sans) typography.fontSans = Array.isArray(fontFamilySrc.sans) ? fontFamilySrc.sans.join(', ') : fontFamilySrc.sans;
  if (fontFamilySrc.mono) typography.fontMono = Array.isArray(fontFamilySrc.mono) ? fontFamilySrc.mono.join(', ') : fontFamilySrc.mono;

  return { colors, spacing, radii, typography, shadows: {} };
}

// ─── globals.css parser ───────────────────────────────────────────────

function readGlobalsCss(filePath) {
  const css = fs.readFileSync(filePath, 'utf8');
  const rootMatch = /:root\s*\{([^}]+)\}/m.exec(css);
  if (!rootMatch) return {};
  const block = rootMatch[1];
  const vars = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    vars[m[1].trim()] = m[2].trim();
  }
  // Map well-known names into the canonical shape
  const colors = {};
  const spacing = {};
  const radii = {};
  const typography = {};
  for (const [k, v] of Object.entries(vars)) {
    if (/^(color|bg|text|border|accent|primary|danger|success|muted)/i.test(k)) {
      const key = k.replace(/^color-/, '').replace('bg', 'background').replace('fg', 'foreground').replace('text', 'foreground');
      colors[key] = v;
    } else if (/^space-/.test(k)) {
      spacing[k.replace('space-', '')] = v;
    } else if (/^radius/.test(k)) {
      radii[k.replace('radius-', '').replace('radius', 'md') || 'md'] = v;
    } else if (/^font-/.test(k)) {
      const key = k.replace('font-', '');
      if (key === 'sans') typography.fontSans = v;
      if (key === 'mono') typography.fontMono = v;
    }
  }
  return { colors, spacing, radii, typography };
}

// ─── main ─────────────────────────────────────────────────────────────

async function main() {
  const { in: inDir, out: outFile } = parseArgs(process.argv);
  if (!fs.existsSync(inDir)) {
    console.error('input dir not found:', inDir);
    process.exit(1);
  }

  const candidates = {
    tokens: ['tokens.json', 'design-tokens.json'].map(f => path.join(inDir, f)).find(p => fs.existsSync(p)),
    tailwind: ['tailwind.config.ts', 'tailwind.config.js', 'tailwind.config.mjs', 'tailwind.config.cjs']
      .map(f => path.join(inDir, f)).find(p => fs.existsSync(p)),
    css: ['globals.css', 'tokens.css', 'theme.css'].map(f => path.join(inDir, f)).find(p => fs.existsSync(p)),
  };

  let extracted = {};
  let source = 'none';
  const warnings = [];

  if (candidates.tokens) {
    extracted = readTokensJson(candidates.tokens);
    source = 'tokens.json (' + path.basename(candidates.tokens) + ')';
  } else if (candidates.tailwind) {
    const out = await readTailwindConfig(candidates.tailwind);
    if (out._error) {
      warnings.push(out._error);
    } else {
      extracted = out;
      source = 'tailwind config (' + path.basename(candidates.tailwind) + ')';
    }
  }

  if (candidates.css) {
    const cssTokens = readGlobalsCss(candidates.css);
    extracted = deepMerge(cssTokens, extracted); // higher-priority sources override CSS vars
    if (source === 'none') source = 'globals.css (' + path.basename(candidates.css) + ')';
    else source += ' + globals.css (' + path.basename(candidates.css) + ')';
  }

  if (source === 'none') {
    console.error('No recognized token source found. Looked for tokens.json, tailwind.config.*, globals.css.');
    process.exit(1);
  }

  const final = {
    colors:     deepMerge(DEFAULTS.colors,     extracted.colors || {}),
    spacing:    deepMerge(DEFAULTS.spacing,    extracted.spacing || {}),
    radii:      deepMerge(DEFAULTS.radii,      extracted.radii || {}),
    typography: deepMerge(DEFAULTS.typography, extracted.typography || {}),
    shadows:    deepMerge(DEFAULTS.shadows,    extracted.shadows || {}),
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(final, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify({
    source,
    counts: {
      colors: Object.keys(final.colors).length,
      spacing: Object.keys(final.spacing).length,
      radii: Object.keys(final.radii).length,
      typography: Object.keys(final.typography).length,
      shadows: Object.keys(final.shadows).length,
    },
    warnings,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
