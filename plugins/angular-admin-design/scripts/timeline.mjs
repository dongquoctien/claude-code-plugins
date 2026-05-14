#!/usr/bin/env node
// Read / append to a feature's .timeline.json + regenerate STATUS.md.
// Adapted from feature-mockup's timeline.mjs but with AAD phases.
//
// Usage:
//   node timeline.mjs append --feature-dir <path> --kind <kind> --summary "..." [--data '<json>']
//   node timeline.mjs read --feature-dir <path>
//   node timeline.mjs regenerate-status --feature-dir <path>
//   node timeline.mjs sync-questions --feature-dir <path> --questions-file <path>
//   node timeline.mjs resolve-question --feature-dir <path> --id <id> [--event <evt-id>]
//
// Phases: planned → generated → mocked → wired-real (terminal but reversible)
// Event kinds: plan | generate | regenerate | mock | switch-on | switch-off | note

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const cmd = process.argv[2];
const FEATURE_DIR = path.resolve(arg('--feature-dir', '.'));
const TIMELINE_FILE = path.join(FEATURE_DIR, '.timeline.json');
const STATUS_FILE = path.join(FEATURE_DIR, 'STATUS.md');

if (!fs.existsSync(FEATURE_DIR)) {
  fs.mkdirSync(FEATURE_DIR, { recursive: true });
}

function loadTimeline() {
  if (!fs.existsSync(TIMELINE_FILE)) {
    return {
      feature: path.basename(FEATURE_DIR),
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      currentPhase: 'planned',
      totals: { planRuns: 0, generateRuns: 0, mockRuns: 0, switchRuns: 0 },
      pending: { openQuestions: [], notes: [] },
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
  if (!last) return 'planned';
  switch (last.kind) {
    case 'plan': return 'planned';
    case 'generate': return 'generated';
    case 'regenerate': return 'generated';
    case 'mock': return 'mocked';
    case 'switch-on':
      return last.data?.target === 'real' ? 'wired-real' : 'mocked';
    case 'switch-off':
      return last.data?.target === 'mock' ? 'mocked' : t.currentPhase;
    default: return t.currentPhase;
  }
}

function recomputeTotals(t) {
  const totals = { planRuns: 0, generateRuns: 0, mockRuns: 0, switchRuns: 0 };
  for (const e of t.events) {
    if (e.kind === 'plan') totals.planRuns++;
    if (e.kind === 'generate' || e.kind === 'regenerate') totals.generateRuns++;
    if (e.kind === 'mock') totals.mockRuns++;
    if (e.kind === 'switch-on' || e.kind === 'switch-off') totals.switchRuns++;
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
  const feature = t.feature;
  const lines = [];
  lines.push(`# Status — ${feature}`);
  lines.push('');
  lines.push(`**Phase:** ${t.currentPhase} · **Last activity:** ${fmtAge(t.lastActivityAt)} (${fmtDate(t.lastActivityAt)})`);
  lines.push('');

  const oq = t.pending.openQuestions || [];
  if (oq.length > 0) {
    const open = oq.filter(q => !q.resolvedBy);
    lines.push(`## Open questions (${open.length} open · ${oq.length - open.length} resolved)`);
    lines.push('');
    for (const q of oq) {
      const resolved = !!q.resolvedBy;
      const tick = resolved ? ' ✓' : '';
      lines.push(`- ${resolved ? '~~' : ''}\`${q.id}\` ${q.text}${resolved ? '~~' : ''}${tick}`);
    }
    lines.push('');
  }

  lines.push('## Recent activity');
  lines.push('');
  lines.push('| When | What |');
  lines.push('|---|---|');
  const recent = t.events.slice(-8).reverse();
  for (const e of recent) lines.push(`| ${fmtDate(e.ts)} | ${e.summary} |`);
  lines.push('');

  lines.push('## Suggested next step');
  lines.push('');
  const phase = t.currentPhase;
  const blockingQuestions = oq.filter(q => !q.resolvedBy);
  if (phase === 'planned' && blockingQuestions.length > 0) {
    lines.push(`There are ${blockingQuestions.length} unresolved question(s) in the plan. Either resolve them by editing \`plan.md\` and re-running plan, or proceed if optional:`);
    lines.push('');
    lines.push('```');
    lines.push(`/angular-admin-design:aad-generate ${feature}`);
    lines.push('```');
  } else if (phase === 'planned') {
    lines.push('Plan is ready. Generate the feature module:');
    lines.push('');
    lines.push('```');
    lines.push(`/angular-admin-design:aad-generate ${feature}`);
    lines.push('```');
  } else if (phase === 'generated') {
    lines.push('Feature scaffolded. Wire mock data so the UI runs without backend:');
    lines.push('');
    lines.push('```');
    lines.push(`/angular-admin-design:aad-mock ${feature}`);
    lines.push('```');
  } else if (phase === 'mocked') {
    lines.push('Mocks wired. The UI runs end-to-end against fixtures. When the real API is ready, switch over:');
    lines.push('');
    lines.push('```');
    lines.push(`/angular-admin-design:aad-switch ${feature} --off`);
    lines.push('```');
  } else if (phase === 'wired-real') {
    lines.push('This feature is wired to the real API. To roll back to mock:');
    lines.push('');
    lines.push('```');
    lines.push(`/angular-admin-design:aad-switch ${feature} --on`);
    lines.push('```');
  }
  lines.push('');

  const lastGenerate = [...t.events].reverse().find(e => e.kind === 'generate' || e.kind === 'regenerate');
  if (lastGenerate && lastGenerate.data?.files) {
    const files = lastGenerate.data.files;
    lines.push(`## Generated files (${files.length})`);
    lines.push('');
    for (const f of files.slice(0, 20)) lines.push(`- \`${f}\``);
    if (files.length > 20) lines.push(`- _(+${files.length - 20} more)_`);
    lines.push('');
  }

  const lastPlan = [...t.events].reverse().find(e => e.kind === 'plan');
  if (lastPlan && lastPlan.data?.reuse) {
    const { reusedCount, newCount } = lastPlan.data.reuse;
    lines.push('## Reuse vs new');
    lines.push('');
    lines.push(`- Reusing ${reusedCount} existing component(s)`);
    lines.push(`- Creating ${newCount} new component(s)`);
    lines.push('');
    lines.push('See `reuse-map.md` for the full mapping.');
    lines.push('');
  }

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
  const evt = { id: nextEventId(t), kind, ts, actor: 'dev', summary, data };
  t.events.push(evt);
  t.lastActivityAt = ts;
  recomputeTotals(t);
  t.currentPhase = recomputePhase(t);
  saveTimeline(t);
  regenerateStatus(t);
  console.log(JSON.stringify({ eventId: evt.id, currentPhase: t.currentPhase }, null, 2));
}
else if (cmd === 'read') {
  console.log(JSON.stringify(loadTimeline(), null, 2));
}
else if (cmd === 'regenerate-status') {
  const t = loadTimeline();
  regenerateStatus(t);
  console.log('STATUS.md regenerated');
}
else if (cmd === 'sync-questions') {
  const t = loadTimeline();
  const qf = arg('--questions-file');
  if (!qf) { console.error('--questions-file required'); process.exit(1); }
  const incoming = JSON.parse(fs.readFileSync(qf, 'utf8'));
  const oldById = new Map((t.pending.openQuestions || []).map(q => [q.id, q]));
  t.pending.openQuestions = incoming.map(q => ({
    ...q,
    resolvedBy: oldById.get(q.id)?.resolvedBy || null,
  }));
  saveTimeline(t);
  regenerateStatus(t);
  console.log(JSON.stringify({ questionCount: t.pending.openQuestions.length }));
}
else if (cmd === 'resolve-question') {
  const t = loadTimeline();
  const id = arg('--id');
  const evt = arg('--event', 'manual');
  if (!id) { console.error('--id required'); process.exit(1); }
  const q = (t.pending.openQuestions || []).find(x => x.id === id);
  if (q) q.resolvedBy = evt;
  saveTimeline(t);
  regenerateStatus(t);
  console.log('resolved');
}
else {
  console.error('Usage: timeline.mjs <append|read|regenerate-status|sync-questions|resolve-question> ...');
  process.exit(1);
}
