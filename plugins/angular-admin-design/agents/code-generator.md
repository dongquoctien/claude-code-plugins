---
name: code-generator
description: "Generate Angular feature module files (NgRx actions/reducers/effects, services, container, components, module, routing) from plan.json + reuse-map.json + project knowledge. Hybrid mode: preview each file and ask the user to confirm (write / skip / edit-then-write) before any disk write. Invoked from /angular-admin-design:aad-generate."
tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# Code Generator Agent

You generate a runnable feature module from a structured plan. **You write code under `{projectRoot}/{routesPath}/<feature>/` — the user's real source tree.** Every file goes through a Hybrid confirmation gate.

## Inputs you receive

```
feature:           kebab-case
domain:            prefix without dash (ad, ho, bs, ...)
scope:             null | 'seller' | 'vendor' (partners-style subtree)
projectRoot:       absolute path
pluginRoot:        absolute path
routesPath:        relative (e.g. 'src/app/routes')
planPath:          absolute path to plan.json
reuseMapPath:      absolute path to reuse-map.json
catalogPath:       absolute path to component-catalog.json
claudeContextDir:  absolute path or null
workingLanguage:   en | ko | vi
i18nFlow:          'scan-download' | 'json-inline' | 'none'
i18nKeyFile:       relative path or null
ngrxLayout:        comma-separated folder list (e.g. "actions,reducers,effects,services,components,containers,models")
```

## Step 0 — Read everything

Before writing a single file:

1. Read `planPath` fully.
2. Read `reuseMapPath` fully.
3. Read `catalogPath` — pay attention to `shared` (for selectors + inputs of components you'll import) and `features` (to find existing API path enums you can extend).
4. Read the 6 knowledge files under `{pluginRoot}/knowledge/` IN ORDER:
   - `angular-9-conventions.md` (file shapes, naming, imports order)
   - `module-prefix-map.md` (validate the prefix)
   - `ngrx-feature-store.md` (mandatory NgRx layout)
   - `kendo-grid-patterns.md` (grid templates)
   - `shared-modules-catalog.md` (wiring shared components)
   - `i18n-flow.md` (which flow to follow)
5. Read `{claudeContextDir}/*.md` if present — these override generic conventions when they conflict.

## Step 1 — Compute target paths

For the feature, derive these absolute paths:

```
featureRoot = {projectRoot}/{routesPath}/{scope or ''}/{feature}
```

(Use `path.join` semantics — drop `scope` segment if null.)

For each file the plan implies, compute its path under `featureRoot`:

```
{featureRoot}/{feature}.module.ts
{featureRoot}/{feature}-routing.module.ts
{featureRoot}/actions/{feature}.actions.ts
{featureRoot}/actions/index.ts
{featureRoot}/reducers/{feature}.reducer.ts
{featureRoot}/reducers/index.ts
{featureRoot}/effects/{feature}.effects.ts
{featureRoot}/effects/index.ts
{featureRoot}/services/{feature}-api.service.ts
{featureRoot}/services/index.ts
{featureRoot}/models/{feature}.model.ts        (if new I-interfaces in plan.models[] without existingInterface)
{featureRoot}/models/api-path.model.ts
{featureRoot}/models/index.ts
{featureRoot}/containers/{feature}.component.ts
{featureRoot}/containers/{feature}.component.html
{featureRoot}/containers/{feature}.component.css
{featureRoot}/containers/index.ts
{featureRoot}/components/{feature}-{section}.component.ts   (one per section that became its own component per reuse-map)
{featureRoot}/components/{feature}-{section}.component.html
{featureRoot}/components/{feature}-{section}.component.css
{featureRoot}/components/index.ts
```

Plus, if `i18nFlow !== 'none'`:

```
{featureRoot}/i18n-keys.md
```

Pre-flight check:
- If `featureRoot` exists with ANY .ts files: stop and ask the user "Feature directory `{featureRoot}` already exists with code. Overwrite each conflicting file with confirmation, skip all, or cancel?"

## Step 2 — Order of generation

Generate files in this order so reviewers see scaffold first, then fill:

1. **models/** — interfaces, api-path enum, index barrel.
2. **actions/** — actions + index barrel.
3. **reducers/** — reducer file, then index.
4. **effects/** — effects, then index.
5. **services/** — api service, then index.
6. **components/** — each feature-local component declared in reuse-map (where `decision: create-feature-component`).
7. **containers/** — the smart component for each screen, plus index barrel.
8. **<feature>-routing.module.ts** — Routes array.
9. **<feature>.module.ts** — last, because its imports[] list depends on everything above.
10. **i18n-keys.md** (if applicable).

## Step 3 — Hybrid confirmation gate (CRITICAL)

For EACH file before calling Write:

1. Compute the full file content in memory.
2. Print a preview block to the user:

```
─── PREVIEW: <path relative to projectRoot> (NN lines) ───
<first 40 lines of the content, with line numbers>
...
(<total lines> lines — full content available on write)
─────────────────────────────────────────────────────
```

3. Ask with `AskUserQuestion`:

> "Write this file?"
> Options:
> - "Write" (Recommended)
> - "Skip — leave this file out"
> - "Edit then write — show me the full content for tweaks"

4. On **Write**: call `Write` with the absolute path. Track the file in `generatedFiles[]`.
5. On **Skip**: track in `skippedFiles[]`. Continue. NOTE: skipping a foundational file (actions/reducer/effects/module) will break the build. Warn the user explicitly the first time they skip a foundational file.
6. On **Edit then write**: print the FULL content (not truncated), ask "Paste your edited version, OR press Y to accept the original as-is" — if Y, write original; if pasted, write the pasted content.

After 3 consecutive "Skip" choices, ask: "You've skipped 3 files in a row. Continue, switch to batch-confirm mode (auto-Write the rest), or cancel?"

**Auto-confirm fast-path**: if the user opts into batch mode AT THE START or after several writes, switch from per-file `AskUserQuestion` to writing without confirm. Always offer this opt-in.

## Step 3.5 — Contract validation gate (v0.3.0, MANDATORY)

**This step runs for every file, even in batch mode.** It's the safety net that catches the 8 v0.1.0 build-blocking bugs (handleError, file-saver, flat gridState, [pageable]=object, etc.) before they hit disk.

For each pending file, BEFORE calling Write:

1. **Pick the validation kind** from the file role:

   | File | `--kind` flag |
   |---|---|
   | `effects/<feature>.effects.ts` | `effects` |
   | `services/<feature>-api.service.ts` | `service` |
   | `<feature>.module.ts` | `module` |
   | `reducers/<feature>.reducer.ts` | `reducer-inner` |
   | `reducers/index.ts` | `reducer-outer` |
   | `actions/<feature>.actions.ts` | `actions` |
   | `containers/<feature>.component.ts` | `container-ts` |
   | `containers/<feature>.component.html` | `container-html` |
   | `components/<feature>-<sub>.component.ts` | `component-ts` |
   | `components/<feature>-<sub>.component.html` | `component-html` |
   | `models/api-path.models.ts` | `api-path` |

   Other files (`index.ts` barrels, model files, .scss) skip validation — they have no contract surface.

2. **Write content to a temp file and invoke the validator:**

   ```bash
   # Use a deterministic temp path so re-runs don't accumulate junk.
   tmpFile="{projectRoot}/.aad-tmp/{feature}/{kind}.ts"
   mkdir -p "$(dirname "$tmpFile")"
   # Write the proposed content to tmpFile via Write tool first.

   node {pluginRoot}/scripts/validate-against-catalog.mjs \
     --catalog "{projectRoot}/{catalog.path}" \
     --reference "{projectRoot}/.claude/angular-admin-design/reference-features.json" \
     --kind {kind} \
     --feature {feature} \
     --content-file "$tmpFile" \
     --json
   ```

3. **Parse the JSON output:**

   ```json
   {
     "ok": false,
     "violations": [
       { "severity": "error", "rule": "coreServiceMethodExists", "location": "line 26",
         "message": "Method 'handleError' does not exist on 'ErrorHandlerService'.",
         "suggestedFix": "Did you mean 'errorHandler'? Valid methods: ..." },
       { "severity": "error", "rule": "importExists", "location": "line 3",
         "message": "Import 'file-saver' is not installed.",
         "suggestedFix": "Use URL.createObjectURL + <a download> pattern." }
     ],
     "summary": { "errors": 2, "warnings": 0 }
   }
   ```

4. **If `ok === true`** AND `summary.warnings === 0`: proceed to Write.

5. **If `ok === true`** AND warnings exist: surface them but proceed (these are advisory). Track in a `warnings[]` collection to summarize at the end.

6. **If `ok === false`** (errors present): DO NOT call Write yet. Two paths:

   **Path A — Auto-fix (preferred for known rules):**
   For each error, try a deterministic auto-fix based on `rule`:

   - `coreServiceMethodExists` rule with closest match in `suggestedFix`: rewrite the call site to use the suggested method. For the canonical `handleError` → `errorHandler` case, also insert the `_catchErr` private helper at the bottom of the class (see `knowledge/ngrx-feature-store.md` "effects/<feature>.effects.ts — canonical from bs-event").

   - `importExists` rule for `file-saver`: remove the import, replace `saveAs(blob, fn)` calls with `this._downloadBlob(blob, fn)`, insert the `_downloadBlob` private helper. (Pattern in `knowledge/kendo-grid-patterns.md` "Excel export".)

   - `gridStateShape` rule: replace flat `{ skip, take, sort, filter }` with nested `{ pageInfo: { skip, take }, sortInfo: [] }`. Mechanical string replace.

   - `selectorNaming` rule (`selectFeatureState` → `selectModuleState`): mechanical string replace.

   - `apiPathFileNaming` rule: rename the import path `../models/api-path.model` → `../models/api-path.models`. ALSO update the actual filename when you generate `models/api-path.models.ts` (note plural).

   - `styleExtensionMatch` rule: replace `.css` → `.scss` (or vice versa) in `styleUrls`, AND ensure the actual style file is generated with the right extension.

   After auto-fixing, re-run the validator on the patched content. If it passes, Write. If new violations appeared, try Path B.

   **Path B — Ask user (fallback for ambiguous):**
   Use `AskUserQuestion`:

   > "Validation found {N} unresolved error(s) in {filePath} after auto-fix. Choose:"
   > - "Apply suggested fix from validator (if available)"
   > - "Accept content as-is and add TODO inline" (only safe for warnings)
   > - "Skip this file entirely — I'll write it manually"
   > - "Abort /aad-generate"

   For "Apply suggested fix": surface the validator's `suggestedFix` field and let the user confirm the mechanical rewrite.

7. **Final state for the file:**

   - `approved` → Write to disk. Track in `generatedFiles[]`.
   - `approved-with-warnings` → Write but mention in final report.
   - `auto-fixed-then-approved` → Write the patched content. Add `autoFixes[]` entry to final summary.
   - `user-resolved` → Write the final content the user picked.
   - `skipped` → Don't write. Track in `skippedFiles[]`.
   - `aborted` → Stop the entire `/aad-generate` run.

8. **Cleanup temp files:** `rm -rf {projectRoot}/.aad-tmp/{feature}/` at the end of the run.

### Reporting auto-fixes

At the end of the run, include in the summary:

```
Auto-fixed during generation:
  ✓ effects/<feature>.effects.ts: handleError → errorHandler + injected _catchErr helper
  ✓ effects/<feature>.effects.ts: removed file-saver import, replaced saveAs with _downloadBlob helper
  ✓ reducers/<feature>.reducer.ts: gridState flat shape → nested pageInfo/sortInfo
```

The user can grep `autoFixes[]` from the timeline event to audit what changed.

## Step 3.6 — Section splitting rule (v0.3.0)

**Goal: match bs-event's container/components layout.** bs-event splits its container into search/form/order-list/control sub-components — the container is ~150 lines, not 600. v0.1.0 generated a 233-line container with all sections inlined, which violates the project's smart/presentational separation.

### Splitting triggers

For each section in `plan.screens[*].sections[*]`:

| Condition | Action |
|---|---|
| `section.fields?.length > 3` | **Split** into `components/<feature>-<section>.component.ts` |
| `section.id === 'search'` (always) | **Split** — search is canonically its own component |
| `section.id === 'form'` OR section has nested form groups | **Split** — forms are canonically their own component |
| `section.id === 'toolbar'` AND fewer than 2 actions | Inline in container (trivial) |
| `section.id === 'result-grid'` | Usually inline — grid is the focal point of the container |
| `section.kind === 'detail'` OR has nested popups | **Split** — match bs-event/components/control |

### Sub-component shape (presentational)

When splitting, the generated component is **dumb** — receives data via @Input, emits user actions via @Output. NO Store injection, NO selectors, NO effects dispatch.

```typescript
import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-<feature>-<section>',
  templateUrl: './<feature>-<section>.component.html',
  styleUrls: ['./<feature>-<section>.component.scss'],
})
export class <Feature><Section>Component implements OnInit {
  // Inputs — data the container provides via [prop]="value$ | async"
  @Input() options: I<...>[] = [];
  @Input() loading = false;
  @Input() defaultValue: any;

  // Outputs — user actions bubbled up to the container for dispatch
  @Output() searchEvent = new EventEmitter<I<...>SearchCondition>();
  @Output() resetEvent = new EventEmitter<void>();

  form: FormGroup;

  constructor(private fb: FormBuilder) {}

  ngOnInit(): void {
    this.form = this._buildForm();
  }

  onSearch(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.searchEvent.emit(this.form.value);
  }

  onReset(): void {
    this.form.reset(this._defaults());
    this.resetEvent.emit();
  }

  private _buildForm(): FormGroup { /* per plan.fields */ }
  private _defaults(): any { /* per plan.fields[*].default */ }
}
```

### Container changes when sections are split

Container becomes a thin orchestrator:

```html
<!-- container.component.html -->
<div class="page">
  <h2>{{ pageTitle }}</h2>

  <!-- search section split into sub-component -->
  <app-<feature>-search
    [hotelSuggestions]="hotelSuggestions$ | async"
    [roomTypeOptions]="roomTypeOptions$ | async"
    [actionOptions]="actionOptions$ | async"
    (searchEvent)="onSearchSubmit($event)"
    (resetEvent)="onSearchReset()">
  </app-<feature>-search>

  <!-- toolbar inlined (trivial) -->
  <div class="toolbar">
    <button [disabled]="(exporting$ | async)" (click)="onExportExcel()">Excel</button>
  </div>

  <!-- result-grid inlined (focal point) -->
  <app-grid-basis
    [columns]="columns"
    [dataList]="list$ | async"
    ...
  ></app-grid-basis>
</div>
```

Container TS only:
- Holds Observable streams from store
- Dispatches actions on @Output events from sub-components
- Manages the grid columns array (or delegates to data service `generateGridColumns()`)
- No FormGroup, no validation logic (lives in the search sub-component)

### Module declarations

Both container and sub-components go in `declarations[]` of the feature module. Update `components/index.ts`:

```typescript
import { <Feature>SearchComponent } from './<feature>-search/<feature>-search.component';
import { <Feature>FormComponent }   from './<feature>-form/<feature>-form.component';

export { <Feature>SearchComponent, <Feature>FormComponent };
export const COMPONENTS = [<Feature>SearchComponent, <Feature>FormComponent];
```

Each sub-component lives in its own folder:
```
components/
├── <feature>-search/
│   ├── <feature>-search.component.ts
│   ├── <feature>-search.component.html
│   └── <feature>-search.component.scss
└── index.ts
```

### When NOT to split

- Section has 0 fields and 0 actions (decoration / placeholder)
- Section has ≤2 simple buttons (inline in container)
- Single-screen feature where `screens.length === 1` AND total field count across all sections ≤ 3 (entire feature can be a one-component container)

## Step 4 — Content generation rules

For each file kind, follow the knowledge files. Key rules:

### models/<feature>.model.ts

For every entry in `plan.models[]` WITHOUT `existingInterface`:

```typescript
export interface <name> {
  <field.name><field.optional ? '?' : ''>: <field.type>;
  // ... preserve order from plan.models[*].fields
}
```

For entries WITH `existingInterface`, do NOT redeclare — instead, re-export from the existing path:

```typescript
export { <name> } from '<existingInterface path>';
```

### models/api-path.model.ts

One enum per feature:

```typescript
export enum <Feature>ApiPath {
  <endpointId-camelCase> = '<endpoint.url>',
  // one per endpoint in plan.endpoints[]
}
```

### actions/<feature>.actions.ts

For each endpoint in `plan.endpoints[]`, emit the request/success/failure triple. Plus state.actions[] from the plan. Use the `[<PascalFeature>] verb phrase` source convention.

### reducers/<feature>.reducer.ts

`featureKey = '<featureCamel>List'` (or another suffix matching state shape — pick `List` if plan.state.shape includes a grid, else `Form`, `Detail`, etc.).

Build `State extends EntityState<...>` if plan has a primary entity (grid-shaped). Else, plain interface State.

`adapter.getInitialState({...})` — initialState fields come from `plan.state.shape`. Each field gets a sensible default (`null`, `false`, `0`, `[]`, `{ skip: 0, take: 50, ... }` for gridState).

Wire reducer cases for every action in plan.state.actions[] following the patterns in `ngrx-feature-store.md`.

### reducers/index.ts

Outer feature key = `<featureCamel>` (no suffix). Wrap the single sub-reducer in `combineReducers`. Re-export selectors using `createSelector(selectListState, fromList.selectXxx)`.

### effects/<feature>.effects.ts

One effect per `plan.state.effects[]` entry. Each effect:
- `ofType(ThisActions.<actionName>)`
- `switchMap(({ ...payload }) => this.service.<method>(...))`
- `map(... => ThisActions.<successAction>(...))`
- `catchError(error => { this._errorService.handleError(error); return of(ThisActions.<failureAction>({ error })); })`

### services/<feature>-api.service.ts

One method per `plan.endpoints[]` entry. Wrap `this.api.post`/`get` (whichever the endpoint method dictates), validate `res.succeedYn` per business rule, throwError on failure.

### containers/<feature>.component.ts

For each screen in `plan.screens[]`, one container:

- Bind `list$`, `loading$`, etc. via `this.store.pipe(select(fromModule.selectXxx))`.
- Build `FormGroup` from `screen.sections[*].fields[*]`.
- `ngOnInit`: dispatch `initComponent` + any initial loads.
- Method per `action.id` in section.actions[] that dispatches.
- `ngOnDestroy`: complete `_unsubscribe$`.

### containers/<feature>.component.html

One template per container. For each section:

- **search**: a `<form [formGroup]="form">` with one child per field, picking the shared component from reuse-map. Bind `[formControlName]="'<field.name>'"`.
- **toolbar**: a `<div class="toolbar">` with buttons.
- **result-grid**: `<app-grid-basis>` (or whatever reuse-map says) bound to `list$ | async`, columns, gridState.

Strings: if `i18nFlow !== 'none'`, use `{{ '<i18n key>' | translate }}`. Else inline literal text in `workingLanguage`.

### <feature>.module.ts

`imports[]` MUST include:
- `CommonModule`, `FormsModule`, `ReactiveFormsModule`
- Every shared module class referenced in reuse-map (`DropdownModule`, `SelectboxModule`, ...)
- Kendo modules per `use-kendo` decisions (`GridModule`, `InputsModule`, ...)
- `<Feature>RoutingModule`
- `StoreModule.forFeature(fromModule.featureKey, fromModule.reducers)`
- `EffectsModule.forFeature([<Feature>Effects])`

`declarations` exports `CONTAINERS` and `COMPONENTS` constants.

### <feature>-routing.module.ts

One Route per screen. Top-level route has `data: { title: '<plan.summary first sentence or feature display name>', store: '<featureCamel>' }`.

### i18n-keys.md (if i18nFlow !== 'none')

Markdown table of all `plan.i18n.keys[]`. Plus reminder to run `npm run scan:i18n` and `npm run download:i18n`.

## Step 5 — Open questions sanity check

Before declaring done, check plan.openQuestions[]:
- If any are `blocks: codegen` or `blocks: both` and unresolved (no `answer` field set by /aad-plan), warn the user:

```
⚠ Plan has unresolved codegen-blocking questions:
  • q-NN: <text>
You should either resolve these by editing plan.md and re-running /aad-plan, or accept that the generated code uses defaults that may need rework.
Continue anyway? (y/n)
```

Default to halting and asking the user.

## Step 6 — Return summary

Reply to parent skill in `workingLanguage`:

```
Generated feature {feature} at {featureRoot}
  • {generatedCount} files written, {skippedCount} skipped
  • Feature module: {feature}.module.ts
  • Containers: {containerCount}
  • Components: {newComponentCount} new, {reusedSharedCount} shared reused
  • Imports: {ngrxImportCount} NgRx, {kendoCount} Kendo, {sharedImportCount} shared

Files:
  ✓ <relative path>  (or ⊘ for skipped)
  ...

Next:
  • Add the feature to app-routing.module.ts: { path: '{feature-no-prefix-or-route-path}', loadChildren: () => import('./routes/{feature}/{feature}.module').then(m => m.{Feature}Module), canActivate: [AuthGuardService] }
  • If i18nFlow=scan-download: `npm run scan:i18n && npm run download:i18n`
  • Wire mock data: `/angular-admin-design:aad-mock {feature}`
```

## What you DO NOT do

- ❌ Run `npm install`, `ng generate`, or any project npm scripts.
- ❌ Touch files outside `featureRoot` (except surfacing the lazy-load line to the user; don't auto-edit `app-routing.module.ts`).
- ❌ Skip the Hybrid confirmation gate. Even in batch mode, batch is user-opt-in.
- ❌ Generate placeholders like `// TODO: implement` when the plan/reuse-map gives you enough to write real code. Half-finished implementations defeat the purpose.
- ❌ Reformat or restructure shared modules' imports — only add the ones you need.
- ❌ Set `*.scss` extensions for component styles if the target project uses `.css` (check via `Glob` on `routesPath`).
