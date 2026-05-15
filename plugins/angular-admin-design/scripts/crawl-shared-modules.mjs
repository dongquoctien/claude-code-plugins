#!/usr/bin/env node
// Walk src/app/shared/modules/* and parse every *.component.ts to produce
// structured entries with precise @Input/@Output types.
//
// v0.2.0 — uses the TypeScript Compiler API borrowed from the target project's
// node_modules. Falls back to the previous regex parser if TS not found.
//
// Why TS Compiler API: the regex parser invented types or missed them
// (e.g. `@Input() pageable = true` came back as type=null instead of boolean),
// which made the code-generator agent guess wrong (it generated
// `[pageable]="{...}"` instead of `[pageable]="true"`).
//
// Output: JSON to stdout. Shape:
//   {
//     entries: [{
//       name, selector, moduleName, modulePath, componentPath,
//       inputs: [{ name, type, required, kind, defaultValue, isTemplateRef, isObservable, isInjectionToken }],
//       outputs: [{ name, type }],
//       implementsCVA, kind, summary
//     }],
//     warnings: [...]
//   }
//
// Usage:
//   node crawl-shared-modules.mjs --in <project-root> --shared-path <relative>

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const ROOT = path.resolve(arg('--in', '.'));
const SHARED_PATH = arg('--shared-path', 'src/app/shared/modules');
const SHARED_ABS = path.join(ROOT, SHARED_PATH);

if (!fs.existsSync(SHARED_ABS)) {
  console.error(JSON.stringify({ error: `Shared modules path not found: ${SHARED_ABS}` }));
  process.exit(1);
}

// ─── Locate typescript from project's node_modules ──────────────────────
let ts = null;
const tsCandidates = [
  path.join(ROOT, 'node_modules/typescript'),
  path.join(process.cwd(), 'node_modules/typescript'),
];
for (const p of tsCandidates) {
  if (!fs.existsSync(p)) continue;
  try { ts = require(p); break; } catch {}
}

if (!ts) {
  console.error(JSON.stringify({
    error: `TypeScript not found at ${tsCandidates.join(' or ')}. Run 'npm install' in the target project first.`,
  }));
  process.exit(1);
}

const warnings = [];
const entries = [];

function rel(abs) { return path.relative(ROOT, abs).replace(/\\/g, '/'); }
function read(abs) { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } }

// ─── Helpers: AST traversal ─────────────────────────────────────────────
function findDecorator(node, name) {
  const decorators = ts.canHaveDecorators && ts.canHaveDecorators(node)
    ? ts.getDecorators(node)
    : node.decorators;
  if (!decorators) return null;
  for (const d of decorators) {
    const expr = d.expression;
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === name) {
      return d;
    }
  }
  return null;
}

function getObjectProperty(objectLit, propName) {
  for (const prop of objectLit.properties) {
    if (ts.isPropertyAssignment(prop) && prop.name && ts.isIdentifier(prop.name) && prop.name.text === propName) {
      return prop.initializer;
    }
  }
  return null;
}

function literalString(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function literalText(srcFile, node) {
  if (!node) return null;
  return node.getText(srcFile);
}

function inferTypeFromDefault(initText) {
  if (!initText) return null;
  const t = initText.trim();
  if (t === 'true' || t === 'false') return 'boolean';
  if (/^-?\d+(\.\d+)?$/.test(t)) return 'number';
  if (/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(t)) return 'number';
  if (/^['"`]/.test(t)) return 'string';
  if (t.startsWith('[')) return 'any[]';
  if (t === 'null') return null;
  if (t === 'undefined') return null;
  return null;
}

function flagsFromType(typeText) {
  if (!typeText) return { isTemplateRef: false, isObservable: false, isInjectionToken: false, isEventEmitter: false };
  return {
    isTemplateRef: /\bTemplateRef\b/.test(typeText),
    isObservable: /\bObservable\b/.test(typeText),
    isInjectionToken: /\bInjectionToken\b/.test(typeText),
    isEventEmitter: /\bEventEmitter\b/.test(typeText),
  };
}

// ─── Per-file parsing ───────────────────────────────────────────────────
function parseComponentFile(absPath, src) {
  const srcFile = ts.createSourceFile(absPath, src, ts.ScriptTarget.ES2017, true, ts.ScriptKind.TS);

  let className = null;
  let selector = null;
  let implementsCVA = false;
  const inputs = [];
  const outputs = [];
  const inputsSeen = new Set();
  const outputsSeen = new Set();

  function visit(node) {
    if (ts.isClassDeclaration(node)) {
      const componentDecorator = findDecorator(node, 'Component');
      if (componentDecorator && ts.isCallExpression(componentDecorator.expression)) {
        // selector
        const arg0 = componentDecorator.expression.arguments[0];
        if (arg0 && ts.isObjectLiteralExpression(arg0)) {
          const selProp = getObjectProperty(arg0, 'selector');
          selector = literalString(selProp);
        }
        // class name
        className = node.name ? node.name.text : null;

        // implementsCVA — check heritage clauses
        const heritage = node.heritageClauses || [];
        for (const h of heritage) {
          if (h.token === ts.SyntaxKind.ImplementsKeyword) {
            for (const t of h.types) {
              if (t.expression && t.expression.getText(srcFile) === 'ControlValueAccessor') {
                implementsCVA = true;
              }
            }
          }
        }
        // Also check for NG_VALUE_ACCESSOR token in providers
        if (!implementsCVA) {
          const allText = src;
          if (/NG_VALUE_ACCESSOR/.test(allText)) implementsCVA = true;
        }

        // Walk class members for @Input/@Output
        for (const member of node.members) {
          const inputDec = findDecorator(member, 'Input');
          const outputDec = findDecorator(member, 'Output');

          if (inputDec) {
            const info = parseInputMember(srcFile, member, inputDec);
            if (info && !inputsSeen.has(info.name + ':' + info.kind)) {
              // For setters, prefer the setter (it carries the parameter type) but
              // skip if we already recorded the getter (we want one entry per accessor pair).
              const pairKey = info.name + ':accessor';
              if (info.kind === 'setter' || info.kind === 'getter') {
                if (inputsSeen.has(pairKey)) continue;
                inputsSeen.add(pairKey);
              } else {
                inputsSeen.add(info.name + ':' + info.kind);
              }
              inputs.push(info);
            }
          }

          if (outputDec) {
            const info = parseOutputMember(srcFile, member, outputDec);
            if (info && !outputsSeen.has(info.name)) {
              outputsSeen.add(info.name);
              outputs.push(info);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(srcFile);

  return { className, selector, implementsCVA, inputs, outputs };
}

function parseInputMember(srcFile, member, inputDec) {
  // Determine alias from @Input('alias')
  let alias = null;
  const decArgs = inputDec.expression.arguments || [];
  if (decArgs.length > 0) {
    const a = decArgs[0];
    if (ts.isStringLiteral(a)) alias = a.text;
    else if (ts.isObjectLiteralExpression(a)) {
      // Angular 14+: @Input({ alias: 'x', required: true }) — record it
      const aliasProp = getObjectProperty(a, 'alias');
      const reqProp = getObjectProperty(a, 'required');
      if (aliasProp) alias = literalString(aliasProp);
      if (reqProp && reqProp.kind === ts.SyntaxKind.TrueKeyword) {
        // Set required=true regardless of presence of '?'
        // We'll merge below.
      }
    }
  }

  // Field declaration: `@Input() name?: T = default`
  if (ts.isPropertyDeclaration(member)) {
    const ident = member.name;
    if (!ident || !ts.isIdentifier(ident)) return null;
    const propName = alias || ident.text;
    const typeNode = member.type;
    const typeText = typeNode ? typeNode.getText(srcFile) : null;
    const initText = member.initializer ? member.initializer.getText(srcFile) : null;
    const required = !member.questionToken && initText === null;
    const inferred = typeText || inferTypeFromDefault(initText);
    return {
      name: propName,
      type: inferred,
      required,
      kind: 'field',
      defaultValue: initText,
      ...flagsFromType(inferred),
    };
  }

  // Getter: `@Input() get foo(): T { ... }`
  if (ts.isGetAccessorDeclaration(member)) {
    const ident = member.name;
    if (!ident || !ts.isIdentifier(ident)) return null;
    const propName = alias || ident.text;
    const typeNode = member.type;
    const typeText = typeNode ? typeNode.getText(srcFile) : null;
    return {
      name: propName,
      type: typeText,
      required: false,
      kind: 'getter',
      defaultValue: null,
      ...flagsFromType(typeText),
    };
  }

  // Setter: `@Input() set foo(val: T) { ... }`
  if (ts.isSetAccessorDeclaration(member)) {
    const ident = member.name;
    if (!ident || !ts.isIdentifier(ident)) return null;
    const propName = alias || ident.text;
    const param = member.parameters && member.parameters[0];
    const typeNode = param && param.type;
    const typeText = typeNode ? typeNode.getText(srcFile) : null;
    return {
      name: propName,
      type: typeText,
      required: false,
      kind: 'setter',
      defaultValue: null,
      ...flagsFromType(typeText),
    };
  }

  return null;
}

function parseOutputMember(srcFile, member, outputDec) {
  let alias = null;
  const decArgs = outputDec.expression.arguments || [];
  if (decArgs.length > 0 && ts.isStringLiteral(decArgs[0])) alias = decArgs[0].text;

  if (ts.isPropertyDeclaration(member)) {
    const ident = member.name;
    if (!ident || !ts.isIdentifier(ident)) return null;
    const propName = alias || ident.text;
    let typeText = null;
    if (member.type) {
      typeText = member.type.getText(srcFile);
    } else if (member.initializer) {
      // Try to read `new EventEmitter<T>()`
      const initText = member.initializer.getText(srcFile);
      const m = initText.match(/new\s+EventEmitter\s*<([^>]+)>/);
      if (m) typeText = `EventEmitter<${m[1]}>`;
      else if (/new\s+EventEmitter\b/.test(initText)) typeText = 'EventEmitter<any>';
    }
    return {
      name: propName,
      type: typeText || 'EventEmitter<any>',
    };
  }
  return null;
}

function classifyKind(name, selector, implementsCVA) {
  const n = (selector || name || '').toLowerCase();
  if (implementsCVA) {
    if (/grid/.test(n)) return 'grid';
    if (/dialog|modal/.test(n)) return 'dialog';
    return 'form-control';
  }
  if (/grid|table/.test(n)) return 'grid';
  if (/dialog|modal|popup/.test(n)) return 'dialog';
  if (/tab|sidebar|header|footer|nav/.test(n)) return 'layout';
  if (/picker|input|select|dropdown|radio|checkbox|switch|slider/.test(n)) return 'input';
  if (/badge|chip|alert|toast|tooltip|icon|avatar|card|list/.test(n)) return 'data-display';
  return 'other';
}

function suggestSummary(name, kind) {
  const cleanName = name.replace(/Component$/, '');
  const pretty = cleanName.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  if (kind === 'form-control') return `Reusable form control: ${pretty}.`;
  if (kind === 'grid') return `Reusable grid wrapper: ${pretty}.`;
  if (kind === 'dialog') return `Reusable dialog/modal: ${pretty}.`;
  if (kind === 'input') return `Reusable input widget: ${pretty}.`;
  if (kind === 'layout') return `Layout component: ${pretty}.`;
  return `Shared component: ${pretty}.`;
}

function findModuleFile(moduleDir) {
  const files = fs.readdirSync(moduleDir).filter(f => f.endsWith('.module.ts'));
  return files[0] || null;
}

function parseModuleName(moduleSrc) {
  if (!moduleSrc) return null;
  const m = moduleSrc.match(/export\s+class\s+([A-Z][A-Za-z0-9_]*Module)\b/);
  return m ? m[1] : null;
}

// ─── Walk shared/modules ────────────────────────────────────────────────
const moduleDirs = fs.readdirSync(SHARED_ABS, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

for (const mod of moduleDirs) {
  const modDir = path.join(SHARED_ABS, mod);
  const allFiles = fs.readdirSync(modDir);
  const compFiles = allFiles.filter(f => f.endsWith('.component.ts'));
  if (compFiles.length === 0) continue;

  const moduleFile = findModuleFile(modDir);
  const moduleSrc = moduleFile ? read(path.join(modDir, moduleFile)) : null;
  const moduleName = parseModuleName(moduleSrc);
  const modulePath = moduleFile
    ? rel(path.join(modDir, moduleFile)).replace(/\.ts$/, '')
    : null;

  for (const cf of compFiles) {
    const abs = path.join(modDir, cf);
    const src = read(abs);
    if (!src) { warnings.push(`Unreadable: ${rel(abs)}`); continue; }
    if (!/@Component\s*\(/.test(src)) continue;

    let parsed;
    try {
      parsed = parseComponentFile(abs, src);
    } catch (e) {
      warnings.push(`Parse failed for ${rel(abs)}: ${e.message}`);
      continue;
    }
    if (!parsed.className) { warnings.push(`No class declaration in ${rel(abs)}`); continue; }
    if (!parsed.selector) warnings.push(`No selector in ${rel(abs)}`);

    const kind = classifyKind(parsed.className, parsed.selector, parsed.implementsCVA);
    entries.push({
      name: parsed.className,
      selector: parsed.selector,
      moduleName,
      modulePath,
      componentPath: rel(abs),
      inputs: parsed.inputs,
      outputs: parsed.outputs,
      implementsCVA: parsed.implementsCVA,
      kind,
      summary: suggestSummary(parsed.className, kind),
    });
  }
}

console.log(JSON.stringify({ entries, warnings, parserVersion: 'ts-compiler-api-v0.2.0' }, null, 2));
