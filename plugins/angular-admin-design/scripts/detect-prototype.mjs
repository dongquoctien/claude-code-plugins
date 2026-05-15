#!/usr/bin/env node
// Scan one or more text sources for UI prototype references (URLs / file paths).
// Used by /aad-plan Step 3.5 (v0.5.0) so the skill can offer to inspect them
// via Chrome MCP before passing to spec-analyzer.
//
// Detects:
//   - prototype hosting URLs: github.io, netlify, surge, cloudflare, vercel,
//     glitch, codesandbox, stackblitz
//   - local file paths: .html, .htm, .tsx, .jsx
//
// Confidence boosting:
//   - context keyword (prototype/mockup/demo/preview/wireframe/design) within
//     2 lines before/after → HIGH
//   - host matches whitelist (github.io, netlify, ...) → MEDIUM (no boost word)
//   - path matches but no keyword → LOW (ask user before treating as prototype)
//
// Output (JSON to stdout):
//   {
//     prototypes: [
//       { kind, source, confidence, contextLine, lineNumber, hostHint }
//     ],
//     warnings: []
//   }
//
// Usage:
//   node detect-prototype.mjs --in-file <abs-path>  (scans one file)
//   node detect-prototype.mjs --in-file <abs> [--in-file <abs2> ...] [--project-root <root>]
//
// Or feed stdin:
//   echo "$JIRA_DESCRIPTION" | node detect-prototype.mjs --stdin

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }
function allArgs(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && i + 1 < process.argv.length) out.push(process.argv[i + 1]);
  }
  return out;
}

const PROJECT_ROOT = path.resolve(arg('--project-root', '.'));
const inFiles = allArgs('--in-file');
const useStdin = flag('--stdin');

if (inFiles.length === 0 && !useStdin) {
  console.error(JSON.stringify({ error: 'No --in-file or --stdin given' }));
  process.exit(1);
}

const warnings = [];

// ─── Regex patterns ─────────────────────────────────────────────────────

// Prototype hosting hosts (whitelist). Capturing whole URL up to whitespace/quote/paren.
const HOST_PATTERN = String.raw`(?:[a-z0-9-]+\.)?(?:github\.io|netlify\.app|surge\.sh|cloudflare\.app|pages\.dev|vercel\.app|glitch\.me|codesandbox\.io|stackblitz\.io|stackblitz\.com|webcontainer\.io)`;
const PROTOTYPE_URL_RE = new RegExp(String.raw`https?:\/\/${HOST_PATTERN}[^\s)"'<>\]]*`, 'gi');

// File path / bare filename: must end with .html/.htm/.tsx/.jsx.
// Two patterns:
//   1. With path prefix (./, /, drive letter) — clear path → checked unconditionally
//   2. Bare filename (e.g. `remixed-ca0f0e7d.tsx`) — only treated as prototype
//      when surrounded by backticks or quoted, AND context keyword present
const PROTOTYPE_PATH_RE = /(?:[A-Za-z]:[\\\/]|[\.\\\/])[\w.\\\/-]+\.(?:html?|tsx?|jsx?)\b/g;
const PROTOTYPE_BARE_FILE_RE = /(?:[`'"])([\w][\w.-]+\.(?:html?|tsx?|jsx?))(?:[`'"])/g;

// Context keywords that boost confidence when near a URL/path.
const CONTEXT_KEYWORDS = [
  'prototype', 'mockup', 'mock-up', 'mock up',
  'demo', 'preview', 'wireframe',
  'design', 'figma', 'storyboard',
];
const CONTEXT_KEYWORD_RE = new RegExp(
  `\\b(?:${CONTEXT_KEYWORDS.map(k => k.replace(/\s/g, '\\s+')).join('|')})\\b`,
  'i',
);

// ─── Helpers ────────────────────────────────────────────────────────────

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); }
  catch (e) { warnings.push(`Could not read ${p}: ${e.code || e.message}`); return null; }
}

function classifyKind(url) {
  if (/github\.io\//i.test(url)) return 'github-io';
  if (/netlify\.app/i.test(url) || /pages\.dev/i.test(url) || /vercel\.app/i.test(url)) return 'static-host';
  if (/codesandbox|stackblitz|glitch|webcontainer/i.test(url)) return 'sandbox';
  if (/surge\.sh|cloudflare\.app/i.test(url)) return 'static-host';
  return 'live-url';
}

function pathExtKind(p) {
  if (/\.html?$/i.test(p)) return 'local-html';
  if (/\.tsx?$/i.test(p)) return 'local-react';
  if (/\.jsx?$/i.test(p)) return 'local-react';
  return 'local-file';
}

function fileExists(absOrRel) {
  // Try as-is, then relative to PROJECT_ROOT
  if (path.isAbsolute(absOrRel) && fs.existsSync(absOrRel)) return absOrRel;
  const tryRel = path.join(PROJECT_ROOT, absOrRel);
  if (fs.existsSync(tryRel)) return tryRel;
  return null;
}

// Returns: { confidence, contextLine, hasKeyword }
function scoreContext(lines, hitLineIdx) {
  const window = lines.slice(Math.max(0, hitLineIdx - 2), Math.min(lines.length, hitLineIdx + 3));
  const windowText = window.join('\n');
  const hasKeyword = CONTEXT_KEYWORD_RE.test(windowText);
  return { hasKeyword, contextLine: lines[hitLineIdx].trim().slice(0, 200) };
}

function uniqueKey(p) { return `${p.kind}::${p.source}`; }

// ─── Scan logic ─────────────────────────────────────────────────────────

const detected = new Map(); // key → prototype obj (dedupe by source)

function scanText(text, sourceLabel) {
  if (!text) return;
  const lines = text.split(/\r?\n/);

  // URL matches
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    PROTOTYPE_URL_RE.lastIndex = 0;
    while ((m = PROTOTYPE_URL_RE.exec(line)) !== null) {
      const url = m[0].replace(/[),.;]+$/, ''); // strip trailing punctuation
      const key = `url::${url}`;
      if (detected.has(key)) continue;

      const { hasKeyword, contextLine } = scoreContext(lines, i);
      // Hosts in our whitelist are strong indicators by themselves — medium.
      // Add keyword → high. Self-hosted custom domains never reach here.
      const confidence = hasKeyword ? 'high' : 'medium';

      detected.set(key, {
        kind: classifyKind(url),
        source: url,
        confidence,
        contextLine,
        lineNumber: i + 1,
        sourceFile: sourceLabel,
        hostHint: url.match(HOST_PATTERN)?.[0] || null,
      });
    }
  }

  // Path matches
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    PROTOTYPE_PATH_RE.lastIndex = 0;
    while ((m = PROTOTYPE_PATH_RE.exec(line)) !== null) {
      let candidate = m[0];
      // Strip enclosing punctuation that may have been included
      candidate = candidate.replace(/^[(\[<"'`]+|[).,;:\]>"'`]+$/g, '');

      // Skip obvious non-prototype paths (Angular templates, config, common project files)
      const lower = candidate.toLowerCase();
      if (
        lower.includes('node_modules') ||
        lower.endsWith('package.json') ||
        lower.includes('.spec.') ||
        lower.includes('.config.') ||
        // Angular component templates — typically under src/app/
        /[\/\\]src[\/\\]app[\/\\]/.test(lower)
      ) continue;

      const { hasKeyword, contextLine } = scoreContext(lines, i);
      // Paths without context are unreliable — file extension alone isn't enough.
      const confidence = hasKeyword ? 'medium' : 'low';

      // Verify the file exists if we have a project root
      let resolved = null;
      if (PROJECT_ROOT && PROJECT_ROOT !== '.') {
        resolved = fileExists(candidate);
        if (!resolved) {
          warnings.push(`Path candidate not found on disk: ${candidate}`);
          continue; // skip phantom paths
        }
      }

      const key = `path::${resolved || candidate}`;
      if (detected.has(key)) continue;

      detected.set(key, {
        kind: pathExtKind(candidate),
        source: resolved || candidate,
        confidence,
        contextLine,
        lineNumber: i + 1,
        sourceFile: sourceLabel,
        hostHint: null,
      });
    }
  }

  // Bare filename references — only when in backticks/quotes AND keyword nearby.
  // Catches refs like `remixed-ca0f0e7d.tsx` in spec docs.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    PROTOTYPE_BARE_FILE_RE.lastIndex = 0;
    while ((m = PROTOTYPE_BARE_FILE_RE.exec(line)) !== null) {
      const filename = m[1];
      const lower = filename.toLowerCase();
      // Skip obvious project files
      if (lower === 'index.html' || lower === 'package.json') continue;
      if (lower.endsWith('.config.ts') || lower.endsWith('.config.js')) continue;
      if (lower.endsWith('.spec.ts') || lower.endsWith('.spec.js')) continue;

      const { hasKeyword, contextLine } = scoreContext(lines, i);
      // Bare filename without context keyword → not a prototype. Skip entirely.
      if (!hasKeyword) continue;

      const key = `bare::${filename}`;
      if (detected.has(key)) continue;

      detected.set(key, {
        kind: pathExtKind(filename),
        source: filename,
        confidence: 'low',         // bare reference — can't open without context
        contextLine,
        lineNumber: i + 1,
        sourceFile: sourceLabel,
        hostHint: null,
        note: 'bare filename — actual location unknown; ask user',
      });
    }
  }
}

// ─── Drive ──────────────────────────────────────────────────────────────

for (const f of inFiles) {
  const abs = path.resolve(f);
  const text = readSafe(abs);
  if (text === null) continue;
  scanText(text, path.relative(PROJECT_ROOT, abs).replace(/\\/g, '/'));
}

if (useStdin) {
  const text = fs.readFileSync(0, 'utf8');
  scanText(text, '<stdin>');
}

const prototypes = [...detected.values()]
  // Sort: high confidence first, then medium, then low; URL kinds before paths
  .sort((a, b) => {
    const order = { high: 3, medium: 2, low: 1 };
    if (order[a.confidence] !== order[b.confidence]) return order[b.confidence] - order[a.confidence];
    const aIsUrl = !!a.hostHint;
    const bIsUrl = !!b.hostHint;
    if (aIsUrl !== bIsUrl) return aIsUrl ? -1 : 1;
    return 0;
  });

const output = { prototypes, warnings };
console.log(JSON.stringify(output, null, 2));
