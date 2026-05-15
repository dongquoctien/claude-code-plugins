#!/usr/bin/env node
// Walk src/app/core/services/**/*.service.ts and parse public method signatures.
// Output goes into catalog.coreServices[] so /aad-generate can verify method
// names exist before writing imports / call sites.
//
// CRITICAL: this fixes the v0.1.0 bug where the agent invented
// `_errorService.handleError(...)` because the knowledge file said so —
// the real class has `apiErrorHandler`, `errorHandler`, `parseApiError`.
//
// Output: JSON to stdout.
//
// Usage:
//   node crawl-core-services.mjs --in <project-root> [--core-path src/app/core/services]

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const CORE_PATH = arg('--core-path', 'src/app/core/services');
const CORE_ABS = path.join(ROOT, CORE_PATH);

if (!fs.existsSync(CORE_ABS)) {
  console.error(JSON.stringify({ error: `Core services path not found: ${CORE_ABS}` }));
  process.exit(1);
}

const warnings = [];
const services = [];

function rel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }
function read(abs) { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } }

function walk(dir, depth = 0, acc = []) {
  if (depth > 6) return acc;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, depth + 1, acc);
    else if (e.name.endsWith('.service.ts')) acc.push(abs);
  }
  return acc;
}

function stripComments(s) {
  // Block comments. Single-line // ... left alone (rare to confuse method parser).
  return s.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseClassName(src) {
  const m = src.match(/export\s+class\s+([A-Z][A-Za-z0-9_]*Service)\b/);
  return m ? m[1] : null;
}

// Find the body of a class declaration: from the line containing `class X ... {`
// to the matching closing brace. Returns body text and the start offset.
function parseClassBody(src, className) {
  const declRe = new RegExp(`export\\s+class\\s+${className}\\b[^{]*\\{`);
  const m = declRe.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length - 1; // pointer at '{'
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { body: src.slice(start + 1, i), start: start + 1, end: i };
    }
    i++;
  }
  return null;
}

// Parse public method signatures inside a class body.
// We treat:
//   - `public foo(args): T { ... }`          → public
//   - `foo(args): T { ... }`                 → public (no modifier = public in TS)
//   - `private/protected foo(...)`           → SKIP
//   - `constructor(...)`                     → SKIP
//   - arrow methods `foo = (...) => ...`     → captured separately if visibility allows
//   - `get foo(): T { ... }` / `set foo(v)`  → captured as getter/setter
function parseMethods(body, className) {
  const methods = [];
  const seen = new Set();

  // Strip nested braces (other classes/functions) to avoid scanning inner methods.
  // Implementation: walk char-by-char; only sample top-level (depth 0 inside class body).
  const topLevel = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    if (ch === '{') {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === '}') {
      depth--;
      buf += ch;
      continue;
    }
    if (depth === 0) topLevel.push(ch);
    else buf += ch;
  }
  // We want method *signatures*, which exist at depth 0 of the class body
  // (the `{` after the signature opens a depth-1 block we skipped above).
  // After the strip, `topLevel` contains: visibility modifiers, method name,
  // parens, return type — each followed by a placeholder gap where the block
  // used to be. We reassemble and split on ';' / newline.
  const flattened = topLevel.join('');

  // Match: optional visibility (public/private/protected) + optional static +
  // optional async + optional get/set + identifier + ( ... ) + optional : returnType
  // Cannot use balanced parens in regex; use a manual scan.
  let i = 0;
  while (i < flattened.length) {
    // Skip whitespace + ';'
    while (i < flattened.length && /[\s;,]/.test(flattened[i])) i++;
    if (i >= flattened.length) break;

    // Detect tokens up to '(' or end. We allow tokens to be one of:
    //   public/private/protected/static/async/get/set/<identifier>
    // The last identifier before '(' is the method name; visibility tokens
    // before it are modifiers.
    const startIdx = i;
    const tokens = [];
    while (i < flattened.length && flattened[i] !== '(') {
      // Skip comment ends and decorators
      if (flattened[i] === '/' && flattened[i + 1] === '/') {
        while (i < flattened.length && flattened[i] !== '\n') i++;
        continue;
      }
      if (flattened[i] === '@') {
        // Skip decorator until matching ) or end of line
        while (i < flattened.length && flattened[i] !== '\n' && flattened[i] !== '(') i++;
        if (flattened[i] === '(') {
          let d = 0;
          while (i < flattened.length) {
            if (flattened[i] === '(') d++;
            else if (flattened[i] === ')') { d--; if (d === 0) { i++; break; } }
            i++;
          }
        }
        continue;
      }
      const m = /[A-Za-z_$][\w$]*/y;
      m.lastIndex = i;
      const matched = m.exec(flattened);
      if (matched && matched.index === i) {
        tokens.push(matched[0]);
        i = m.lastIndex;
        continue;
      }
      // Skip other punctuation
      i++;
    }
    if (i >= flattened.length || flattened[i] !== '(') break;

    // Parse args
    const argsStart = i + 1;
    let d = 1;
    i++;
    while (i < flattened.length && d > 0) {
      if (flattened[i] === '(') d++;
      else if (flattened[i] === ')') d--;
      if (d === 0) break;
      i++;
    }
    if (d !== 0) break; // malformed
    const argsRaw = flattened.slice(argsStart, i);
    i++; // past ')'

    // Parse return type: optional `: TYPE` until end of line / '{' / ';' / ','
    while (i < flattened.length && /[\s]/.test(flattened[i])) i++;
    let returnType = null;
    if (flattened[i] === ':') {
      i++;
      const retStart = i;
      while (i < flattened.length && !/[\n;,{]/.test(flattened[i])) i++;
      returnType = flattened.slice(retStart, i).trim();
    }

    // Apply tokens
    if (tokens.length === 0) continue;
    const name = tokens[tokens.length - 1];
    if (name === 'constructor' || name === 'if' || name === 'for' || name === 'while' || name === 'switch') continue;
    const modifiers = tokens.slice(0, -1);
    const visibility = modifiers.includes('private') ? 'private'
      : modifiers.includes('protected') ? 'protected'
      : 'public';
    if (visibility !== 'public') continue;

    const kind = modifiers.includes('get') ? 'getter'
      : modifiers.includes('set') ? 'setter'
      : 'method';

    const key = `${kind}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    methods.push({
      name,
      kind,
      isAsync: modifiers.includes('async'),
      isStatic: modifiers.includes('static'),
      params: parseParams(argsRaw),
      returnType: returnType || null,
    });
  }

  return methods;
}

function parseParams(argsRaw) {
  if (!argsRaw.trim()) return [];
  // Split by ',' at depth 0 (account for generics <>, parens, braces).
  const parts = [];
  let buf = '';
  let depth = 0;
  for (const ch of argsRaw) {
    if (ch === '<' || ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === '>' || ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());

  return parts.map(p => {
    // Strip decorators on params
    p = p.replace(/^@[A-Za-z_$][\w$]*(\([^)]*\))?\s*/, '');
    const m = p.match(/^(?:public\s+|private\s+|protected\s+|readonly\s+)*([A-Za-z_$][\w$]*)\s*(\?)?\s*(?::\s*(.+?))?(?:\s*=\s*(.+))?$/);
    if (!m) return { name: p, type: null, optional: false };
    return {
      name: m[1],
      optional: m[2] === '?',
      type: m[3] ? m[3].trim() : null,
      defaultValue: m[4] ? m[4].trim() : null,
    };
  });
}

// ─── walk ───────────────────────────────────────────────────────────────
const files = walk(CORE_ABS);
for (const f of files) {
  const raw = read(f);
  if (!raw) { warnings.push(`Unreadable: ${rel(f)}`); continue; }
  const src = stripComments(raw);
  const className = parseClassName(src);
  if (!className) { warnings.push(`No service class in ${rel(f)}`); continue; }
  const body = parseClassBody(src, className);
  if (!body) { warnings.push(`No class body for ${className} in ${rel(f)}`); continue; }
  const methods = parseMethods(body.body, className);
  services.push({
    className,
    path: rel(f),
    importPath: rel(f).replace(/\.ts$/, ''),
    methods,
  });
}

console.log(JSON.stringify({ services, warnings }, null, 2));
