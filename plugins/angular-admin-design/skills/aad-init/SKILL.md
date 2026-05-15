---
name: aad-init
description: "Use this when the user wants to set up Angular Admin Design in a project for the first time, or runs /angular-admin-design:aad-init explicitly. Auto-detects the Angular project's profile (NgRx layout, shared modules path, domain prefixes, i18n flow) and writes .claude/angular-admin-design.json."
argument-hint: "[absolute-path-to-project-root]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Bash, AskUserQuestion
---

# Angular Admin Design — Init

Set up the plugin for one Angular project. End state: a valid `.claude/angular-admin-design.json` config file inside that project root.

## Step 1 — Resolve project root

`$ARGUMENTS` is optional:
- If provided, it MUST be an absolute path to a directory containing `angular.json`. Verify by running `Read {projectRoot}/angular.json` — if the file does not exist or is not Angular, stop with a clear error.
- If empty, use the current working directory **only if** `./angular.json` exists. Otherwise ask: "Where is the Angular project root? (absolute path)".

Bind `projectRoot = <resolved path>` for the rest of the skill.

## Step 2 — Detect existing config

Check if `{projectRoot}/.claude/angular-admin-design.json` already exists.

- If yes: read it and ask the user (use `AskUserQuestion`):
  1. **Keep it** — stop here, print the current config.
  2. **Re-detect and overwrite** — proceed.
  3. **Edit one field** — ask which, edit, stop.
- If no: continue.

## Step 3 — Ask working language

Use `AskUserQuestion`:

> "Working language for prompts and human-readable artifacts (plan.md, STATUS.md)? (en / ko / vi)"

Bind `workingLanguage`. **All output below this point must be in `workingLanguage`.**

## Step 4 — Run profile detection

```bash
node {pluginRoot}/scripts/detect-profile.mjs --in {projectRoot}
```

Capture stdout as JSON. The script returns:

```json
{
  "profile": { "name", "ngrxLayout", "sharedModulesPath", "routesPath", "domainPrefixes", "kendoVersion", "angularVersion", "i18nFlow", "i18nScanScript", ... },
  "kendo": { "version", "modules": [...] },
  "ngrx": { "hasNgRx", "store", "effects", "entity" },
  "signals": { "modulesSampled", "claudeContextFiles": [...] },
  "warnings": [...]
}
```

## Step 5 — Show detection results and confirm

Show the user a concise summary in `workingLanguage`:

```
Detected profile for {projectRoot}:
  • Project: {profile.name} (Angular {angularVersion}, Kendo {kendoVersion})
  • Routes path: {routesPath} ({featureCount} sampled)
  • Shared modules path: {sharedModulesPath}
  • NgRx layout: {ngrxLayout}
  • Domain prefixes: {domainPrefixes.join(', ')}
  • i18n flow: {i18nFlow} {if scan-download: '(via npm run ' + i18nScanScript + ')'}
  • claude-context docs: {claudeContextFiles.length} found
```

If `ngrx.hasNgRx` is false, warn loudly: "This project does not depend on @ngrx/store. The plugin always generates NgRx feature stores — you'll need to add @ngrx/store, @ngrx/effects, @ngrx/entity before /aad-generate works."

## Step 6 — Ask for the few things detection can't infer

Use `AskUserQuestion` with 2 questions:

1. **Default domain prefix**:
   > "When /aad-plan is called without an explicit prefix, which one should be the default?"
   Options: the top 3 prefixes by feature count (count features per prefix from sample) + "Ask each time".

2. **Jira integration**:
   > "Will this project read specs from Jira tasks?"
   Options:
   - "Yes — enable Jira via mcp-atlassian" (Recommended if the workspace already has mcp-atlassian)
   - "No — specs are local files only"

If Jira yes, ask one more: "Default Jira project key (e.g. 'OHM')? Leave blank to require a full key each time."

## Step 7 — Write the config

Write `{projectRoot}/.claude/angular-admin-design.json` conforming to `schemas/config.schema.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/dongquoctien/claude-code-plugins/main/plugins/angular-admin-design/schemas/config.schema.json",
  "version": 1,
  "workingLanguage": "<en|ko|vi>",
  "projectRoot": "<absolute-path>",
  "outputDir": "docs/aad",
  "stateDir": ".claude/aad",
  "profile": {
    "name": "<from detection>",
    "ngrxLayout": "<from detection>",
    "sharedModulesPath": "<from detection>",
    "routesPath": "<from detection>",
    "domainPrefixes": [...],
    "defaultDomainPrefix": "<user choice or null>",
    "kendoVersion": "<from detection>",
    "angularVersion": "<from detection>",
    "i18nFlow": "<from detection>",
    "i18nScanScript": "<from detection or null>",
    "i18nKeyFile": "<from detection or null>"
  },
  "catalog": {
    "path": ".claude/angular-admin-design/component-catalog.json"
  },
  "jira": {
    "enabled": <true|false>,
    "mcpServer": "mcp-atlassian",
    "projectKey": "<or omit>"
  },
  "mock": {
    "fixturesDir": "mocks",
    "injectionTokenSuffix": "_SERVICE_TOKEN",
    "envFlagPath": "mockMode"
  }
}
```

**Do NOT** include fields whose value would be null/empty — omit them.

## Step 7.5 — Suggest .gitignore entry (v0.4.0)

After writing config, check if `{projectRoot}/.gitignore` exists. If yes, grep for `.claude/aad`. If absent, suggest adding:

```
# angular-admin-design plugin state (auto-managed)
.claude/aad/
```

Use `AskUserQuestion`:

> "Add '.claude/aad/' to .gitignore? (Plugin state files — .timeline.json, STATUS.md — should not be committed.)"
> Options:
> - "Yes, add" (Recommended)
> - "Skip — I'll handle gitignore myself"

If yes, append the lines to `.gitignore`. If no `.gitignore` exists, suggest creating one with that single line.

## Step 8 — Confirm

Print in `workingLanguage`:

```
Angular Admin Design is configured.

Config:  {projectRoot}/.claude/angular-admin-design.json
Profile: {profile.name}

Next step — build the component catalog:
  /angular-admin-design:aad-index

Then plan your first feature:
  /angular-admin-design:aad-plan <feature-name> <path-to-spec.md OR JIRA:KEY>
```

Done.
