// Shared helpers for resolving multiple source roots and route names across
// Angular / React / Next / Vue / Nuxt / Svelte / Astro / Remix / Gatsby.
//
// extract-* scripts originally assumed a single SRC root (default 'src'),
// which works for Angular/Vue/Svelte but breaks Remix (uses app/) and
// Gatsby (uses src/pages and gatsby-* config files at root). This module
// consolidates the pattern.

import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve a comma-separated --src arg into an array of existing absolute paths.
 * If --src not provided, default to 'src' but auto-include 'app' when it
 * looks like a Remix project (has app/routes/).
 */
export function resolveSrcRoots(ROOT, srcArg) {
  const raw = srcArg || 'src';
  const list = raw.split(',').map(s => s.trim()).filter(Boolean);

  // Auto-include app/ if it has routes/ or root.tsx (Remix signature)
  if (!list.includes('app') && fs.existsSync(path.join(ROOT, 'app'))) {
    const looksLikeRemix =
      fs.existsSync(path.join(ROOT, 'app/routes')) ||
      fs.existsSync(path.join(ROOT, 'app/root.tsx')) ||
      fs.existsSync(path.join(ROOT, 'app/root.jsx'));
    if (looksLikeRemix) list.push('app');
  }

  const valid = list.filter(s => fs.existsSync(path.join(ROOT, s)));
  return { roots: valid, primary: valid[0] || null };
}

/**
 * Identify which feature route a file belongs to. Returns null when the file
 * is not under any recognizable route convention.
 *
 * Convention detection (in priority order):
 *   1. Angular        — /routes/<name>/...
 *   2. Astro          — /src/pages/<name>(.astro|/...)
 *   3. Gatsby         — /src/pages/<name>(.tsx|/...)
 *   4. Remix v2 flat  — /app/routes/<name>(.<...>.tsx|/...)
 *   5. Vue/Nuxt       — /pages/<name>/...
 *   6. Next App Router — /app/<name>/page.tsx
 *   7. Next Pages     — /pages/<name>(.tsx|/...)
 *   8. SvelteKit      — /src/routes/<name>/...
 */
export function routeOf(absPath) {
  const norm = absPath.replace(/\\/g, '/');

  // Angular
  let m = norm.match(/\/routes\/([^/]+)\//);
  if (m && !norm.includes('/app/routes/')) return m[1];

  // Astro: /src/pages/<seg>.astro OR /src/pages/<seg>/...
  if (norm.includes('/src/pages/')) {
    const after = norm.split('/src/pages/')[1];
    const seg = after.split('/')[0].split('.')[0];
    if (seg && seg !== 'index') return seg;
  }

  // Remix v2 flat: /app/routes/<seg>.<...>.tsx
  m = norm.match(/\/app\/routes\/([^/.]+)/);
  if (m && !m[1].startsWith('_')) return m[1];

  // Vue/Nuxt /pages/
  m = norm.match(/\/pages\/([^/.]+)/);
  if (m && m[1] !== 'index' && !norm.includes('/src/pages/')) return m[1];

  // Next App Router
  m = norm.match(/\/app\/([^/]+)\/(page|layout|loading|error)\.(tsx|jsx|ts|js)/);
  if (m && !m[1].startsWith('(') && !m[1].startsWith('_') && m[1] !== 'routes') return m[1];

  // SvelteKit
  m = norm.match(/\/src\/routes\/([^/]+)\//);
  if (m) return m[1];

  return null;
}

/**
 * File-extension classifier for cross-framework scanning. Returns the
 * framework key the file belongs to so callers can apply the right regex.
 */
export function frameworkOf(absPath, content) {
  const ext = path.extname(absPath).toLowerCase();
  const norm = absPath.replace(/\\/g, '/');

  if (ext === '.astro') return 'astro';
  if (ext === '.vue') return 'vue';
  if (ext === '.svelte') return 'svelte';
  if (/\.component\.(ts|html)$/.test(absPath)) return 'angular';
  if (/\/app\/routes\//.test(norm) && /\.(tsx|jsx|ts|js)$/.test(absPath)) return 'remix';
  if (/\/src\/pages\//.test(norm) && /\.(tsx|jsx)$/.test(absPath)) return 'gatsby';
  if (/^gatsby-(node|browser|ssr|config)\.(js|ts|mjs)$/.test(path.basename(absPath))) return 'gatsby';
  if (ext === '.tsx' || ext === '.jsx') return 'react';
  if ((ext === '.ts' || ext === '.js') && content && /Component|@Component|@Injectable/.test(content)) return 'angular';
  return 'unknown';
}
