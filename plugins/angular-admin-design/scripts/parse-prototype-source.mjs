#!/usr/bin/env node
// Parse a TSX/JSX/HTML prototype source file to extract UI signals that
// browser-MCP DOM inspection misses (event handler names, useState initial
// shapes, fetch URLs, JSX component composition).
//
// v0.8.0 — complements v0.5.0-v0.7.x browser inspection. Source parsing
// is fast (no browser needed), reveals handler logic + initial state,
// and works on local files that can't be served.
//
// Output JSON:
//   {
//     kind: 'tsx' | 'jsx' | 'html',
//     file: <path>,
//     events: [{ handler, element, eventName, line }],       // onClick={handleSave} etc.
//     state: [{ name, initial, type, line }],                 // useState(...), useReducer(...)
//     endpoints: [{ url, method, source, line }],             // fetch('...'), axios.get('...')
//     components: [{ name, props, children, line }],          // <Drawer mode="..." onClose={...}>
//     warnings: []
//   }
//
// Usage:
//   node parse-prototype-source.mjs --in <abs-path-to-file>
//                                   --project-root <path>  (for TS package resolution)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const IN = path.resolve(arg('--in', ''));
const PROJECT_ROOT = path.resolve(arg('--project-root', '.'));

if (!IN || !fs.existsSync(IN)) {
  console.error(JSON.stringify({ error: `File not found: ${IN}` }));
  process.exit(1);
}

const ext = path.extname(IN).toLowerCase();
const kind = (ext === '.tsx' || ext === '.ts') ? 'tsx'
           : (ext === '.jsx' || ext === '.js') ? 'jsx'
           : (ext === '.html' || ext === '.htm') ? 'html'
           : null;

if (!kind) {
  console.error(JSON.stringify({ error: `Unsupported file extension: ${ext}` }));
  process.exit(1);
}

const source = fs.readFileSync(IN, 'utf8');
const warnings = [];

// ─── For TSX/JSX: use TypeScript Compiler API ──────────────────────────
let ts = null;
if (kind === 'tsx' || kind === 'jsx') {
  const candidates = [
    path.join(PROJECT_ROOT, 'node_modules/typescript'),
    path.join(process.cwd(), 'node_modules/typescript'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try { ts = require(p); break; } catch {}
  }
  if (!ts) {
    warnings.push(`TypeScript not found in ${candidates.join(' or ')}. Falling back to regex-only parsing — accuracy degraded.`);
  }
}

// ─── Output collectors ─────────────────────────────────────────────────
const events = [];
const state = [];
const endpoints = [];
const components = [];

// ─── TSX/JSX parser via Compiler API ───────────────────────────────────

function parseTsx(src) {
  if (!ts) {
    parseTsxFallback(src);
    return;
  }
  const sourceFile = ts.createSourceFile(IN, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);

  function lineOf(node) {
    return ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1;
  }

  function visit(node) {
    // useState / useReducer / useRef
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fnName = node.expression.text;
      if (fnName === 'useState' || fnName === 'useReducer' || fnName === 'useRef') {
        // Find parent variable declaration to get the name
        let p = node.parent;
        while (p && !ts.isVariableDeclaration(p)) p = p.parent;
        if (p && ts.isVariableDeclaration(p)) {
          let name = null;
          let setter = null;
          if (ts.isArrayBindingPattern(p.name)) {
            name = p.name.elements[0]?.name?.getText(sourceFile);
            setter = p.name.elements[1]?.name?.getText(sourceFile);
          } else {
            name = p.name.getText(sourceFile);
          }
          const initialArg = node.arguments[0];
          let initial = null;
          if (initialArg) {
            initial = initialArg.getText(sourceFile).slice(0, 200);
          }
          state.push({
            name,
            setter,
            hookKind: fnName,
            initial,
            type: p.type ? p.type.getText(sourceFile) : null,
            line: lineOf(node),
          });
        }
      }
      // fetch('...') calls
      else if (fnName === 'fetch') {
        const urlArg = node.arguments[0];
        if (urlArg && (ts.isStringLiteral(urlArg) || ts.isNoSubstitutionTemplateLiteral(urlArg))) {
          // Look at second arg for method
          let method = 'GET';
          const optsArg = node.arguments[1];
          if (optsArg && ts.isObjectLiteralExpression(optsArg)) {
            const methodProp = optsArg.properties.find(pr =>
              ts.isPropertyAssignment(pr) && ts.isIdentifier(pr.name) && pr.name.text === 'method',
            );
            if (methodProp && ts.isStringLiteral(methodProp.initializer)) {
              method = methodProp.initializer.text;
            }
          }
          endpoints.push({
            url: urlArg.text,
            method,
            source: 'fetch',
            line: lineOf(node),
          });
        }
      }
    }

    // axios.get / axios.post / api.get etc.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const obj = node.expression.expression.getText(sourceFile);
      const method = node.expression.name.text;
      if ((obj === 'axios' || obj.endsWith('Api') || obj === 'api' || obj === 'http')
          && ['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        const urlArg = node.arguments[0];
        if (urlArg && (ts.isStringLiteral(urlArg) || ts.isNoSubstitutionTemplateLiteral(urlArg))) {
          endpoints.push({
            url: urlArg.text,
            method: method.toUpperCase(),
            source: `${obj}.${method}`,
            line: lineOf(node),
          });
        }
      }
    }

    // JSX elements: extract event-handler props + child components
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile);
      const props = [];
      const eventHandlers = [];

      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
        const propName = attr.name.text;
        let valueText = null;
        if (attr.initializer) {
          if (ts.isStringLiteral(attr.initializer)) valueText = attr.initializer.text;
          else if (ts.isJsxExpression(attr.initializer)) {
            valueText = attr.initializer.expression
              ? attr.initializer.expression.getText(sourceFile).slice(0, 120)
              : null;
          }
        }
        props.push({ name: propName, value: valueText });

        // Event handler prop: onClick / onChange / onSubmit / on*
        if (/^on[A-Z]/.test(propName)) {
          eventHandlers.push({
            handler: valueText,
            element: tagName,
            eventName: propName,
            line: lineOf(node),
          });
        }
      }

      events.push(...eventHandlers);

      // Track component composition — first-letter-uppercase tags are React components
      if (/^[A-Z]/.test(tagName)) {
        components.push({
          name: tagName,
          props: props.map(p => p.name),
          line: lineOf(node),
        });
      }
    }

    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function parseTsxFallback(src) {
  // Regex fallback when ts not available — much less accurate.
  // useState
  const useStateRe = /const\s+\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*useState\s*<?[^>]*>?\s*\(([^)]*)\)/g;
  let m;
  while ((m = useStateRe.exec(src)) !== null) {
    state.push({
      name: m[1], setter: m[2], hookKind: 'useState',
      initial: m[3].trim().slice(0, 200),
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  // useReducer
  const useReducerRe = /const\s+\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*useReducer\s*\(/g;
  while ((m = useReducerRe.exec(src)) !== null) {
    state.push({
      name: m[1], setter: m[2], hookKind: 'useReducer',
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  // onSomething={handler}
  const handlerRe = /<([A-Za-z][A-Za-z0-9]*)\b[^>]*\b(on[A-Z]\w*)\s*=\s*\{(\w+)\}/g;
  while ((m = handlerRe.exec(src)) !== null) {
    events.push({
      handler: m[3], element: m[1], eventName: m[2],
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  // fetch('...')
  const fetchRe = /fetch\s*\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = fetchRe.exec(src)) !== null) {
    endpoints.push({
      url: m[1], method: 'GET', source: 'fetch',
      line: src.slice(0, m.index).split('\n').length,
    });
  }
}

// ─── HTML parser (regex — no DOM lib bundled) ──────────────────────────

function parseHtml(src) {
  // onclick="handler()" attributes (rare but possible in static prototypes)
  const handlerRe = /<(\w+)\b[^>]*\b(on\w+)\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = handlerRe.exec(src)) !== null) {
    events.push({
      handler: m[3], element: m[1], eventName: m[2],
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  // <a href="..."> + <form action="..."> as proxy "endpoints"
  const linkRe = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/g;
  while ((m = linkRe.exec(src)) !== null) {
    const url = m[1];
    if (url.startsWith('http') || url.startsWith('/api')) {
      endpoints.push({
        url, method: 'GET', source: 'a[href]',
        line: src.slice(0, m.index).split('\n').length,
      });
    }
  }
  const formRe = /<form\b[^>]*\baction\s*=\s*["']([^"']+)["'][^>]*\bmethod\s*=\s*["'](\w+)["']/gi;
  while ((m = formRe.exec(src)) !== null) {
    endpoints.push({
      url: m[1], method: m[2].toUpperCase(), source: 'form[action]',
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  // <script type="application/json"> data hints — name from id or context
  // Just count to surface in warnings
  const scriptDataRe = /<script[^>]*type\s*=\s*["']application\/json["'][^>]*>/g;
  const scriptDataCount = (src.match(scriptDataRe) || []).length;
  if (scriptDataCount > 0) {
    warnings.push(`Found ${scriptDataCount} inline <script type="application/json"> data block(s). Consider extracting these as mock data.`);
  }
}

// ─── Drive ─────────────────────────────────────────────────────────────

try {
  if (kind === 'tsx' || kind === 'jsx') parseTsx(source);
  else if (kind === 'html') parseHtml(source);
} catch (e) {
  warnings.push(`Parse error: ${e.message}`);
}

// Dedupe events by (element, eventName, handler) — same handler on multiple
// elements still counted separately, but same JSX attribute parsed twice avoided
const seenEv = new Set();
const dedupedEvents = events.filter(e => {
  const k = `${e.element}::${e.eventName}::${e.handler}::${e.line}`;
  if (seenEv.has(k)) return false;
  seenEv.add(k);
  return true;
});

console.log(JSON.stringify({
  kind,
  file: IN.replace(/\\/g, '/'),
  parser: ts ? 'typescript-compiler-api' : (kind === 'html' ? 'regex-html' : 'regex-fallback'),
  stats: {
    eventCount: dedupedEvents.length,
    stateCount: state.length,
    endpointCount: endpoints.length,
    componentCount: components.length,
    warningCount: warnings.length,
  },
  events: dedupedEvents,
  state,
  endpoints,
  components,
  warnings,
}, null, 2));
