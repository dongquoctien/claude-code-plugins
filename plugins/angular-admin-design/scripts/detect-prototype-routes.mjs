#!/usr/bin/env node
// Parse a Chrome MCP a11y-tree snapshot (.txt) and extract navigation routes
// — URLs that point to OTHER views of the same prototype.
//
// v0.7.0 — used by /aad-plan Step 5.6 after initial snapshot. If multiple
// routes detected, the skill asks the user which to walk; each becomes a
// separate plan screen.
//
// Detection:
//   - HashRouter routes: links with url containing #/path
//   - Path-router routes: links with url same-origin but different path
//   - All routes filtered to skip:
//     • Same as current URL (we're already there)
//     • External URLs (different host)
//     • Common navigation noise (Logout, Change Password, etc.)
//
// Heuristics for relevance scoring:
//   - High: route URL slug similar to feature name (from --feature arg)
//   - Medium: route reachable from main content area (not just sidebar nav)
//   - Low: only appears in sidebar/banner nav
//
// Output (JSON to stdout):
//   {
//     baseUrl: "https://.../",      // origin
//     currentUrl: "...",            // RootWebArea url
//     currentSlug: "...",           // derived from currentUrl
//     routes: [
//       { kind, url, slug, label, location, score, lineNumber }
//     ],
//     stats: { totalLinks, kept, byKind: {} }
//   }
//
// Usage:
//   node detect-prototype-routes.mjs --in-file <abs-snapshot.txt>
//                                    [--feature <kebab>]
//                                    [--budget 5]

import fs from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const IN_FILE = arg('--in-file', '');
const FEATURE = arg('--feature', '').toLowerCase();
const BUDGET = parseInt(arg('--budget', '8'), 10);

if (!IN_FILE) {
  console.error(JSON.stringify({ error: '--in-file required' }));
  process.exit(1);
}

const raw = fs.readFileSync(IN_FILE, 'utf8');
const lines = raw.split(/\r?\n/);

// ─── Pull current URL from RootWebArea ─────────────────────────────────
let currentUrl = null;
let rootIndent = null;
const rootMatch = raw.match(/^uid=\w+\s+RootWebArea[^\n]*url="([^"]+)"/m);
if (rootMatch) currentUrl = rootMatch[1];

if (!currentUrl) {
  console.error(JSON.stringify({ error: 'Could not detect RootWebArea url — snapshot may be malformed' }));
  process.exit(1);
}

// Parse base URL + current path/hash
function parseUrl(u) {
  try {
    const url = new URL(u);
    let hash = url.hash.replace(/^#/, '');
    return {
      origin: url.origin,
      pathname: url.pathname,
      hash,
      isHashRoute: hash.startsWith('/'),
      // For hash routers, "route" is the hash; for path routers, it's pathname
      routePath: hash.startsWith('/') ? hash : url.pathname,
    };
  } catch {
    return null;
  }
}

const currentParsed = parseUrl(currentUrl);
if (!currentParsed) {
  console.error(JSON.stringify({ error: 'Could not parse currentUrl: ' + currentUrl }));
  process.exit(1);
}

// Slug = last meaningful path segment
function slugify(routePath) {
  if (!routePath) return '';
  return routePath
    .split('/')
    .filter(Boolean)
    .pop() || 'root';
}

const currentSlug = slugify(currentParsed.routePath);

// ─── Walk every line, find link nodes with url= attribute ──────────────
const noiseLabels = new Set([
  'logout', 'log out', 'change password', 'profile', 'settings',
  'english', 'vietnamese', 'tiếng việt', 'korean', 'japanese',
  'help', 'about', 'contact', 'feedback',
  'home', 'back', 'forward', 'close', 'open',
]);

const noiseSlugs = new Set([
  'login', 'logout', 'profile', 'change-password', 'settings',
]);

const linkRe = /^(\s*)uid=([\w_]+)\s+link\s+("[^"]+")?\s*(.*)$/;
const urlAttrRe = /\burl="([^"]+)"/;

const seenUrls = new Map();      // url → first detected entry
let totalLinks = 0;

// Track parent context: walk indents to detect "in banner" / "in sidebar"
// vs "in main content"
// Build minimal parent stack from line scanning.
const lineIndents = [];   // {indent, role, label}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  const m = line.match(/^(\s*)uid=[\w_]+\s+(\S+)(?:\s+"([^"]+)")?/);
  if (m) {
    lineIndents.push({ index: i, indent: m[1].length / 2, role: m[2], label: m[3] || null });
  }
}

function parentContextOf(lineIdx) {
  // Find this line's indent, then walk backward to find ancestor labels.
  const me = lineIndents.find(x => x.index === lineIdx);
  if (!me) return '';
  const ancestors = [];
  let curIndent = me.indent;
  for (let j = lineIndents.length - 1; j >= 0; j--) {
    const cand = lineIndents[j];
    if (cand.index >= lineIdx) continue;
    if (cand.indent < curIndent) {
      ancestors.push(`${cand.role}${cand.label ? ':' + cand.label : ''}`);
      curIndent = cand.indent;
      if (ancestors.length >= 3) break;
    }
  }
  return ancestors.reverse().join(' > ');
}

function locationFromContext(ctx) {
  const lower = ctx.toLowerCase();
  if (lower.includes('banner') || lower.includes('header')) return 'banner';
  if (lower.includes('complementary') || lower.includes('navigation') || lower.includes('sidebar')) return 'sidebar';
  if (lower.includes('main')) return 'main';
  if (lower.includes('dialog')) return 'dialog';
  return 'other';
}

// ─── Score each route ───────────────────────────────────────────────────

function scoreRoute(slug, label, location, kind) {
  let score = 0;

  // Match feature name → most relevant
  if (FEATURE && slug && (slug.includes(FEATURE) || FEATURE.includes(slug))) score += 0.5;
  if (FEATURE && label && label.toLowerCase().includes(FEATURE)) score += 0.3;

  // Routes from main content area > sidebar
  if (location === 'main') score += 0.3;
  else if (location === 'dialog') score += 0.4;     // dialog links often deep-link
  else if (location === 'banner') score += 0.1;
  else if (location === 'sidebar') score -= 0.1;    // very common but rarely the target

  // Hash routes are more reliable as same-app navigation
  if (kind === 'hash') score += 0.1;

  return Math.max(0, Math.min(1, +score.toFixed(2)));
}

// ─── Process every link ────────────────────────────────────────────────

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(linkRe);
  if (!m) continue;
  const [, , , quoted, attrsRaw] = m;
  const label = quoted ? quoted.replace(/^"|"$/g, '') : '';
  const urlMatch = attrsRaw.match(urlAttrRe);
  if (!urlMatch) continue;
  totalLinks++;
  const targetUrl = urlMatch[1];
  const targetParsed = parseUrl(targetUrl);
  if (!targetParsed) continue;

  // Skip if external (different origin)
  if (targetParsed.origin !== currentParsed.origin) continue;

  // Skip if same route as current (already there)
  if (targetParsed.routePath === currentParsed.routePath) continue;

  // Skip noise labels (Logout, etc.)
  if (noiseLabels.has(label.toLowerCase().trim())) continue;

  // Skip noise slugs
  const slug = slugify(targetParsed.routePath);
  if (noiseSlugs.has(slug)) continue;

  // Determine route kind
  const kind = targetParsed.isHashRoute ? 'hash' : 'path';

  // Dedupe by URL (keep first occurrence)
  if (seenUrls.has(targetUrl)) continue;

  const context = parentContextOf(i);
  const location = locationFromContext(context);
  const score = scoreRoute(slug, label, location, kind);

  seenUrls.set(targetUrl, {
    kind,
    url: targetUrl,
    slug,
    label: label || '(no label)',
    location,
    score,
    lineNumber: i + 1,
  });
}

// Sort by score desc, then by location preference, then by line
const routes = [...seenUrls.values()].sort((a, b) => {
  if (b.score !== a.score) return b.score - a.score;
  const locOrder = { main: 0, dialog: 1, banner: 2, other: 3, sidebar: 4 };
  const ax = locOrder[a.location] ?? 5;
  const bx = locOrder[b.location] ?? 5;
  if (ax !== bx) return ax - bx;
  return a.lineNumber - b.lineNumber;
});

const truncated = routes.length > BUDGET;
const finalRoutes = routes.slice(0, BUDGET);

const byKind = finalRoutes.reduce((acc, r) => {
  acc[r.kind] = (acc[r.kind] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  baseUrl: currentParsed.origin,
  currentUrl,
  currentSlug,
  routes: finalRoutes,
  truncated,
  totalDetected: routes.length,
  stats: {
    totalLinks,
    kept: finalRoutes.length,
    byKind,
  },
}, null, 2));
