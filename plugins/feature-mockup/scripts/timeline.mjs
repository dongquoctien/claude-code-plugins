#!/usr/bin/env node
// Read / append to a feature's .timeline.json + regenerate STATUS.md.
//
// Usage:
//   node timeline.mjs append --feature-dir <path> --kind <kind> --summary "..." [--data '<json>']
//   node timeline.mjs read --feature-dir <path>             # prints current timeline JSON
//   node timeline.mjs status --feature-dir <path>           # prints current STATUS summary as JSON
//   node timeline.mjs regenerate-status --feature-dir <path> # rewrites STATUS.md without appending
//   node timeline.mjs sync-gaps --feature-dir <path> --gaps-file <path-to-gaps.json>
//                                                           # replaces pending.gaps from a verify run
//   node timeline.mjs resolve-gaps --feature-dir <path> --ids "id1,id2" --fix-event <evt-id>
//                                                           # marks gaps resolvedBy a fix event
//
// Timeline schema: see docs/timeline-spec.md.

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

const cmd = process.argv[2];
const FEATURE_DIR = path.resolve(arg('--feature-dir', '.'));
const TIMELINE_FILE = path.join(FEATURE_DIR, '.timeline.json');
const STATUS_FILE = path.join(FEATURE_DIR, 'STATUS.md');

if (!fs.existsSync(FEATURE_DIR)) {
  console.error('feature dir not found:', FEATURE_DIR);
  process.exit(1);
}

function loadTimeline() {
  if (!fs.existsSync(TIMELINE_FILE)) {
    return {
      feature: path.basename(FEATURE_DIR),
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      currentPhase: 'drafted',
      totals: { verifyRuns: 0, fixRuns: 0, deployRuns: 0, previewRuns: 0 },
      pending: { gaps: [], notes: [] },
      events: [],
    };
  }
  try { return JSON.parse(fs.readFileSync(TIMELINE_FILE, 'utf8')); }
  catch (e) {
    console.error('failed to parse timeline:', e.message);
    process.exit(1);
  }
}

function saveTimeline(t) {
  fs.writeFileSync(TIMELINE_FILE, JSON.stringify(t, null, 2) + '\n', 'utf8');
}

function nextEventId(t) {
  const max = t.events.reduce((m, e) => {
    const n = parseInt((e.id || '').replace(/^evt-/, ''), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `evt-${String(max + 1).padStart(4, '0')}`;
}

function recomputePhase(t) {
  const last = t.events[t.events.length - 1];
  if (!last) return 'drafted';
  // Only P0+P1 block "fixed" phase. P2 issues are optional polish — they remain
  // pending in STATUS.md but don't keep the feature in "fixing" indefinitely.
  const blockingPending = t.pending.gaps.filter(g => !g.resolvedBy && (g.priority === 'P0' || g.priority === 'P1')).length;
  switch (last.kind) {
    case 'init': return 'drafted';
    case 'theme-import': return 'themed';
    case 'make': return 'drafted';
    case 'preview': {
      const hadVerify = t.events.some(e => e.kind === 'verify');
      return hadVerify ? t.currentPhase : 'previewed';
    }
    case 'verify': return 'verified';
    case 'fix': return blockingPending === 0 ? 'fixed' : 'fixing';
    case 'deploy': return 'deployed';
    default: return t.currentPhase;
  }
}

function recomputeTotals(t) {
  const totals = { verifyRuns: 0, fixRuns: 0, deployRuns: 0, previewRuns: 0 };
  for (const e of t.events) {
    if (e.kind === 'verify') totals.verifyRuns++;
    if (e.kind === 'fix') totals.fixRuns++;
    if (e.kind === 'deploy') totals.deployRuns++;
    if (e.kind === 'preview') totals.previewRuns++;
  }
  t.totals = totals;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toISOString().replace('T', ' ').replace(/:\d\d\.\d{3}Z$/, '');
}

function fmtAge(iso) {
  if (!iso) return '—';
  const now = Date.now();
  const t = new Date(iso).getTime();
  const seconds = Math.floor((now - t) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  if (seconds < 86400 * 7) {
    const days = Math.floor(seconds / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
  return new Date(iso).toISOString().slice(0, 10);
}

function regenerateStatus(t) {
  const lines = [];
  lines.push(`# Status — ${t.feature}`);
  lines.push('');
  const phaseLabel = t.currentPhase === 'fixed' ? 'fixed ✓' : t.currentPhase;
  const phaseSuffix = t.currentPhase === 'fixed' ? ' · all P0/P1 issues resolved · ready to deploy' : '';
  lines.push(`**Phase:** ${phaseLabel} · **Last activity:** ${fmtAge(t.lastActivityAt)} (${fmtDate(t.lastActivityAt)})${phaseSuffix}`);
  lines.push('');

  // Pending section
  const pending = (t.pending.gaps || []).filter(g => !g.resolvedBy);
  const p0 = pending.filter(g => g.priority === 'P0');
  const p1 = pending.filter(g => g.priority === 'P1');
  const p2 = pending.filter(g => g.priority === 'P2');
  if (pending.length > 0) {
    lines.push(`## Pending (${pending.length} items)`);
    lines.push('');
    if (p0.length) {
      lines.push(`### P0 — must fix (${p0.length})`);
      for (const g of p0) lines.push(`- \`${g.id}\` ${g.description}${g.region ? ` _(${g.region})_` : ''}${g.introducedBy ? ` _from ${g.introducedBy}_` : ''}`);
      lines.push('');
    }
    if (p1.length) {
      lines.push(`### P1 — polish (${p1.length})`);
      for (const g of p1) lines.push(`- \`${g.id}\` ${g.description}${g.region ? ` _(${g.region})_` : ''}`);
      lines.push('');
    }
    if (p2.length) {
      lines.push(`### P2 — minor (${p2.length})`);
      for (const g of p2) lines.push(`- \`${g.id}\` ${g.description}`);
      lines.push('');
    }
  } else if (t.events.some(e => e.kind === 'verify')) {
    lines.push('## Pending');
    lines.push('');
    lines.push('No outstanding issues. ✓');
    lines.push('');
  }

  // Recent activity (last 8)
  lines.push('## Recent activity');
  lines.push('');
  lines.push('| When | What |');
  lines.push('|---|---|');
  const recent = t.events.slice(-8).reverse();
  for (const e of recent) {
    lines.push(`| ${fmtDate(e.ts)} | ${e.summary} |`);
  }
  lines.push('');

  // Suggested next step
  lines.push('## Suggested next step');
  lines.push('');
  const feature = t.feature;
  // Filesystem signature: prototype actually exists on disk?
  // (Handles cases where the user copied a folder or the prototype pre-dates v0.21
  // — in either case the timeline lacks a 'make' event but files exist.)
  const prototypeOnDisk =
    fs.existsSync(path.join(FEATURE_DIR, 'index.html')) ||
    fs.existsSync(path.join(FEATURE_DIR, 'package.json'));
  const hasMakeEvent = t.events.some(e => e.kind === 'make');
  const hasPrototype = hasMakeEvent || prototypeOnDisk;
  const blockingPending = pending.filter(g => g.priority === 'P0' || g.priority === 'P1');

  if (blockingPending.length > 0) {
    const cnt = blockingPending.length;
    lines.push(`You have ${cnt} P0/P1 ${cnt === 1 ? 'issue' : 'issues'} to fix. Run:`);
    lines.push('');
    lines.push('```');
    lines.push(`/feature-mockup:fix ${feature}`);
    lines.push('```');
    if (pending.length > blockingPending.length) {
      const p2cnt = pending.length - blockingPending.length;
      lines.push('');
      lines.push(`(Plus ${p2cnt} P2 polish ${p2cnt === 1 ? 'item' : 'items'} you can address later.)`);
    }
  } else if (t.events.some(e => e.kind === 'fix') && !t.events.some(e => e.kind === 'deploy')) {
    lines.push('All P0/P1 fixes applied. Ready to share with stakeholders:');
    lines.push('');
    lines.push('```');
    lines.push(`/feature-mockup:deploy ${feature}`);
    lines.push('```');
    if (pending.length > 0) {
      lines.push('');
      lines.push(`(${pending.length} P2 polish ${pending.length === 1 ? 'item' : 'items'} remain — non-blocking, address before final delivery if you want.)`);
    }
  } else if (hasPrototype && !t.events.some(e => e.kind === 'verify')) {
    lines.push('Prototype is ready but not verified yet. Compare it against the real admin or screenshots:');
    lines.push('');
    lines.push('```');
    lines.push(`/feature-mockup:verify ${feature}`);
    lines.push('```');
    if (!hasMakeEvent && prototypeOnDisk) {
      lines.push('');
      lines.push('_(Note: this prototype existed before timeline tracking. Earlier history is not recorded.)_');
    }
  } else if (!hasPrototype) {
    lines.push('Generate the prototype:');
    lines.push('');
    lines.push('```');
    lines.push(`/feature-mockup:make ${feature} <inputs...>`);
    lines.push('```');
  } else {
    lines.push(`Open the prototype: \`/feature-mockup:preview ${feature}\``);
  }
  lines.push('');

  // Deployments
  const deploys = t.events.filter(e => e.kind === 'deploy');
  if (deploys.length > 0) {
    lines.push('## Deployments');
    lines.push('');
    lines.push('| When | Provider | URL | Expires |');
    lines.push('|---|---|---|---|');
    for (const d of deploys.slice().reverse()) {
      const url = d.data?.url || '—';
      const provider = d.data?.provider || '—';
      const expires = d.data?.expiresAt ? fmtDate(d.data.expiresAt) : 'persistent';
      lines.push(`| ${fmtDate(d.ts)} | ${provider} | ${url} | ${expires} |`);
    }
    lines.push('');
  }

  // Notes
  if ((t.pending.notes || []).length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const n of t.pending.notes) lines.push(`- ${n.text}${n.ts ? ` _(${fmtDate(n.ts)})_` : ''}`);
    lines.push('');
  }

  fs.writeFileSync(STATUS_FILE, lines.join('\n'), 'utf8');
}

// ─── Commands ────────────────────────────────────────────────────────────

if (cmd === 'append') {
  const t = loadTimeline();
  const kind = arg('--kind');
  const summary = arg('--summary', '');
  const dataRaw = arg('--data', null);
  if (!kind) { console.error('--kind required'); process.exit(1); }
  let data = {};
  if (dataRaw) {
    try { data = JSON.parse(dataRaw); }
    catch { console.error('--data must be valid JSON'); process.exit(1); }
  }
  const ts = new Date().toISOString();
  const evt = { id: nextEventId(t), kind, ts, actor: 'ba', summary, data };
  t.events.push(evt);
  t.lastActivityAt = ts;
  recomputeTotals(t);
  t.currentPhase = recomputePhase(t);
  saveTimeline(t);
  regenerateStatus(t);
  console.log(JSON.stringify({ eventId: evt.id, currentPhase: t.currentPhase, pendingCount: t.pending.gaps.filter(g => !g.resolvedBy).length }, null, 2));
}
else if (cmd === 'read') {
  const t = loadTimeline();
  console.log(JSON.stringify(t, null, 2));
}
else if (cmd === 'status') {
  const t = loadTimeline();
  const pending = t.pending.gaps.filter(g => !g.resolvedBy);
  console.log(JSON.stringify({
    feature: t.feature,
    currentPhase: t.currentPhase,
    lastActivityAt: t.lastActivityAt,
    lastActivityAge: fmtAge(t.lastActivityAt),
    totals: t.totals,
    pendingCount: pending.length,
    p0: pending.filter(g => g.priority === 'P0').length,
    p1: pending.filter(g => g.priority === 'P1').length,
    p2: pending.filter(g => g.priority === 'P2').length,
    eventCount: t.events.length,
    lastEvent: t.events[t.events.length - 1] || null,
  }, null, 2));
}
else if (cmd === 'regenerate-status') {
  const t = loadTimeline();
  regenerateStatus(t);
  console.log('STATUS.md regenerated');
}
else if (cmd === 'sync-gaps') {
  // Replace pending.gaps with new findings from a verify run, but preserve
  // resolvedBy for gaps whose IDs are unchanged.
  const t = loadTimeline();
  const gapsFile = arg('--gaps-file');
  if (!gapsFile) { console.error('--gaps-file required'); process.exit(1); }
  let newGaps;
  try { newGaps = JSON.parse(fs.readFileSync(gapsFile, 'utf8')); }
  catch (e) { console.error('failed to load gaps file:', e.message); process.exit(1); }
  if (!Array.isArray(newGaps)) { console.error('gaps file must be a JSON array'); process.exit(1); }

  const oldByid = Object.fromEntries((t.pending.gaps || []).map(g => [g.id, g]));
  t.pending.gaps = newGaps.map(g => {
    const old = oldByid[g.id];
    return {
      id: g.id,
      priority: g.priority,
      region: g.region || null,
      description: g.description,
      introducedBy: old?.resolvedBy ? null : (old?.introducedBy || g.introducedBy || null),
      resolvedBy: old?.resolvedBy || null,
    };
  });
  saveTimeline(t);
  regenerateStatus(t);
  console.log(JSON.stringify({ gapCount: t.pending.gaps.length, pendingCount: t.pending.gaps.filter(g => !g.resolvedBy).length }, null, 2));
}
else if (cmd === 'resolve-gaps') {
  const t = loadTimeline();
  const idsRaw = arg('--ids', '');
  const fixEvent = arg('--fix-event', '');
  const ids = idsRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) { console.error('--ids required (comma-separated)'); process.exit(1); }
  let resolved = 0, missing = [];
  for (const id of ids) {
    const g = t.pending.gaps.find(x => x.id === id);
    if (g) { g.resolvedBy = fixEvent || `fix-${new Date().toISOString()}`; resolved++; }
    else missing.push(id);
  }
  t.currentPhase = recomputePhase(t);
  saveTimeline(t);
  regenerateStatus(t);
  console.log(JSON.stringify({ resolved, missing }, null, 2));
}
else if (cmd === 'add-note') {
  const t = loadTimeline();
  const text = arg('--text', '');
  if (!text) { console.error('--text required'); process.exit(1); }
  t.pending.notes = t.pending.notes || [];
  t.pending.notes.push({ text, ts: new Date().toISOString() });
  saveTimeline(t);
  regenerateStatus(t);
  console.log('note added');
}
else {
  console.error('Unknown command:', cmd);
  console.error('Available: append | read | status | regenerate-status | sync-gaps | resolve-gaps | add-note');
  process.exit(1);
}
