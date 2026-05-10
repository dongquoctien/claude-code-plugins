#!/usr/bin/env node
// Extract i18n label dictionaries from source so prototype's language
// switcher renders authentic locale labels (not Google-Translated guesses).
//
// Output i18n.json:
//   {
//     "locales": ["ko", "ja", "en", "vi"],
//     "defaultLocale": "ko",
//     "labels": {
//       "ko": { "common.search": "검색", "btn.cancel": "취소", ... },
//       "en": { "common.search": "Search", "btn.cancel": "Cancel", ... }
//     },
//     "stats": { "ko": 1234, "en": 1180 }
//   }
//
// Multi-stack: walks src/assets/i18n/, public/locales/, src/locales/ and
// reads json files (ngx-translate / vue-i18n / react-i18next conventions).

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './i18n.json'));

const I18N_DIR_CANDIDATES = [
  // Angular ngx-translate convention
  'src/assets/i18n',
  'src/assets/locales',
  // Vue / React
  'src/i18n',
  'src/locales',
  // Next.js next-intl / next-i18next
  'public/locales',
  'public/i18n',
  'messages',         // next-intl convention
  'i18n',             // some Next.js variants
  // Astro: astro-i18next stores locales in src/i18n or src/locales
  'src/i18n/locales',
  // Remix: app/locales (custom) or public/locales (when using remix-i18next)
  'app/locales',
  // SvelteKit + svelte-i18n: src/lib/i18n/locales
  'src/lib/i18n',
  'src/lib/i18n/locales',
  // Gatsby: gatsby-plugin-react-i18next puts locales in static/locales
  'static/locales',
  'assets/i18n',
];

const LOCALE_RE = /^([a-z]{2,3}(?:[-_][A-Z]{2})?)\.json$/;

function flatten(obj, prefix = '', out = {}) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
      else out[key] = String(v);
    }
  }
  return out;
}

function findI18nDir() {
  for (const d of I18N_DIR_CANDIDATES) {
    const full = path.join(ROOT, d);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) return full;
  }
  // Last resort: scan src/**/i18n/*.json shallow
  return null;
}

const i18nDir = findI18nDir();

const labels = {};
const stats = {};
const locales = [];

if (i18nDir) {
  let entries;
  try { entries = fs.readdirSync(i18nDir); } catch { entries = []; }

  // Some projects use {locale}.json (ngx-translate, vue-i18n)
  // Others use {locale}/translation.json (react-i18next default)
  for (const ent of entries) {
    const full = path.join(i18nDir, ent);
    const stat = fs.statSync(full);
    if (stat.isFile() && LOCALE_RE.test(ent)) {
      const locale = ent.replace(/\.json$/, '');
      try {
        const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
        const flat = flatten(raw);
        labels[locale] = flat;
        stats[locale] = Object.keys(flat).length;
        locales.push(locale);
      } catch (e) {
        console.error(`failed to parse ${ent}:`, e.message);
      }
    } else if (stat.isDirectory() && /^[a-z]{2,3}(?:[-_][A-Z]{2})?$/.test(ent)) {
      const locale = ent;
      const merged = {};
      try {
        for (const f of fs.readdirSync(full)) {
          if (!f.endsWith('.json')) continue;
          const ns = f.replace(/\.json$/, '');
          try {
            const raw = JSON.parse(fs.readFileSync(path.join(full, f), 'utf8'));
            const flat = flatten(raw, ns === 'translation' ? '' : ns);
            Object.assign(merged, flat);
          } catch {}
        }
      } catch {}
      if (Object.keys(merged).length > 0) {
        labels[locale] = merged;
        stats[locale] = Object.keys(merged).length;
        locales.push(locale);
      }
    }
  }
}

// Pick default locale: 'en' if present, else first in alphabetical order
let defaultLocale = locales.includes('en')
  ? 'en'
  : locales.includes('en-US')
    ? 'en-US'
    : locales.sort()[0] || null;

// If we found nothing, surface the empty file so the agent knows there's no i18n to use
const out = {
  extractedAt: new Date().toISOString(),
  i18nDir: i18nDir ? path.relative(ROOT, i18nDir).replace(/\\/g, '/') : null,
  locales,
  defaultLocale,
  labels,
  stats,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ locales, defaultLocale, stats }, null, 2));
