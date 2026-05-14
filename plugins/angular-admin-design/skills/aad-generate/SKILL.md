---
name: aad-generate
description: "Use this when the user wants to scaffold a planned Angular feature into real source files under routes/. Reads plan.json + reuse-map.json from /aad-plan and generates NgRx actions/reducers/effects, services, container + components, module, routing, with Hybrid per-file confirmation. Always preserves shared component reuse decisions from reuse-map. Pass --batch to skip confirmations."
argument-hint: "<feature-kebab-name> [--batch]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, AskUserQuestion
---

# Angular Admin Design — Generate

Scaffold the feature module from plan + reuse-map: **$ARGUMENTS**

## Step 1 — Load config + locate plan

1. Find `.claude/angular-admin-design.json` (cwd or one level up). If missing, stop:
   > "Not configured. Run `/angular-admin-design:aad-init`."
2. Extract: `projectRoot`, `workingLanguage`, `outputDir` (default `docs/aad`), `profile.*`, `catalog.path`.

`$ARGUMENTS`:
- First token: `<feature>` (kebab-case, required)
- `--batch`: optional flag — switch to non-interactive mode (auto-Write every file). Otherwise Hybrid per-file confirmation.

Compute:
- `featureDir = {projectRoot}/{outputDir}/{feature}`
- `planPath = {featureDir}/plan.json`
- `reuseMapPath = {featureDir}/reuse-map.json`

Validation:
- If `planPath` missing: stop with "No plan found. Run `/angular-admin-design:aad-plan {feature} <spec>`."
- If `reuseMapPath` missing: stop with "Reuse map missing — re-run `/aad-plan` to regenerate."

**All user-facing output below in `workingLanguage`.**

## Step 2 — Pre-flight check the target

Read `plan.json` quickly. Locate:
- `feature`, `domain`, `scope`
- `state.featureKey`, `screens.length`, `endpoints.length`
- `openQuestions[]` with `blocks: codegen` or `blocks: both`

Compute target tree:
```
featureRoot = {projectRoot}/{profile.routesPath}/{scope ? scope + '/' : ''}{feature}
```

Use `Glob` to check if `featureRoot` already contains `.ts` files. If yes, ask `AskUserQuestion`:
> "Feature directory `{featureRoot}` already exists with code."
> Options:
> - "Overwrite each conflicting file with confirmation" (Recommended)
> - "Skip all conflicts — only write new files"
> - "Cancel — abort /aad-generate"

## Step 3 — Block on unresolved codegen-blocking questions

If any `openQuestions[*].blocks ∈ {'codegen','both'}` and `resolvedBy` is null (check via `timeline.mjs read`):

Show them and ask `AskUserQuestion`:
> "Plan has {N} unresolved codegen-blocking question(s). What now?"
> Options:
> - "Proceed with sensible defaults" (the agent will pick conservative choices and add `// TODO:` markers tied to question IDs)
> - "Pause — I'll edit plan.md and re-run /aad-plan first"
> - "Show me each question now so I can answer inline"

If "Show me each question": run `AskUserQuestion` per question. For each answer, write to `plan.json` under `answeredQuestions[]` AND mark resolved:
```bash
node {pluginRoot}/scripts/timeline.mjs resolve-question --feature-dir "{featureDir}" --id <q.id>
```

## Step 4 — Batch mode opt-in

If `--batch` not passed AND the plan has > 10 expected files (rough estimate: 10 base + screen count × 4 + new-component count × 3), offer:

> "This will generate roughly {N} files. Per-file confirmation gives you fine control but takes time. What mode?"
> Options:
> - "Hybrid per-file (Recommended for first run)"
> - "Batch — auto-write all files, review at the end"

Bind `mode = hybrid | batch`.

## Step 5 — Delegate to code-generator agent

Launch the **code-generator** subagent via `Task`:

```
feature:           {feature}
domain:            {domain}
scope:             {scope or null}
projectRoot:       {projectRoot}
pluginRoot:        {pluginRoot}
routesPath:        {profile.routesPath}
planPath:          {planPath}
reuseMapPath:      {reuseMapPath}
catalogPath:       {projectRoot}/{catalog.path}
claudeContextDir:  {projectRoot}/claude-context (or null if missing)
workingLanguage:   {workingLanguage}
i18nFlow:          {profile.i18nFlow}
i18nKeyFile:       {profile.i18nKeyFile or null}
ngrxLayout:        {profile.ngrxLayout}
mode:              {hybrid | batch}
overwritePolicy:   {confirm | skip-conflicts}
```

The agent generates each file with per-file confirmation (or batch). Wait for completion.

## Step 6 — Capture generated files list

The agent returns a summary including `generatedFiles[]` and `skippedFiles[]`. Surface verbatim.

## Step 7 — Log to timeline

```bash
node {pluginRoot}/scripts/timeline.mjs append \
  --feature-dir "{featureDir}" \
  --kind generate \
  --summary "Generated {feature}: {generatedCount} files ({reuseCount} reuse, {newCount} new)" \
  --data '{"files":<JSON array of relative paths>,"generatedCount":<n>,"skippedCount":<n>,"mode":"<hybrid|batch>"}'
```

## Step 8 — Wiring hint

Print the lazy-load route line the user needs to paste into `src/app/app-routing.module.ts`. Do NOT auto-edit that file — it's shared infrastructure and the user should approve the placement.

```
Add to src/app/app-routing.module.ts (under the authenticated routes block):

  {
    path: '<route-path-derived-from-feature-name-without-prefix>',
    loadChildren: () => import('./{profile.routesPath-after-src/app}/{scope ? scope + "/" : ""}{feature}/{feature}.module').then(m => m.{FeaturePascal}Module),
    canActivate: [AuthGuardService],
    data: { title: '<title from plan>', store: '<featureCamel>' },
  },
```

## Step 9 — Final report

Print in `workingLanguage`:

```
Feature generated: {featureRoot}

Generated ({generatedCount}):
  ✓ ... (one per file, abbreviated to 15; "(+N more)" if longer)

Skipped ({skippedCount}):
  ⊘ ... (one per file)

Build check:
  cd {projectRoot} && npm run build

Wire the lazy route (paste into app-routing.module.ts):
  <route stanza above>

Open questions still pending: {N}
  See {featureDir}/STATUS.md

Next step:
  /angular-admin-design:aad-mock {feature}
```

Done.
