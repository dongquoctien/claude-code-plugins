---
name: aad-mock
description: "Use this after /aad-generate to wire mock-data + InjectionToken into a feature so the UI runs end-to-end without backend. Uses captured response JSON files under mocks/<feature>/ when present; AI-synthesizes from the response interface otherwise. Sets environment.local.ts mockMode=true so the dev server picks up mocks immediately."
argument-hint: "<feature-kebab-name> [--batch]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, AskUserQuestion
---

# Angular Admin Design — Mock

Wire mock services + fixtures for: **$ARGUMENTS**

## Step 1 — Load config + locate scaffolded feature

1. Find `.claude/angular-admin-design.json`. If missing, stop with init reminder.
2. Extract: `projectRoot`, `workingLanguage`, `outputDir`, `profile.routesPath`, `profile.sharedModulesPath`, `mock.*`, `catalog.path`.

`$ARGUMENTS`:
- First token: `<feature>` (required)
- `--batch`: optional — auto-write without confirm

Compute:
- `planDir = {projectRoot}/{outputDir}/{feature}`  (plan home — committed)
- `stateDir = {projectRoot}/{config.stateDir || outputDir}/{feature}` (timeline — v0.4.0)
- `featureRoot = {projectRoot}/{profile.routesPath}/{feature}`  (generated code home — drop scope segment when null)
- `fixturesSourceDir = {projectRoot}/{mock.fixturesDir or 'mocks'}/{feature}`
- `fixturesAssetsDir = {projectRoot}/src/assets/mocks/{feature}`
- `planPath = {planDir}/plan.json`

**Validate**:
- `planPath` exists → ELSE stop "Run `/aad-plan` first."
- `featureRoot/<feature>.module.ts` exists → ELSE stop "Run `/aad-generate` first."

**All user-facing output below in `workingLanguage`.**

## Step 1.5 — Verify angular.json assets (v0.4.0)

Mock service reads fixtures at runtime from `src/assets/mocks/<feature>/...`. Angular's asset pipeline must include `src/assets` in `angular.json` `projects.<name>.architect.build.options.assets[]`.

Read `{projectRoot}/angular.json`:

```bash
# Pseudo-code:
const ng = JSON.parse(fs.readFileSync('{projectRoot}/angular.json'));
const proj = Object.keys(ng.projects)[0];
const assets = ng.projects[proj].architect.build.options.assets;
const hasAssets = assets.some(a => a === 'src/assets' || (typeof a === 'object' && a.input === 'src/assets'));
```

Most Angular projects auto-include `src/assets`, but some custom configs strip it. If missing:

Use `AskUserQuestion`:

> "angular.json doesn't include `src/assets` in build assets. Mock fixtures at runtime require this path. What now?"
> Options:
> - "Add 'src/assets' to angular.json automatically" (Recommended)
> - "I'll fix it manually — abort /aad-mock"
> - "Skip the check — I know my project structure"

If user picks "Add automatically", use `Edit` to insert `"src/assets"` into the assets array of the default project. Confirm what's been changed.

## Step 1.6 — Inspect prototype network captures (v0.7.1)

Check if `/aad-plan` captured XHR/fetch responses during prototype walk:

```
prototypeNetDir = {planDir}/.spec/prototype-network
```

If directory exists, use `Glob` on `{prototypeNetDir}/*.json` (skip `.meta.json`). For each captured response:

1. Read the matching `.meta.json` to get URL + method.
2. Try to match against `plan.endpoints[*]` by:
   - URL similarity (path Levenshtein, method match)
   - Endpoint method must match (GET → GET, POST → POST)
3. If high-confidence match (URL ends with same path, same method): mark endpoint with `prototypeNetworkSource: '<file>'`.

Show user the matched mapping:

```
Prototype network captures matched to endpoints:
  ✓ get-history → .spec/prototype-network/api-history-list.json (12 KB, GET /api/.../history)
  ✓ list-actions → .spec/prototype-network/api-action-codes.json (1 KB, GET /api/.../actions)
  ⊘ export-excel — no prototype capture (prototype didn't trigger this endpoint)

These will be used as primary fixtures (instead of /aad-mock synthesizing data).
```

If no `prototypeNetDir` exists, skip this step — proceed to Step 2 (look at `mocks/<feature>/`).

## Step 2 — Inspect captured fixtures

Use `Glob` on `{fixturesSourceDir}/*.json` to list captured files.

Show the user:

```
Captured fixtures found at {fixturesSourceDir}:
  - {fixtureFilename1}
  - ...
{N} captured fixture(s) — endpoints without a match will be synthesized.
```

If `fixturesSourceDir` doesn't exist at all, warn:

> "No captured fixtures at `{fixturesSourceDir}`. The plugin will synthesize all responses from interfaces. To use real data later, drop JSON files into that folder and re-run /aad-mock."

## Step 3 — Confirm scope

Use `AskUserQuestion`:

> "How should /aad-mock proceed?"
> Options:
> - "Generate mocks + wire token (Recommended)" — full pipeline
> - "Only synthesize missing fixtures — leave service/module wiring alone" — just sync fixtures
> - "Show me which env files will be touched first" — surface the file list, then ask again

If "Show me first": print the list of env files the agent will touch (`environment.local.ts` will be set to `mockMode: true`; others get `mockMode: false` added if missing; `environment.prod.ts` left alone). Re-ask.

## Step 4 — Delegate to mock-generator agent

Use `Task` to launch the **mock-generator** subagent with:

```
feature:           {feature}
projectRoot:       {projectRoot}
pluginRoot:        {pluginRoot}
featureRoot:       {featureRoot}
planPath:          {planPath}
catalogPath:       {projectRoot}/{catalog.path}
workingLanguage:   {workingLanguage}
fixturesSourceDir: {fixturesSourceDir}
fixturesAssetsDir: {fixturesAssetsDir}
mode:              {hybrid | batch}
```

The agent runs the full pipeline (interface → token → mock service → fixtures → providers → effects rewire → env files).

Wait. Surface its summary verbatim.

## Step 5 — Log to timeline

```bash
node {pluginRoot}/scripts/timeline.mjs append \
  --feature-dir "{stateDir}" \
  --kind mock \
  --summary "Mocked {feature}: {capturedCount} captured + {syntheticCount} synthetic fixtures, env.local mockMode=true" \
  --data '{"capturedCount":<n>,"syntheticCount":<n>,"fixturesSourceDir":"<rel path>","fixturesAssetsDir":"<rel path>"}'
```

Then resolve open questions blocked on mock (status from `timeline.mjs read`):

```bash
# For each question in plan.openQuestions[] with blocks ∈ {mock, both} that the mock now answers:
node {pluginRoot}/scripts/timeline.mjs resolve-question \
  --feature-dir "{stateDir}" \
  --id <q.id> \
  --event mock
```

## Step 6 — Final report

```
Mocks wired: {featureRoot}/services/

Files (new):
  ✓ <feature>-api.service.interface.ts
  ✓ <feature>-api.token.ts
  ✓ <feature>-api-mock.service.ts

Files (edited):
  ✓ services/index.ts                — barrel exports
  ✓ <feature>.module.ts              — providers[] added
  ✓ <feature>.effects.ts             — @Inject(token)

Fixtures:
  Source : {fixturesSourceDir}  ({capturedCount} captured + {syntheticCount} synthetic)
  Runtime: {fixturesAssetsDir}

Environment:
  ✓ environment.local.ts             — mockMode: true
  ✓ environment.ts / .dev / .staging — mockMode: false (default)
  ⊘ environment.prod.ts               — untouched (prod never silently mocks)

Run the UI:
  cd {projectRoot}
  npm run serve              # ← env.local is loaded, mocks active

When backend is ready:
  /angular-admin-design:aad-switch {feature} --off
```

If any synthetic fixtures were created, end with:

```
⚠ {N} fixture(s) are AI-synthesized. They contain placeholder values flagged with `_synthetic: true`.
  Replace them with captured responses before staging:
    1. Hit the endpoint in DevTools / Postman
    2. Save the response JSON to {fixturesSourceDir}/<endpoint-id>.json
    3. Re-run /aad-mock {feature}
```

Done.
