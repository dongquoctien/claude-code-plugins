#!/usr/bin/env node
// Validate a pending file against the project catalog. Used by /aad-generate's
// code-generator agent BEFORE every Write call to refuse files that reference
// nonexistent methods, missing deps, wrong types, or wrong project naming
// conventions.
//
// This is the v0.3.0 contract-validation gate. It catches the 8 v0.1.0
// build-blocking bugs at codegen time instead of letting them slip into
// the user's source tree.
//
// Usage:
//   node validate-against-catalog.mjs \
//     --catalog <path-to-component-catalog.json> \
//     --reference <path-to-reference-features.json> \
//     --content <stdin or --content-file>
//     --content-file <abs-path>  (alt to stdin)
//     --kind <effects|service|module|reducer-inner|reducer-outer|actions|container-ts|container-html|api-path>
//     --feature <kebab>
//     [--json]  (output JSON; default human-readable)
//
// Output: list of violations with severity, rule, location, message, suggestedFix.
// Exit code: 0 = no violations, 1 = violations present.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(name); }

const CATALOG_PATH = arg('--catalog', '');
const REFERENCE_PATH = arg('--reference', '');
const KIND = arg('--kind', '');
const FEATURE = arg('--feature', '');
const CONTENT_FILE = arg('--content-file', '');
const JSON_OUT = flag('--json');

if (!CATALOG_PATH || !fs.existsSync(CATALOG_PATH)) {
  fail('catalog path missing or invalid: ' + CATALOG_PATH);
}
if (!KIND) fail('--kind required');

// Read content from --content-file OR stdin
let content;
if (CONTENT_FILE) {
  if (!fs.existsSync(CONTENT_FILE)) fail('content file not found: ' + CONTENT_FILE);
  content = fs.readFileSync(CONTENT_FILE, 'utf8');
} else {
  // Read all of stdin synchronously.
  try { content = fs.readFileSync(0, 'utf8'); }
  catch { fail('no --content-file and no stdin'); }
}
if (!content || content.length === 0) fail('empty content');

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const reference = REFERENCE_PATH && fs.existsSync(REFERENCE_PATH)
  ? JSON.parse(fs.readFileSync(REFERENCE_PATH, 'utf8'))
  : null;

// ─── Violation collection ───────────────────────────────────────────────
const violations = [];
function violate(severity, rule, location, message, suggestedFix = null) {
  violations.push({ severity, rule, location, message, suggestedFix });
}

// ─── Helpers ────────────────────────────────────────────────────────────
function findLine(text, needle) {
  const idx = text.indexOf(needle);
  if (idx < 0) return null;
  return text.slice(0, idx).split('\n').length;
}
function eachLine(text) {
  return text.split('\n').map((line, i) => ({ line, n: i + 1 }));
}

// ─── Rule helpers — these are the v0.1.0 bug catchers ──────────────────

function ruleImportExists() {
  // For each `import ... from 'pkg'` in the content, check pkg is in
  // catalog.dependencies.installed (skip relative imports and src/app/...).
  const installed = new Set((catalog.dependencies?.installed) || []);
  const re = /^\s*import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"];?$/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('src/') || spec.startsWith('@/')) continue;
    // Resolve scoped package: '@scope/name' or 'name' or 'name/subpath'
    let pkg;
    if (spec.startsWith('@')) {
      const parts = spec.split('/');
      pkg = parts.slice(0, 2).join('/');
    } else {
      pkg = spec.split('/')[0];
    }
    // Whitelist Node built-ins
    if (['fs', 'path', 'url', 'crypto', 'os', 'stream', 'util'].includes(pkg)) continue;
    if (!installed.has(pkg)) {
      const lineNum = content.slice(0, m.index).split('\n').length;
      const suggestion = suggestAlternative(pkg);
      violate(
        'error',
        'importExists',
        `line ${lineNum}`,
        `Import '${pkg}' is not installed in this project's package.json.`,
        suggestion,
      );
    }
  }
}

function suggestAlternative(pkg) {
  const installed = new Set((catalog.dependencies?.installed) || []);
  // Common v0.1.0 mistakes → known alternatives
  if (pkg === 'file-saver') {
    return 'Use URL.createObjectURL + <a download> pattern (see knowledge/kendo-grid-patterns.md "Excel export"). file-saver is not installed in oh-admin.';
  }
  if (pkg === 'lodash-es' && installed.has('lodash')) {
    return `Use 'lodash' instead (which IS installed). Replace import { x } from 'lodash-es' with import * as _ from 'lodash'.`;
  }
  if (pkg === 'uuid') {
    return 'UUID is rarely needed in this project — use rowid-style incremental IDs from _addRowid helper, or accept the type-system warning if you need a real UUID.';
  }
  if (pkg === 'date-fns' && installed.has('moment')) {
    return `Use 'moment' instead (which IS installed). Project uses moment 2.x throughout.`;
  }
  return `Install '${pkg}' with npm install, or use an alternative from the installed deps: ${[...installed].slice(0, 10).join(', ')}...`;
}

function ruleCoreServiceMethodExists() {
  // For each `this.{varName}.{method}(` call, try to detect whether varName
  // is typed against a known core service and whether method exists.
  // Strategy:
  //   1. Find constructor parameters typed as known core service classes
  //      (e.g. `private _errorService: ErrorHandlerService`)
  //   2. For each call `this._errorService.foo(...)`, look up the service's
  //      method list in catalog.coreServices.
  if (!catalog.coreServices || catalog.coreServices.length === 0) return;

  const coreByClass = Object.fromEntries(
    catalog.coreServices.map(s => [s.className, new Set(s.methods.map(m => m.name))]),
  );

  // Map varName -> serviceClass via constructor params (typed inject)
  // Pattern: `(public|private|protected) <name>: <ServiceClass>` inside any constructor.
  const varToClass = {};
  const ctorMatch = content.match(/constructor\s*\(([\s\S]*?)\)\s*\{/);
  if (ctorMatch) {
    const paramsText = ctorMatch[1];
    const paramRe = /(?:public|private|protected|readonly|\s)*\s*([a-zA-Z_$][\w$]*)\s*:\s*([A-Z][A-Za-z0-9_]*)/g;
    let pm;
    while ((pm = paramRe.exec(paramsText)) !== null) {
      const [, varName, className] = pm;
      if (coreByClass[className]) {
        varToClass[varName] = className;
      }
    }
  }

  // Also support `@Inject(TOKEN) varName: SomeInterface` — skip those (not a core class).

  // Scan call sites
  const callRe = /this\.([a-zA-Z_$][\w$]*)\s*\.\s*([a-zA-Z_$][\w$]*)\s*\(/g;
  let cm;
  while ((cm = callRe.exec(content)) !== null) {
    const [, varName, methodName] = cm;
    const className = varToClass[varName];
    if (!className) continue; // not a typed core service
    const methodSet = coreByClass[className];
    if (!methodSet.has(methodName)) {
      const lineNum = content.slice(0, cm.index).split('\n').length;
      const validMethods = [...methodSet].sort();
      const closeMatch = suggestClosestMethod(methodName, validMethods);
      violate(
        'error',
        'coreServiceMethodExists',
        `line ${lineNum}`,
        `Method '${methodName}' does not exist on '${className}'. (This is the v0.1.0 'handleError' bug.)`,
        closeMatch
          ? `Did you mean '${closeMatch}'? Valid methods: ${validMethods.join(', ')}`
          : `Valid methods on ${className}: ${validMethods.join(', ')}`,
      );
    }
  }
}

function suggestClosestMethod(needle, candidates) {
  // Simple substring + Levenshtein-ish heuristic
  const lower = needle.toLowerCase();
  for (const c of candidates) {
    if (c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase())) return c;
  }
  // Fuzzy: same first 3 chars
  const prefix = lower.slice(0, 3);
  const candidate = candidates.find(c => c.toLowerCase().slice(0, 3) === prefix);
  return candidate || null;
}

function ruleStyleExtensionMatch() {
  // Container component should use the project's style extension.
  // v0.4.0: containers and sub-components have different defaults in oh-admin
  // (containers use .css, sub-components in components/ use .scss). We pick
  // the expected ext per `kind`.
  if (KIND !== 'container-ts' && KIND !== 'component-ts') return;
  const expectedExt = detectExpectedStyleExt(KIND);
  if (!expectedExt) return;
  const m = content.match(/styleUrls\s*:\s*\[\s*['"]\.\/([^'"]+)\.(css|scss|sass)['"]/);
  if (!m) return;
  const usedExt = m[2];
  if (usedExt !== expectedExt) {
    const lineNum = content.slice(0, m.index).split('\n').length;
    violate(
      'error',
      'styleExtensionMatch',
      `line ${lineNum}`,
      `${KIND === 'container-ts' ? 'Container' : 'Sub-component'} uses .${usedExt} but project convention is .${expectedExt}.`,
      `Rename the style file to ${m[1]}.${expectedExt} and update styleUrls accordingly.`,
    );
  }
}

function detectExpectedStyleExt(kind) {
  // v0.4.0: separate detection per kind. Containers and sub-components may
  // differ — e.g. in oh-admin, containers use .css and components/ use .scss.
  // We sample reference-features' container vs component files.
  if (!reference || !reference.features) return detectProjectStyleExt(); // fallback to global

  let scss = 0, css = 0;
  const styleUrlRe = /styleUrls\s*:\s*\[\s*['"`]\.\/([^'"`]+)\.(css|scss|sass)['"`]/g;

  for (const f of Object.values(reference.features)) {
    if (kind === 'container-ts') {
      // Sample container.ts source only
      const src = f.container?.source;
      if (!src) continue;
      let m;
      while ((m = styleUrlRe.exec(src)) !== null) {
        if (m[2] === 'scss' || m[2] === 'sass') scss++;
        else css++;
      }
      styleUrlRe.lastIndex = 0;
    } else if (kind === 'component-ts') {
      // For components, we don't have direct snapshots in reference-features.
      // Use a file-system walk on the feature's components/ directory.
      if (!f.featureDir) continue;
      const compsDir = path.join(reference.projectRoot, f.featureDir, 'components');
      try {
        for (const sub of fs.readdirSync(compsDir, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const subDir = path.join(compsDir, sub.name);
          for (const file of fs.readdirSync(subDir)) {
            if (file.endsWith('.component.ts')) {
              try {
                const cSrc = fs.readFileSync(path.join(subDir, file), 'utf8');
                let m;
                while ((m = styleUrlRe.exec(cSrc)) !== null) {
                  if (m[2] === 'scss' || m[2] === 'sass') scss++;
                  else css++;
                }
                styleUrlRe.lastIndex = 0;
              } catch {}
            }
          }
        }
      } catch {}
    }
  }

  if (scss + css < 2) return null;       // too few samples — don't enforce
  if (scss > css * 1.5) return 'scss';
  if (css > scss * 1.5) return 'css';
  return null;
}

function detectProjectStyleExt() {
  // v0.4.0 refined: parse component.ts files to read the actual styleUrls
  // strings, NOT count side-by-side .scss/.css files (those exist due to
  // component generator history regardless of which is referenced).
  // Weight reference-features anchors 3x and catalog.shared 1x.
  let scss = 0, css = 0;

  const styleUrlRe = /styleUrls\s*:\s*\[\s*['"`]\.\/([^'"`]+)\.(css|scss|sass)['"`]/g;

  // 1. Read component.ts files of catalog.shared entries
  if (catalog.shared) {
    for (const e of catalog.shared.slice(0, 20)) {
      if (!e.componentPath) continue;
      const tsAbs = path.join(catalog.projectRoot, e.componentPath);
      try {
        const src = fs.readFileSync(tsAbs, 'utf8');
        let m;
        while ((m = styleUrlRe.exec(src)) !== null) {
          if (m[2] === 'scss' || m[2] === 'sass') scss += 1;
          else css += 1;
        }
        styleUrlRe.lastIndex = 0;
      } catch {}
    }
  }

  // 2. Reference-features anchor components — much higher weight (3x)
  if (reference && reference.features) {
    for (const f of Object.values(reference.features)) {
      const containerTs = f.container?.source;
      if (containerTs) {
        let m;
        while ((m = styleUrlRe.exec(containerTs)) !== null) {
          if (m[2] === 'scss' || m[2] === 'sass') scss += 3;
          else css += 3;
        }
        styleUrlRe.lastIndex = 0;
      }
    }
  }

  // 3. Decision — require a clearer signal than v0.3.0's 1.5x
  if (scss + css < 3) return null;        // too few samples
  if (scss > css * 1.5) return 'scss';
  if (css > scss * 1.5) return 'css';
  return null;                             // ambiguous
}

function ruleSelectorNaming() {
  // reducer-outer should use selectModuleState (bs-event convention),
  // not selectFeatureState.
  if (KIND !== 'reducer-outer') return;
  const m = content.match(/export\s+const\s+selectFeatureState\s*=/);
  if (m) {
    const lineNum = content.slice(0, m.index).split('\n').length;
    violate(
      'warn',
      'selectorNaming',
      `line ${lineNum}`,
      `Top-level selector named 'selectFeatureState'. Project convention is 'selectModuleState' (see bs-event/reducers/index.ts:24).`,
      `Rename: export const selectModuleState = createFeatureSelector<...>(featureKey);`,
    );
  }
}

function ruleApiPathFileNaming() {
  // The api-path file should be 'api-path.models.ts' (PLURAL) per bs-event.
  // We only know the import path by inspecting the content.
  if (KIND !== 'service' && KIND !== 'module' && KIND !== 'container-ts') return;
  const m = content.match(/from\s+['"]\.\.\/models\/api-path\.model['"]/);
  if (m) {
    const lineNum = content.slice(0, m.index).split('\n').length;
    violate(
      'warn',
      'apiPathFileNaming',
      `line ${lineNum}`,
      `Import path 'api-path.model' (singular). Project convention is 'api-path.models' (plural — see bs-event/models/api-path.models.ts).`,
      `Rename the file to api-path.models.ts and update import to '../models/api-path.models'.`,
    );
  }
}

function ruleGridStateShape() {
  // Reducer initialState should use { pageInfo: { skip, take }, sortInfo: [] }
  // not flat { skip, take, sort, filter }.
  if (KIND !== 'reducer-inner') return;
  // Look for flat shape in initialState:
  const initialMatch = content.match(/getInitialState\s*\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!initialMatch) return;
  const body = initialMatch[1];
  // gridState assignment
  const gsMatch = body.match(/gridState\s*:\s*\{([\s\S]*?)\}/);
  if (!gsMatch) return;
  const gsBody = gsMatch[1];
  const hasPageInfo = /pageInfo\s*:/.test(gsBody);
  const hasSortInfo = /sortInfo\s*:/.test(gsBody);
  const hasFlatSkip = /^\s*skip\s*:/m.test(gsBody);
  const hasFlatSort = /^\s*sort\s*:/m.test(gsBody);
  if ((hasFlatSkip || hasFlatSort) && !hasPageInfo && !hasSortInfo) {
    const lineNum = content.slice(0, initialMatch.index + initialMatch[0].indexOf('gridState')).split('\n').length;
    violate(
      'error',
      'gridStateShape',
      `line ${lineNum}`,
      `gridState uses flat shape ({skip, take, sort, filter}). Project convention is nested ({pageInfo: {skip, take}, sortInfo: []}). See bs-event/reducers/bs-event.reducer.ts:58.`,
      `Replace with: gridState: { pageInfo: { skip: 0, take: 20 }, sortInfo: [] }`,
    );
  }
}

function ruleTemplateBindingValid() {
  // For container-html: scan attribute bindings against catalog inputs.
  // Heuristic-only — full template parsing is too expensive. Catch the
  // pattern where [foo]="{...object literal...}" is used on a known boolean input.
  if (KIND !== 'container-html' && KIND !== 'component-html') return;
  // Find <app-xxx ... [attr]="value">
  const tagRe = /<(app-[a-z][a-z0-9-]*)\b([^>]*)>/g;
  let tm;
  while ((tm = tagRe.exec(content)) !== null) {
    const [, selector, attrsRaw] = tm;
    // Look up catalog entry
    const entry = catalog.shared?.find(s => s.selector === selector);
    if (!entry) continue;
    const inputByName = Object.fromEntries((entry.inputs || []).map(i => [i.name, i]));
    // Scan [attr]="..." bindings
    const attrRe = /\[([a-zA-Z][\w-]*)\]\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(attrsRaw)) !== null) {
      const [, attrName, value] = am;
      const input = inputByName[attrName];
      if (!input) {
        const lineNum = content.slice(0, tm.index).split('\n').length;
        violate(
          'warn',
          'templateBindingValid',
          `line ${lineNum}`,
          `<${selector}> has no @Input '${attrName}' (catalog).`,
          `Valid inputs on ${entry.name}: ${Object.keys(inputByName).slice(0, 10).join(', ')}${Object.keys(inputByName).length > 10 ? '...' : ''}`,
        );
        continue;
      }
      // Boolean input but value looks like an object literal
      if (input.type === 'boolean' && /^\s*\{/.test(value)) {
        const lineNum = content.slice(0, tm.index).split('\n').length;
        violate(
          'error',
          'templateBindingValid',
          `line ${lineNum}`,
          `<${selector}> [${attrName}]="${value.slice(0, 40)}..." but catalog says '${attrName}' is boolean.`,
          `Use [${attrName}]="true" or [${attrName}]="false" (or omit — default is ${input.defaultValue || 'undefined'}).`,
        );
      }
    }
  }
}

function ruleSelectorExists() {
  // For container-html: every <app-foo> selector should exist in catalog.shared.
  if (KIND !== 'container-html' && KIND !== 'component-html') return;
  const tagRe = /<(app-[a-z][a-z0-9-]*)\b/g;
  const knownSelectors = new Set((catalog.shared || []).map(s => s.selector).filter(Boolean));
  const seen = new Set();
  let tm;
  while ((tm = tagRe.exec(content)) !== null) {
    const sel = tm[1];
    if (seen.has(sel)) continue;
    seen.add(sel);
    // Self selector — feature module's own components, skip
    if (FEATURE && (sel === `app-${FEATURE}` || sel.startsWith(`app-${FEATURE}-`))) continue;
    if (!knownSelectors.has(sel)) {
      const lineNum = content.slice(0, tm.index).split('\n').length;
      violate(
        'warn',
        'selectorExists',
        `line ${lineNum}`,
        `Selector '${sel}' is not in catalog.shared. May be a Kendo component or a feature-local subcomponent — verify before generating.`,
        `If reusable, add it to shared/modules. If feature-local, generate the component file and add to declarations[].`,
      );
    }
  }
}

function ruleSharedModuleImport() {
  // For module file: every imported NgModule should resolve to a catalog entry
  // (either shared or feature).
  if (KIND !== 'module') return;
  const knownModules = new Set();
  for (const s of (catalog.shared || [])) if (s.moduleName) knownModules.add(s.moduleName);
  for (const f of (catalog.features || [])) if (f.moduleClassName) knownModules.add(f.moduleClassName);

  // Built-in / framework-level
  const allowList = new Set([
    'CommonModule', 'FormsModule', 'ReactiveFormsModule', 'BrowserModule',
    'HttpClientModule', 'RouterModule', 'StoreModule', 'EffectsModule',
    // Kendo
    'GridModule', 'InputsModule', 'DateInputsModule', 'DropDownsModule',
    'ButtonsModule', 'PopupModule', 'ExcelExportModule', 'PDFExportModule',
    'IntlModule', 'L10nModule',
    // Custom kendo wrapper
    'KendoCommonModule',
    // Pipes/Directives shared
    'PipesModule', 'DirectivesModule',
    // CDK
    'DragDropModule', 'ScrollingModule', 'OverlayModule',
  ]);

  // Capture imports[...] block — non-strict
  const importsBlock = content.match(/@NgModule\s*\(\s*\{[\s\S]*?imports\s*:\s*\[([\s\S]*?)\]/);
  if (!importsBlock) return;
  const ids = new Set();
  const idRe = /([A-Z][A-Za-z0-9_]*)(?:\s*\.\s*for(?:Root|Child|Feature)\s*\()?/g;
  let im;
  while ((im = idRe.exec(importsBlock[1])) !== null) ids.add(im[1]);
  // Remove obvious false positives
  ids.delete('Feature'); // from .forFeature
  ids.delete('Root');
  ids.delete('Child');

  for (const id of ids) {
    if (!id.endsWith('Module')) continue;
    if (allowList.has(id)) continue;
    if (knownModules.has(id)) continue;
    // The feature's own routing module is named <Feature>RoutingModule — accept.
    if (FEATURE && id.toLowerCase().includes(FEATURE.replace(/-/g, '').toLowerCase()) && id.endsWith('RoutingModule')) continue;
    violate(
      'warn',
      'sharedModuleImport',
      'imports[]',
      `NgModule '${id}' is not in catalog.shared, catalog.features, or the framework allowlist.`,
      `If this is a shared module, run /aad-index. If it's a Kendo module, add to the allowlist. If it's a typo, fix it.`,
    );
  }
}

function ruleEnvironmentTypeCast() {
  // v0.4.0: code-generator should never emit `(environment as any).mockMode`
  // because aad-mock Step 9 ensures mockMode exists on every env file.
  if (KIND !== 'module' && KIND !== 'effects' && KIND !== 'service') return;
  const re = /\(\s*environment\s+as\s+any\s*\)\s*\.\s*mockMode/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const lineNum = content.slice(0, m.index).split('\n').length;
    violate(
      'warn',
      'environmentTypeCast',
      `line ${lineNum}`,
      `Type-cast '(environment as any).mockMode' is unnecessary — aad-mock Step 9 ensures mockMode is declared on every env file.`,
      `Replace with: environment.mockMode (no cast).`,
    );
  }
}

// ─── Run rules per kind ─────────────────────────────────────────────────
ruleImportExists();
ruleEnvironmentTypeCast();
ruleCoreServiceMethodExists();
ruleStyleExtensionMatch();
ruleSelectorNaming();
ruleApiPathFileNaming();
ruleGridStateShape();
ruleTemplateBindingValid();
ruleSelectorExists();
ruleSharedModuleImport();

// ─── Output ─────────────────────────────────────────────────────────────
const ok = violations.filter(v => v.severity === 'error').length === 0;

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok,
    kind: KIND,
    feature: FEATURE,
    violations,
    summary: {
      errors: violations.filter(v => v.severity === 'error').length,
      warnings: violations.filter(v => v.severity === 'warn').length,
    },
  }, null, 2));
} else {
  if (violations.length === 0) {
    console.log(`✓ ${KIND}: no violations`);
  } else {
    for (const v of violations) {
      const icon = v.severity === 'error' ? '✗' : '⚠';
      console.log(`${icon} [${v.severity}] ${v.rule} @ ${v.location}`);
      console.log(`    ${v.message}`);
      if (v.suggestedFix) console.log(`    → ${v.suggestedFix}`);
    }
    const errs = violations.filter(v => v.severity === 'error').length;
    const warns = violations.filter(v => v.severity === 'warn').length;
    console.log('');
    console.log(`${errs} error(s), ${warns} warning(s)`);
  }
}

process.exit(ok ? 0 : 1);

function fail(msg) {
  console.error(JSON.stringify({ error: msg }));
  process.exit(2);
}
