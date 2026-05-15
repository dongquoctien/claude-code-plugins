#!/usr/bin/env node
// Run TypeScript --noEmit on the project and filter errors to a specific
// feature's files. Used by /aad-verify after /aad-generate to catch
// compile-time issues the catalog validator can't see (e.g. type narrowing
// failures, missing implementations of @Input setters, return-type mismatch).
//
// Outputs JSON:
//   {
//     ok: bool,
//     totalErrors: number,
//     featureErrors: [{ file, line, col, code, message, kind, suggestedRule }],
//     otherErrors: [...]   ← pre-existing errors in other features, not blocking
//   }
//
// Usage:
//   node verify-feature.mjs \
//     --project-root <path> \
//     --feature <kebab> \
//     --feature-dir <abs-path-to-routes/<feature>/> \
//     [--tsconfig <relative, default tsconfig.app.json>]
//     [--json]
//
// Exit code: 0 if featureErrors is empty, 1 otherwise.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

const ROOT = path.resolve(arg('--project-root', '.'));
const FEATURE = arg('--feature', '');
const FEATURE_DIR = arg('--feature-dir', '');
const TSCONFIG = arg('--tsconfig', 'tsconfig.app.json');
const JSON_OUT = flag('--json');

if (!FEATURE) fail('--feature required');
if (!FEATURE_DIR) fail('--feature-dir required');
if (!fs.existsSync(ROOT)) fail(`project root not found: ${ROOT}`);
if (!fs.existsSync(path.join(ROOT, TSCONFIG))) fail(`tsconfig not found: ${path.join(ROOT, TSCONFIG)}`);

// Resolve feature dir relative to ROOT (so we can match TS output paths,
// which are project-relative).
const featureRel = path.relative(ROOT, path.resolve(FEATURE_DIR)).replace(/\\/g, '/');

// ─── Find tsc binary in project's node_modules ──────────────────────────
const tscBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
if (!fs.existsSync(tscBin)) {
  fail(`tsc not found at ${tscBin}. Run 'npm install' first.`);
}

// ─── Run tsc --noEmit ────────────────────────────────────────────────────
// Use spawnSync (not execFileSync) — tsc exits 1 on errors and execFileSync
// throws, dropping the captured stdout silently on some Node versions.
const result_ = spawnSync(tscBin, ['--noEmit', '-p', TSCONFIG], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, NODE_OPTIONS: '--openssl-legacy-provider ' + (process.env.NODE_OPTIONS || '') },
  shell: process.platform === 'win32',  // .cmd files on Windows need shell
});
const stdout = result_.stdout || '';
const stderr = result_.stderr || '';
if (result_.error) {
  fail(`Could not invoke tsc: ${result_.error.message}`);
}

// ─── Parse output ────────────────────────────────────────────────────────
// Format: `<path>(<line>,<col>): error TS<code>: <message>`
const errorRe = /^(.+?)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s+(.+)$/gm;
const allErrors = [];
let m;
const combined = stdout + '\n' + stderr;
while ((m = errorRe.exec(combined)) !== null) {
  const [, file, line, col, code, message] = m;
  // Normalize path separators
  const normalizedFile = file.replace(/\\/g, '/');
  allErrors.push({
    file: normalizedFile,
    line: parseInt(line, 10),
    col: parseInt(col, 10),
    code: 'TS' + code,
    message: message.trim(),
  });
}

// ─── Categorize: feature vs other ────────────────────────────────────────
const featureErrors = [];
const otherErrors = [];
for (const err of allErrors) {
  if (err.file.startsWith(featureRel + '/')) {
    err.kind = classifyError(err);
    err.suggestedRule = suggestRule(err);
    featureErrors.push(err);
  } else {
    otherErrors.push(err);
  }
}

// ─── Classify errors into kinds the auto-fix engine knows ────────────────
function classifyError(err) {
  const c = err.code;
  const msg = err.message;
  if (c === 'TS2339' && /Property '\w+' does not exist on type/.test(msg)) return 'missing-property';
  if (c === 'TS2307' && /Cannot find module/.test(msg)) return 'missing-import';
  if (c === 'TS2322' && /not assignable to type/.test(msg)) return 'type-mismatch';
  if (c === 'TS2305' && /has no exported member/.test(msg)) return 'missing-export';
  if (c === 'TS2304' && /Cannot find name/.test(msg)) return 'undefined-symbol';
  if (c === 'TS2740' || c === 'TS2741') return 'missing-required-prop';
  if (c === 'TS2345' && /Argument of type/.test(msg)) return 'arg-type-mismatch';
  if (c === 'TS6133' && /declared but/.test(msg)) return 'unused-var';
  return 'other';
}

function suggestRule(err) {
  // Maps error kinds to suggested rules that the auto-fix engine in aad-verify
  // skill can match.
  switch (err.kind) {
    case 'missing-property': {
      const m = err.message.match(/Property '(\w+)' does not exist on type '([\w<>,\s]+)'/);
      if (m) return { rule: 'use-catalog-method', missing: m[1], onType: m[2] };
      return null;
    }
    case 'missing-import': {
      const m = err.message.match(/Cannot find module '([^']+)'/);
      if (m) return { rule: 'check-deps', pkg: m[1] };
      return null;
    }
    case 'type-mismatch': {
      const m = err.message.match(/Type '([^']+)' is not assignable to type '([^']+)'/);
      if (m) return { rule: 'fix-binding-type', from: m[1], to: m[2] };
      return null;
    }
    case 'missing-required-prop': {
      const m = err.message.match(/Property '(\w+)' is missing/);
      if (m) return { rule: 'add-required-prop', prop: m[1] };
      return null;
    }
    default: return null;
  }
}

// ─── Output ─────────────────────────────────────────────────────────────
const result = {
  ok: featureErrors.length === 0,
  totalErrors: allErrors.length,
  featureRel,
  featureErrors,
  otherErrors,
  summary: {
    featureErrorCount: featureErrors.length,
    otherErrorCount: otherErrors.length,
    byKind: featureErrors.reduce((acc, e) => {
      acc[e.kind] = (acc[e.kind] || 0) + 1;
      return acc;
    }, {}),
  },
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (featureErrors.length === 0) {
    console.log(`✓ Verify passed for ${FEATURE}: 0 errors in feature files.`);
    if (otherErrors.length > 0) {
      console.log(`  (${otherErrors.length} pre-existing errors in other features — not blocking.)`);
    }
  } else {
    console.log(`✗ Verify failed for ${FEATURE}: ${featureErrors.length} error(s) in feature files.\n`);
    for (const err of featureErrors) {
      console.log(`  ${err.file}:${err.line}:${err.col}  [${err.code} / ${err.kind}]`);
      console.log(`    ${err.message}`);
      if (err.suggestedRule) {
        console.log(`    → suggested rule: ${err.suggestedRule.rule} (${JSON.stringify(err.suggestedRule).slice(0, 80)}...)`);
      }
    }
    console.log('');
    if (otherErrors.length > 0) {
      console.log(`(${otherErrors.length} pre-existing errors in other features — not blocking.)`);
    }
  }
}

process.exit(result.ok ? 0 : 1);

function fail(msg) {
  console.error(JSON.stringify({ error: msg }));
  process.exit(2);
}
