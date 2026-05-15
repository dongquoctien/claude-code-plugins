---
name: aad-verify
description: "Use this after /aad-generate (or anytime to re-check) to run `tsc --noEmit` against the generated feature and surface TypeScript errors with auto-fix suggestions. Filters out pre-existing errors in other features so the report is focused. Optional --build-check runs the full Angular build (slower, catches template errors)."
argument-hint: "<feature-kebab-name> [--build-check]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, AskUserQuestion
---

# Angular Admin Design — Verify

Run TypeScript compile + (optional) full build against the generated feature and surface errors with auto-fix suggestions: **$ARGUMENTS**

## Step 1 — Load config + locate generated feature

1. Find `.claude/angular-admin-design.json`. If missing, stop with init reminder.
2. Extract: `projectRoot`, `workingLanguage`, `outputDir`, `stateDir` (v0.4.0 — falls back to `outputDir` if missing), `profile.routesPath`, `profile.scope` (or null).

`$ARGUMENTS`:
- First token: `<feature>` (required)
- `--build-check`: optional flag — run `ng build` instead of just `tsc --noEmit`

Compute:
- `featureRoot = {projectRoot}/{profile.routesPath}/{feature}` (drop scope segment if null)
- `stateDir = {projectRoot}/{config.stateDir || outputDir}/{feature}` (v0.4.0 — default `.claude/aad/{feature}`)
- `tsconfig = {projectRoot}/tsconfig.app.json` (or per profile)

**Validate**:
- `featureRoot/<feature>.module.ts` exists → ELSE stop "Feature not generated. Run `/aad-generate {feature}` first."

**All user-facing output below in `workingLanguage`.**

## Step 2 — Run TypeScript verify

```bash
node {pluginRoot}/scripts/verify-feature.mjs \
  --project-root "{projectRoot}" \
  --feature {feature} \
  --feature-dir "{featureRoot}" \
  --tsconfig "tsconfig.app.json" \
  --json
```

The script returns JSON:

```json
{
  "ok": false,
  "featureErrors": [
    { "file": "...", "line": 49, "col": 31, "code": "TS2339",
      "kind": "missing-property", "message": "...",
      "suggestedRule": { "rule": "use-catalog-method", "missing": "handleError", "onType": "ErrorHandlerService" } }
  ],
  "otherErrors": [...],
  "summary": { "featureErrorCount": 7, "byKind": { "missing-property": 6, "undefined-symbol": 1 } }
}
```

## Step 3 — Surface results

### If `ok === true`

```
✓ Verify passed: 0 errors in {feature} files.
  ({otherErrorCount} pre-existing errors in other features — not blocking.)
```

If `--build-check` was passed, continue to Step 4. Else log the verify event to timeline and stop.

### If `ok === false`

Surface a grouped error table. Use `AskUserQuestion`:

> "{featureErrorCount} TypeScript error(s) in {feature}. How to proceed?"
> Options:
> - "Auto-fix what I can" (Recommended) — runs auto-fix engine, re-verifies
> - "Show me each error" — interactive walkthrough
> - "Accept as TODOs and stop" — leaves the file as-is; user fixes manually
> - "Abort — rollback the feature" — destructive, deletes featureRoot (with confirm)

## Step 4 — Auto-fix engine

For each error with a `suggestedRule`, apply the fix mechanically based on `rule`:

### `use-catalog-method` (TS2339 missing-property)

```
suggestedRule: { rule: 'use-catalog-method', missing: 'handleError', onType: 'ErrorHandlerService' }
```

1. Read `catalog.coreServices[*]` to find a service with className matching `onType`.
2. Find the closest method name (substring or prefix match).
3. If found, generate an `Edit` patch: replace `<varName>.<missing>(args)` with `<varName>.<correctName>(args, '<context>')` — note the signature may also change (e.g. `errorHandler` requires 2 args; `handleError` was called with 1). Surface this to the user.
4. For the canonical `handleError` → `errorHandler` case, propose the larger structural fix: inject `ConfirmationService`, add `_catchErr` helper, replace call site with `this._catchErr(error, '<message>')`. Pull the helper template from `knowledge/ngrx-feature-store.md` "effects/<feature>.effects.ts — canonical from bs-event".

### `check-deps` (TS2307 missing-import)

```
suggestedRule: { rule: 'check-deps', pkg: 'file-saver' }
```

1. Read `catalog.dependencies.installed`.
2. If `pkg` not in installed:
   - For known v0.1.0 mistakes (`file-saver`, `lodash-es`, `uuid`, `date-fns`), apply the auto-fix from `agents/contract-validator.md`.
   - Otherwise ask the user: "Install `<pkg>` or use an alternative?"

### `fix-binding-type` (TS2322 type-mismatch)

```
suggestedRule: { rule: 'fix-binding-type', from: 'string', to: 'TemplateRef<any>' }
```

1. Read the error location — open the file, look at line + col.
2. If the binding is `[template]="'tplName'"` (string) when expected is `TemplateRef`, replace with `[template]="tplNameRef"` + add `@ViewChild('tplName') tplNameRef: TemplateRef<any>` in the class.
3. If the value is `[width]="'200px'"` when expected is `number`, replace with `[width]="200"`.
4. Otherwise surface to user.

### `add-required-prop` (TS2740/TS2741)

```
suggestedRule: { rule: 'add-required-prop', prop: 'useTitleAttrYn' }
```

1. The error location is a column entry like `{ field: 'foo', title: 'Bar' }`.
2. Add the missing prop with a sensible default — for `useTitleAttrYn`, default `false`.
3. Surface as a warning that the project's strict-mode-off tolerates the missing prop but it's better to add it.

### `undefined-symbol` (TS2304)

Usually a real bug (typo, missing import). Surface to user with a "what did you mean?" prompt.

### `unused-var` (TS6133)

Trivial. Auto-remove the unused import / variable.

### Apply patches

For each fix, use the `Edit` tool with explicit `old_string` / `new_string`. NEVER use `Write` to overwrite — that's destructive if the original code has subtle differences. After all patches applied, **re-run verify** to confirm.

## Step 5 — Re-verify loop

After auto-fix:

```bash
node {pluginRoot}/scripts/verify-feature.mjs \
  --project-root "{projectRoot}" \
  --feature {feature} \
  --feature-dir "{featureRoot}" \
  --json
```

If still `ok === false`, show remaining errors. Either:
- Try the per-error interactive walkthrough (Step 3 option B)
- Surface as TODOs and stop

Max 2 auto-fix iterations to prevent oscillation.

## Step 6 — Optional `--build-check`

If `--build-check` was passed (or auto-chained after generate and user opted in), run:

```bash
cd {projectRoot} && NODE_OPTIONS=--openssl-legacy-provider \
  node --max_old_space_size=8048 ./node_modules/@angular/cli/bin/ng build \
  --configuration=development 2>&1 | tail -50
```

This catches:
- Template binding errors (e.g. `<app-grid-basis [pageable]="{...}">` won't fail TS but Angular template compiler will)
- AOT compilation errors
- Missing module imports

Same auto-fix path applies. Note: build is slow (3-5 min for oh-admin). Surface a warning before running.

## Step 7 — Log to timeline

```bash
node {pluginRoot}/scripts/timeline.mjs append \
  --feature-dir "{stateDir}" \
  --kind verify \
  --summary "Verify {feature}: {errorCount} TS errors → {fixedCount} auto-fixed, {remainingCount} remaining{buildNote}" \
  --data '{"errorCount":<n>,"fixedCount":<n>,"remainingCount":<n>,"autoFixes":[...],"buildPassed":<bool or null>}'
```

Note: use `stateDir = {projectRoot}/.claude/aad/{feature}` not `outputDir` (v0.4.0 P5.1 relocates state). If `stateDir` doesn't exist yet, the timeline script creates it.

## Step 8 — Final report

```
Verify results for {feature}:

  ✓ TypeScript: {tsErrorCount} → {tsFixedCount} auto-fixed → {tsRemainingCount} remaining
  {✓|✗|—} Build:      {buildResult} {(if --build-check)}

Auto-fixes applied:
  ✓ effects/...effects.ts:49  handleError → errorHandler + _catchErr helper
  ✓ effects/...effects.ts:78  removed file-saver import, added _downloadBlob helper

Remaining issues:
  ⚠ container/...component.ts:120  [TS2304] Cannot find name 'foo' — likely typo, fix manually

Next step:
  {if all clean and feature has mock-spec.json:} `/angular-admin-design:aad-switch {feature} --on`
  {else if errors remain:} Fix the remaining issues in your editor; re-run /aad-verify
  {else if no mock yet:} `/angular-admin-design:aad-mock {feature}`
```

Done.
