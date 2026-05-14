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

## Step 4 — Update config with indexedAt

After the agent confirms success, edit `.claude/angular-admin-design.json` to set:

```json
{
  "catalog": {
    "path": "<existing>",
    "lastIndexedAt": "<ISO timestamp now>"
  }
}
```

## Step 5 — Final report

In `workingLanguage`:

```
Catalog ready: {catalogPath}

Next step — plan a feature:
  /angular-admin-design:aad-plan <feature-name> <path-to-spec.md OR JIRA:KEY>

Or list features that already exist in the project (to avoid duplicating):
  cat {catalogPath} | jq '.features[].name'
```

Done.
