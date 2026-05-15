---
name: aad-index
description: "Use this to crawl the configured Angular project's source code and produce component-catalog.json — the source of truth that /aad-plan uses to decide 'reuse existing vs create new'. Re-run whenever shared/modules or routes/ change meaningfully. Reads .claude/angular-admin-design.json."
argument-hint: ""
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Bash, Task, AskUserQuestion
---

# Angular Admin Design — Index

Build `component-catalog.json` for the configured Angular project. This catalog is the single source of truth that `/aad-plan` and `/aad-generate` consult — re-run this skill whenever the project's shared/modules or routes/ change meaningfully.

## Step 1 — Load config

Resolve `.claude/angular-admin-design.json`:

1. If the current working directory has it, use that.
2. Otherwise, walk up from cwd one level looking for it.
3. If still missing, ask the user: "Where is the project root with `.claude/angular-admin-design.json`? Or run /angular-admin-design:aad-init first."

Extract:
- `projectRoot`
- `workingLanguage`
- `profile.sharedModulesPath`, `profile.routesPath`
- `catalog.path` (default `.claude/angular-admin-design/component-catalog.json`)
- `anchorFeatures` (default `["bs-event", "ho-reservation-list-ota", "ad-dashboard"]` for oh-admin — see Step 4) — if missing in config, prompt user

**All user-facing output below this point must be in `workingLanguage`.**

## Step 2 — Show staleness if catalog exists

If `{projectRoot}/{catalog.path}` already exists:
- Read it and show `indexedAt` + counts.
- Ask: "Re-index now? Anything new under {sharedModulesPath} or {routesPath} since {indexedAt} will be missed otherwise."

## Step 3 — Delegate to source-indexer agent

Use the `Task` tool to launch the **source-indexer** subagent with:

```
projectRoot:       {projectRoot}
pluginRoot:        {pluginRoot}
catalogOut:        {projectRoot}/{catalog.path}
sharedModulesPath: {profile.sharedModulesPath}
routesPath:        {profile.routesPath}
srcPath:           src/app
workingLanguage:   {workingLanguage}
```

Wait for the agent's report. Surface it verbatim to the user (the agent already formats it in the working language).

## Step 4 — Extract reference features (v0.2.0)

After the catalog is built, pick 1-3 "anchor" feature modules to capture verbatim. The code-generator agent reads these snapshots so generated code mirrors actual project conventions instead of generic templates.

### 4a — Resolve anchor list

Read `config.anchorFeatures` from `.claude/angular-admin-design.json`. If missing or empty:

1. Read the freshly-built catalog: `{projectRoot}/{catalog.path}`.
2. Suggest 1-3 features from `catalog.features[]` that BOTH `hasNgRxStore === true` AND have ≥1 containers ≥1 services ≥3 components — these are "complete" features that demonstrate the project's full pattern.
3. Ask the user via `AskUserQuestion`:
   > "Pick anchor features — the code-generator will copy patterns from these. (Pick 1-3.)"
   - Recommended top 3 from your suggestion
   - "Let me list more" (show next 5)
   - "Use defaults: bs-event,ho-reservation-list-ota,ad-dashboard"

After the user picks, write the list to config:
```json
{ "anchorFeatures": ["bs-event", "ho-reservation-list-ota", "ad-dashboard"] }
```

### 4b — Run the extractor

```bash
node {pluginRoot}/scripts/extract-reference-features.mjs \
  --in {projectRoot} \
  --routes-path {profile.routesPath} \
  --anchors {anchorFeatures.join(',')} \
  --out {projectRoot}/.claude/angular-admin-design/reference-features.json
```

The script captures the full source of each anchor's `module.ts`, `routing.module.ts`, `actions/*.actions.ts`, `reducers/*.reducer.ts` (inner + outer), `effects/*.effects.ts`, `services/*-api.service.ts`, `containers/*.component.ts`, and `containers/*.component.html` — verbatim, with line counts.

Surface stats: "Captured N snapshots across {M} features."

## Step 5 — Update config with indexedAt

After the agent confirms success, edit `.claude/angular-admin-design.json` to set:

```json
{
  "catalog": {
    "path": "<existing>",
    "lastIndexedAt": "<ISO timestamp now>"
  }
}
```

## Step 6 — Final report

In `workingLanguage`:

```
Catalog ready: {catalogPath}
Reference features: {anchorFeatures.join(', ')}
                    → .claude/angular-admin-design/reference-features.json

Next step — plan a feature:
  /angular-admin-design:aad-plan <feature-name> <path-to-spec.md OR JIRA:KEY>

Or list features that already exist in the project (to avoid duplicating):
  cat {catalogPath} | jq '.features[].name'
```

Done.
