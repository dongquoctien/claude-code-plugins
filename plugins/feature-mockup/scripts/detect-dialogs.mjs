#!/usr/bin/env node
// Detect dialog/modal/toast patterns in a frontend project so the prototype
// can render overlays instead of separate pages. The agent uses the output to
// decide: "this CTA opens a dialog (overlay), not a navigation".
//
// Outputs a JSON map keyed by feature route name, listing each dialog/modal
// with its trigger button label, header text, content shape, and size.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './dialog-detection.json'));
const SRC = arg('--src', 'src');

if (!fs.existsSync(path.join(ROOT, SRC))) {
  console.error('source dir not found:', path.join(ROOT, SRC));
  process.exit(1);
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'out', '.git', 'coverage', '.angular', '.cache']);

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

// Patterns covering the major Angular / Vue / React modal libraries
const DIALOG_PATTERNS = [
  // Angular
  { framework: 'angular', kind: 'app-dialog',     re: /<app-dialog\b([\s\S]*?)>/g },
  { framework: 'angular', kind: 'kendo-dialog',   re: /<kendo-dialog\b([\s\S]*?)>/g },
  { framework: 'angular', kind: 'kendo-window',   re: /<kendo-window\b([\s\S]*?)>/g },
  { framework: 'angular', kind: 'mat-dialog',     re: /MatDialog|matDialog\.open\(/g },
  { framework: 'angular', kind: 'p-dialog',       re: /<p-dialog\b([\s\S]*?)>/g },
  // Vue
  { framework: 'vue',     kind: 'el-dialog',      re: /<el-dialog\b([\s\S]*?)>/g },
  { framework: 'vue',     kind: 'a-modal',        re: /<a-modal\b([\s\S]*?)>/g },
  { framework: 'vue',     kind: 'q-dialog',       re: /<q-dialog\b([\s\S]*?)>/g },
  { framework: 'vue',     kind: 'v-dialog',       re: /<v-dialog\b([\s\S]*?)>/g },
  // React
  { framework: 'react',   kind: 'mui-Dialog',     re: /<Dialog\s/g },
  { framework: 'react',   kind: 'shadcn-Dialog',  re: /<DialogContent\b/g },
  { framework: 'react',   kind: 'antd-Modal',     re: /<Modal\s/g },
];

const TOAST_PATTERNS = [
  { framework: 'angular', kind: 'toastr',     re: /\btoastr\.(success|error|warning|info|show)\(/g },
  { framework: 'angular', kind: 'mat-snackbar', re: /MatSnackBar|snackBar\.open\(/g },
  { framework: 'angular', kind: 'p-toast',    re: /<p-toast\b/g },
  { framework: 'angular', kind: 'app-toast',  re: /<app-toast\b/g },
  // Korean enterprise admins commonly inject a custom AlertService + window.alert()
  { framework: 'angular', kind: 'alert-service', re: /alertService\.(alert|confirm|toast)\(/g },
  { framework: 'angular', kind: 'window-alert',  re: /\bwindow\.alert\(/g },
  { framework: 'vue',     kind: 'el-message', re: /ElMessage\.|this\.\$message\(/g },
  { framework: 'vue',     kind: 'q-notify',   re: /\$q\.notify\(|Notify\.create\(/g },
  { framework: 'react',   kind: 'sonner',     re: /\btoast\.(success|error|info|warning|message)\(/g },
  { framework: 'react',   kind: 'react-hot-toast', re: /import\s+toast\s+from\s+['"]react-hot-toast['"]/g },
];

// Helpers to extract attribute value
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`));
  return m ? m[1] : null;
}
function bindAttr(tag, name) {
  // [name]="expr"
  const m = tag.match(new RegExp(`\\[${name}\\]=["']([^"']+)["']`));
  return m ? m[1] : null;
}

const dialogsByRoute = {};
const toasts = { count: 0, samples: [] };
const featureKeys = new Set();

function routeOf(p) {
  const m = p.match(/[\\/]routes[\\/]([^\\/]+)[\\/]/);
  return m ? m[1] : null;
}

let scanned = 0;
const SCAN_LIMIT = 4000;
const SRC_ROOT = path.join(ROOT, SRC);

for (const file of walk(SRC_ROOT)) {
  if (scanned >= SCAN_LIMIT) break;
  const ext = path.extname(file).toLowerCase();
  if (!['.html', '.ts', '.tsx', '.jsx', '.vue', '.svelte'].includes(ext)) continue;
  scanned++;

  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
  if (content.length > 200000) content = content.slice(0, 200000);  // Skip giant files

  const route = routeOf(file);
  const featureKey = route || '_global';

  // Dialog / modal tag matching
  for (const { framework, kind, re } of DIALOG_PATTERNS) {
    const matches = [...content.matchAll(re)];
    for (const m of matches) {
      const tag = m[0];
      const dialog = {
        kind,
        framework,
        sourceFile: rel(file),
        header: attr(tag, 'header') || attr(tag, 'title') || null,
        modalSize: attr(tag, 'modalSize') || attr(tag, 'size') || null,
        visibleBinding: bindAttr(tag, 'visible') || bindAttr(tag, 'open') || null,
      };
      if (!dialogsByRoute[featureKey]) dialogsByRoute[featureKey] = [];
      dialogsByRoute[featureKey].push(dialog);
      featureKeys.add(featureKey);
    }
  }

  // Toast patterns — count globally, sample messages
  for (const { framework, kind, re } of TOAST_PATTERNS) {
    const matches = [...content.matchAll(re)];
    for (const m of matches) {
      toasts.count++;
      // Try to grab the message argument (single or double quote string within next 80 chars)
      const ctx = content.slice(m.index, m.index + 200);
      const msg = ctx.match(/['"]([^'"]{4,80})['"]/);
      if (msg && toasts.samples.length < 20) {
        toasts.samples.push({ kind, message: msg[1], sourceFile: rel(file) });
      }
    }
  }
}

// De-duplicate dialogs per route by header + modalSize
for (const k of Object.keys(dialogsByRoute)) {
  const seen = new Map();
  for (const d of dialogsByRoute[k]) {
    const key = `${d.kind}|${d.header}|${d.modalSize}`;
    if (!seen.has(key)) seen.set(key, d);
  }
  dialogsByRoute[k] = [...seen.values()];
}

// Aggregate stats
const totalDialogs = Object.values(dialogsByRoute).reduce((sum, arr) => sum + arr.length, 0);
const result = {
  generatedAt: new Date().toISOString(),
  totalDialogs,
  totalRoutes: featureKeys.size,
  toasts: { count: toasts.count, samples: toasts.samples.slice(0, 10) },
  dialogsByRoute,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  totalDialogs,
  totalRoutes: featureKeys.size,
  toastCount: toasts.count,
  // Show top features by dialog count for the user's confirmation
  topFeatures: Object.entries(dialogsByRoute)
    .map(([k, v]) => ({ route: k, dialogCount: v.length, headers: v.map(d => d.header).filter(Boolean).slice(0, 3) }))
    .sort((a, b) => b.dialogCount - a.dialogCount)
    .slice(0, 10),
}, null, 2));
