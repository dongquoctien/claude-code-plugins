#!/usr/bin/env node
// Hybrid build orchestrator:
//   1. If a fresh dist/ exists (< 1 day old, non-empty), use it as-is.
//   2. Otherwise check for a build script (package.json scripts: build, build:prod) and ask the user.
//   3. If allowed, run the build (capped to 10 minutes), then collect.
//   4. If skipped or build fails, return a soft-fail so the caller falls back to static copy.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

const ROOT = path.resolve(arg('--in', '.'));
const OUT = path.resolve(arg('--out', './dist-collected'));
const ALLOW_BUILD = flag('--allow-build');
const FORCE_BUILD = flag('--force-build');
const FRESHNESS_HOURS = Number(arg('--freshness-hours', '24'));
const TIMEOUT_MS = Number(arg('--timeout-ms', String(10 * 60 * 1000)));

const exists = p => fs.existsSync(p);
const result = {
  decision: null,            // 'used-existing-dist' | 'built-fresh' | 'build-skipped' | 'no-dist-no-build'
  distPath: null,
  buildCommand: null,
  buildDurationMs: null,
  buildExitCode: null,
  warnings: [],
};

const distCandidates = ['dist', 'build', '.next', 'out', 'public/build'];

function pickFreshDist() {
  const now = Date.now();
  const horizon = now - FRESHNESS_HOURS * 60 * 60 * 1000;
  for (const d of distCandidates) {
    const full = path.join(ROOT, d);
    if (!exists(full)) continue;
    let entries;
    try { entries = fs.readdirSync(full); } catch { continue; }
    if (entries.length === 0) continue;
    // Recursively find the newest CSS/JS file
    let newestMtime = 0;
    let cssCount = 0;
    function scan(dir) {
      let items;
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of items) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) scan(full);
        else if (ent.isFile()) {
          const m = fs.statSync(full).mtimeMs;
          if (m > newestMtime) newestMtime = m;
          if (ent.name.endsWith('.css')) cssCount++;
        }
      }
    }
    scan(full);
    if (cssCount > 0 && newestMtime > horizon) return { dir: d, mtime: newestMtime };
  }
  return null;
}

function pickBuildCommand() {
  const pkgPath = path.join(ROOT, 'package.json');
  if (!exists(pkgPath)) return null;
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { return null; }
  const scripts = pkg.scripts || {};
  // Prefer production builds
  const candidates = ['build:prod', 'build:production', 'build', 'build:dev'];
  for (const c of candidates) if (scripts[c]) return { script: c, runner: scripts[c] };
  return null;
}

function runBuild(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const start = Date.now();
  const proc = spawnSync(npm, ['run', script], {
    cwd: ROOT,
    stdio: 'inherit',
    timeout: TIMEOUT_MS,
    shell: false,
  });
  return {
    exitCode: proc.status,
    durationMs: Date.now() - start,
    timedOut: proc.error && proc.error.code === 'ETIMEDOUT',
  };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

// ─── Decide path ──────────────────────────────────────────────────────
let pickedDist = pickFreshDist();

if (FORCE_BUILD) pickedDist = null;

if (!pickedDist && ALLOW_BUILD) {
  const buildCmd = pickBuildCommand();
  if (buildCmd) {
    result.buildCommand = buildCmd.script + ' (' + buildCmd.runner + ')';
    process.stderr.write('\n[build-and-collect] Running: npm run ' + buildCmd.script + '\n');
    process.stderr.write('[build-and-collect] This can take several minutes...\n\n');
    const r = runBuild(buildCmd.script);
    result.buildExitCode = r.exitCode;
    result.buildDurationMs = r.durationMs;
    if (r.timedOut) result.warnings.push(`Build timed out after ${TIMEOUT_MS / 1000}s.`);
    if (r.exitCode === 0) {
      pickedDist = pickFreshDist();
      if (pickedDist) result.decision = 'built-fresh';
      else result.warnings.push('Build succeeded but no dist/ output detected.');
    } else {
      result.warnings.push(`Build failed with exit code ${r.exitCode}. Falling back.`);
    }
  } else {
    result.warnings.push('No build script found in package.json (looked for build:prod, build:production, build, build:dev).');
  }
} else if (!pickedDist && !ALLOW_BUILD) {
  result.decision = 'build-skipped';
  result.warnings.push('No fresh dist/ found and --allow-build not passed. Caller should fall back to static copy.');
}

// ─── Collect ──────────────────────────────────────────────────────────
if (pickedDist) {
  if (!result.decision) result.decision = 'used-existing-dist';
  result.distPath = pickedDist.dir;
  fs.mkdirSync(OUT, { recursive: true });
  copyDir(path.join(ROOT, pickedDist.dir), OUT);
} else if (!result.decision) {
  result.decision = 'no-dist-no-build';
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.distPath ? 0 : 2);  // exit 2 = soft-fail, caller should fallback
