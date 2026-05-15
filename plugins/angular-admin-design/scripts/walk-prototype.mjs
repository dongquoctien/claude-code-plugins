#!/usr/bin/env node
// Parse a Chrome MCP accessibility-tree snapshot (.txt) and extract walk
// candidates — elements the auto-walk loop in /aad-plan should click to
// reveal deeper UI state (tabs, modal triggers, accordion headers,
// dropdowns).
//
// v0.6.0 — used by aad-plan Step 5.6 after the initial snapshot. Limits
// candidates to a budget (default 5) so large SPAs don't blow up runtime.
//
// Output (JSON to stdout):
//   {
//     candidates: [
//       { uid, kind, label, priority, rationale, parentContext, lineNumber }
//     ],
//     stats: { totalElements, byRole: {...}, candidatesByKind: {...} }
//   }
//
// Usage:
//   node walk-prototype.mjs --in-file <abs-path-to-snapshot.txt>
//                           [--budget 5]
//                           [--exclude-context <substring>] (repeatable)
//   echo "$SNAPSHOT" | node walk-prototype.mjs --stdin

import fs from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function allArgs(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && i + 1 < process.argv.length) out.push(process.argv[i + 1]);
  }
  return out;
}
function flag(name) { return process.argv.includes(name); }

const IN_FILE = arg('--in-file', '');
const BUDGET = parseInt(arg('--budget', '5'), 10);
const EXCLUDE_CONTEXTS = allArgs('--exclude-context');
const EXCLUDE_UIDS = new Set(allArgs('--exclude-uid'));
const USE_STDIN = flag('--stdin');

if (!IN_FILE && !USE_STDIN) {
  console.error(JSON.stringify({ error: 'No --in-file or --stdin' }));
  process.exit(1);
}

const raw = USE_STDIN ? fs.readFileSync(0, 'utf8') : fs.readFileSync(IN_FILE, 'utf8');

// ─── Parse a11y tree ────────────────────────────────────────────────────
//
// Format per line:
//   <indent-spaces>uid=X_Y <role> "<label>"? <attrs>?
//
// Indent = 2 spaces per level. Each line is one node.
//
// Examples:
//   uid=1_0 RootWebArea "Title" url="..."
//     uid=1_1 button "Open" focused
//     uid=1_2 tab "Booking" selectable selected
//     uid=1_3 combobox expandable haspopup="menu" value="20"

function parseTree(text) {
  const lines = text.split(/\r?\n/);
  const nodes = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    // Indent level by leading spaces / 2
    const m = raw.match(/^(\s*)uid=([\w_]+)\s+(\S+)(.*)$/);
    if (!m) continue;
    const indent = m[1].length / 2;
    const uid = m[2];
    const role = m[3];
    const rest = m[4] || '';

    // Pull out the first quoted label, then attrs.
    // Labels are quoted with " — handle escape-less first occurrence.
    let label = null;
    const lblMatch = rest.match(/^\s*"((?:[^"\\]|\\.)*)"/);
    const attrsStart = lblMatch ? rest.indexOf(lblMatch[0]) + lblMatch[0].length : 0;
    if (lblMatch) label = lblMatch[1];
    const attrsText = rest.slice(attrsStart);

    // Parse attrs (key=value pairs OR bare flag words)
    const attrs = {};
    const flags = new Set();
    // key="value" or key=value
    const attrRe = /(\w+)=("[^"]*"|\S+)/g;
    let am;
    while ((am = attrRe.exec(attrsText)) !== null) {
      let val = am[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      attrs[am[1]] = val;
    }
    // bare flag words (focused, selected, checked, expanded, disabled, etc.)
    const remaining = attrsText.replace(attrRe, '').trim();
    for (const w of remaining.split(/\s+/)) {
      if (w && /^[a-z][a-z-]+$/.test(w)) flags.add(w);
    }

    nodes.push({ uid, role, label, attrs, flags: [...flags], indent, lineNumber: i + 1, raw });
  }

  // Build parent-child via indent stack
  const stack = [];
  for (const node of nodes) {
    while (stack.length > 0 && stack[stack.length - 1].indent >= node.indent) stack.pop();
    node.parent = stack.length > 0 ? stack[stack.length - 1] : null;
    if (node.parent) {
      node.parent.children = node.parent.children || [];
      node.parent.children.push(node);
    }
    stack.push(node);
  }

  return nodes;
}

// ─── Classify each node as a walk candidate ─────────────────────────────

const KIND_RULES = [
  // Mode/tab selection — top priority for SPAs with multi-mode UI
  {
    kind: 'tab',
    priority: 1,
    test: (n) => n.role === 'tab' && n.flags.includes('selectable') && !n.flags.includes('selected'),
    rationale: 'Unselected selectable tab — likely reveals different content',
  },
  // Modal/drawer triggers — labels matching common verbs
  {
    kind: 'modal-trigger',
    priority: 2,
    test: (n) =>
      n.role === 'button' &&
      n.label &&
      /\b(open|edit|configure|details|view|configure override|edit override|view details|manage)\b/i.test(n.label) &&
      // Don't re-click the entry-point already used by Step 5.6
      !n.flags.includes('focused'),
    rationale: 'Button label matches modal/drawer trigger pattern',
  },
  // History / audit triggers
  {
    kind: 'history-trigger',
    priority: 3,
    test: (n) =>
      n.role === 'button' &&
      n.label &&
      /\b(history|audit|log|view full|see all)\b/i.test(n.label),
    rationale: 'Button reveals history/audit popup',
  },
  // Accordion / disclosure expanders
  {
    kind: 'accordion',
    priority: 4,
    test: (n) =>
      (n.attrs.expanded === 'false' || (n.role === 'button' && n.flags.includes('expandable'))) &&
      n.role !== 'combobox',  // combobox handled separately
    rationale: 'Collapsed accordion — content hidden until clicked',
  },
  // Combobox / dropdown — reveals options
  {
    kind: 'dropdown',
    priority: 5,
    test: (n) =>
      n.role === 'combobox' && n.flags.includes('expandable') && n.attrs.haspopup,
    rationale: 'Dropdown — clicking reveals options list',
  },
  // Add / Create buttons — often reveal form panels
  {
    kind: 'add-form-trigger',
    priority: 6,
    test: (n) =>
      n.role === 'button' &&
      n.label &&
      /^(add|create|new)\b/i.test(n.label.trim()) &&
      !/grid|excel|reset/i.test(n.label),
    rationale: 'Add/Create button — reveals form panel',
  },
];

function classify(node) {
  for (const rule of KIND_RULES) {
    if (rule.test(node)) return rule;
  }
  return null;
}

// Walk parent chain to compose context string (helps user disambiguate)
function parentContext(node, maxDepth = 3) {
  const chain = [];
  let cur = node.parent;
  let d = 0;
  while (cur && d < maxDepth) {
    if (cur.label) chain.push(`${cur.role}:${cur.label}`);
    else if (cur.role) chain.push(cur.role);
    cur = cur.parent;
    d++;
  }
  return chain.reverse().join(' > ');
}

// ─── Build candidates ───────────────────────────────────────────────────

const nodes = parseTree(raw);
const candidates = [];
const stats = {
  totalElements: nodes.length,
  byRole: {},
  candidatesByKind: {},
};

for (const node of nodes) {
  stats.byRole[node.role] = (stats.byRole[node.role] || 0) + 1;
  const cls = classify(node);
  if (!cls) continue;

  const context = parentContext(node);

  // Filter: caller may pass --exclude-context to skip e.g. sidebar/nav clicks
  if (EXCLUDE_CONTEXTS.some(p => context.toLowerCase().includes(p.toLowerCase()))) continue;
  // Filter: caller may pass --exclude-uid to skip already-clicked entry points
  if (EXCLUDE_UIDS.has(node.uid)) continue;

  candidates.push({
    uid: node.uid,
    kind: cls.kind,
    label: node.label || '(no label)',
    priority: cls.priority,
    rationale: cls.rationale,
    parentContext: context,
    lineNumber: node.lineNumber,
  });
  stats.candidatesByKind[cls.kind] = (stats.candidatesByKind[cls.kind] || 0) + 1;
}

// Sort by priority asc, then by line number (earlier in DOM first)
candidates.sort((a, b) => a.priority - b.priority || a.lineNumber - b.lineNumber);

// Apply budget
const truncated = candidates.length > BUDGET;
const finalCandidates = candidates.slice(0, BUDGET);

console.log(JSON.stringify({
  candidates: finalCandidates,
  truncated,
  totalDetected: candidates.length,
  stats,
}, null, 2));
