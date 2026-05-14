#!/usr/bin/env node
// Flip `mockMode: true|false` inside an Angular environment.ts file.
// Adds the property if missing. Idempotent. Does NOT edit any other field.
//
// Usage:
//   node mock-switch.mjs --file <abs-path-to-environment.ts> --value true|false
//   node mock-switch.mjs --file <abs-path-to-environment.ts> --check          # print current value (or 'missing')
//   node mock-switch.mjs --add-default --file <abs-path> --value false        # add mockMode if missing, leave alone if present
//
// Constraints:
// - Only mutates a literal-object `export const environment = { ... }` declaration.
// - Preserves all other fields, comments, indentation.
// - Refuses to operate on environment.prod.ts unless --force is passed.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

const FILE = path.resolve(arg('--file', ''));
const VALUE = arg('--value', null);
const CHECK = flag('--check');
const ADD_DEFAULT = flag('--add-default');
const FORCE = flag('--force');

if (!FILE || !fs.existsSync(FILE)) {
  console.error(JSON.stringify({ error: `File not found: ${FILE}` }));
  process.exit(1);
}

if (!CHECK && VALUE !== 'true' && VALUE !== 'false') {
  console.error(JSON.stringify({ error: '--value must be "true" or "false" (omit when using --check)' }));
  process.exit(1);
}

const isProd = path.basename(FILE).includes('environment.prod');
if (isProd && !CHECK && !FORCE) {
  console.error(JSON.stringify({ error: 'Refusing to edit environment.prod.ts without --force. Production should not silently flip to mocks.' }));
  process.exit(1);
}

const src = fs.readFileSync(FILE, 'utf8');

// ─── locate the environment object literal ──────────────────────────
// Match `export const environment = {` then scan until the matching '}'.
const declRe = /export\s+const\s+environment\s*=\s*\{/;
const declMatch = declRe.exec(src);
if (!declMatch) {
  console.error(JSON.stringify({ error: `No 'export const environment = {' in ${FILE}` }));
  process.exit(1);
}
const objStart = declMatch.index + declMatch[0].length - 1; // pointer at the '{'
let depth = 0;
let i = objStart;
while (i < src.length) {
  const ch = src[i];
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) break;
  }
  i++;
}
if (depth !== 0) {
  console.error(JSON.stringify({ error: 'Unbalanced braces in environment object literal.' }));
  process.exit(1);
}
const objEnd = i; // index of the closing '}'
const objBody = src.slice(objStart + 1, objEnd); // content between { and }

// ─── parse current mockMode (string match — safe within an object literal) ──
const mockModeRe = /(^|[\s,{])mockMode\s*:\s*(true|false)\s*(,|\s|$)/m;
const mockMatch = mockModeRe.exec(objBody);
const currentValue = mockMatch ? mockMatch[2] : null;

if (CHECK) {
  console.log(JSON.stringify({
    file: FILE,
    isProd,
    mockMode: currentValue === null ? 'missing' : currentValue === 'true',
  }));
  process.exit(0);
}

if (ADD_DEFAULT && currentValue !== null) {
  console.log(JSON.stringify({ file: FILE, action: 'kept', mockMode: currentValue === 'true' }));
  process.exit(0);
}

// ─── compute new body ────────────────────────────────────────────────
let newBody;
if (currentValue !== null) {
  // Replace the existing literal.
  newBody = objBody.replace(mockModeRe, (whole, lead, _val, tail) => {
    // Preserve leading and trailing punctuation/whitespace.
    return `${lead}mockMode: ${VALUE}${tail}`;
  });
} else {
  // Insert after the first non-empty line — typically after `production: ...`.
  // Use the indentation of the next line.
  const lines = objBody.split(/\r?\n/);
  // Find the first content line to detect indentation.
  const firstContentIdx = lines.findIndex(l => /\S/.test(l));
  const indent = firstContentIdx >= 0
    ? (lines[firstContentIdx].match(/^\s*/) || [''])[0]
    : '  ';
  // Insert as a new line right after firstContentIdx; if firstContentIdx is -1 (empty),
  // insert at top.
  const insertAt = firstContentIdx >= 0 ? firstContentIdx + 1 : 0;
  lines.splice(insertAt, 0, `${indent}mockMode: ${VALUE},  // managed by /angular-admin-design:aad-switch`);
  newBody = lines.join('\n');
}

const newSrc = src.slice(0, objStart + 1) + newBody + src.slice(objEnd);

// Sanity check: file shouldn't shrink dramatically (defensive)
if (Math.abs(newSrc.length - src.length) > 200 && !flag('--unsafe-large-diff')) {
  console.error(JSON.stringify({ error: 'Refusing to write — diff size unexpectedly large. Inspect manually.' }));
  process.exit(1);
}

fs.writeFileSync(FILE, newSrc);
console.log(JSON.stringify({
  file: FILE,
  action: currentValue === null ? 'added' : (currentValue === VALUE ? 'unchanged' : 'updated'),
  mockMode: VALUE === 'true',
  previous: currentValue,
}));
