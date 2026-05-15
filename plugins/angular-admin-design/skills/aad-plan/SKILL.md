---
name: aad-plan
description: "Use this when the user wants to plan a new Angular feature from a spec file or a Jira task. Produces plan.md + reuse-map.md + open-questions before any code is written. Spec source can be a local .md/.pdf/.txt path or a Jira key like JIRA:OHM-1234. Reads .claude/angular-admin-design.json and component-catalog.json."
argument-hint: "<feature-kebab-name> <path-to-spec.md OR JIRA:KEY> [attachment-paths...]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, AskUserQuestion
---

# Angular Admin Design — Plan

Produce a structured plan + reuse-map for: **$ARGUMENTS**

## Step 1 — Load config and catalog

1. Find `.claude/angular-admin-design.json` (cwd or one level up). If missing, stop with:
   > "Not configured. Run `/angular-admin-design:aad-init` first."
2. Extract: `projectRoot`, `workingLanguage`, `outputDir` (default `docs/aad`), `stateDir` (v0.4.0 default `.claude/aad` — falls back to `outputDir` if missing in config), `profile.*`, `catalog.path`, `jira.*`.
3. Verify `{projectRoot}/{catalog.path}` exists. If missing:
   > "Component catalog missing. Run `/angular-admin-design:aad-index` first."

**Resolve dirs (v0.4.0):**
- `planDir = {projectRoot}/{outputDir}/{feature}` — plan.md, reuse-map.md (committed)
- `stateDir = {projectRoot}/{stateDir || outputDir}/{feature}` — .timeline.json, STATUS.md (gitignored if stateDir is .claude/aad)

**All user-facing output below this point must be in `workingLanguage`.**

## Step 2 — Parse arguments

`$ARGUMENTS` should contain:
- First token: `<feature>` in kebab-case (required)
- Second token: `<spec-source>` — either an existing local path OR a string starting with `JIRA:` (required)
- Remaining tokens: additional attachment paths

Validation:
- Empty `<feature>`: ask `AskUserQuestion` for it.
- Feature contains spaces/uppercase: normalize to kebab-case and confirm with user.
- Validate domain: if `feature` starts with one of `profile.domainPrefixes` followed by `-`, extract `domain = <prefix>`. Otherwise:
  - If `profile.defaultDomainPrefix` is set, ask: "No domain prefix detected in '{feature}'. Use default '{defaultDomainPrefix}'?"
  - Else use `AskUserQuestion` listing the top 5 prefixes by feature count from `catalog.features` + "Custom prefix" + "Continue without prefix".

Compute (v0.4.0):
- `planDir = {projectRoot}/{outputDir}/{feature}` — for plan artifacts
- `stateDir = {projectRoot}/{config.stateDir || outputDir}/{feature}` — for timeline / STATUS
- If `planDir` already exists with a `plan.json` inside, ask: "A plan already exists. Re-plan from scratch / append open-question answers / cancel?"

Create both `planDir` and `stateDir` if missing. (Plan artifacts go in planDir; timeline files go in stateDir.)

## Step 3 — Resolve spec source

### Case A — Local file

If `<spec-source>` is an existing path (use `Read` or `Glob` to verify):

1. If absolute → use as-is.
2. If relative → resolve against cwd first, then against `projectRoot`.
3. Bind `specSource = 'local-file'`, `specPath = <absolute path>`.

### Case B — Jira key

If `<spec-source>` starts with `JIRA:` (e.g. `JIRA:OHM-1234`):

1. Extract `jiraKey = <after the colon>`.
2. If `jira.enabled` is false in config, stop:
   > "Jira input requested but Jira is disabled in config. Re-run /angular-admin-design:aad-init to enable, or pass a local path."
3. If `jira.projectKey` is set and `jiraKey` has no dash (e.g. `JIRA:1234`), prefix: `jiraKey = {projectKey}-{1234}`.
4. Call the Atlassian MCP server to fetch the issue:
   - `mcp__mcp-atlassian__jira_get_issue` with `issue_key: <jiraKey>` and `fields: 'summary,description,status,labels,attachment,customfield_*'` (or omit fields to get default).
   - Look in the response for the **acceptance criteria** custom field. It's commonly `customfield_10004` or a field named "Acceptance Criteria" — match by `field.name === 'Acceptance Criteria'`.
5. Download attachments:
   - For each attachment id, call `mcp__mcp-atlassian__jira_download_attachments` with `issue_key` and the attachment id.
   - Save to `{planDir}/.spec/jira-{jiraKey}/attachments/`.
6. Write a consolidated `{planDir}/.spec/jira-{jiraKey}/bundle.md`:

   ```markdown
   # Jira {jiraKey} — {summary}

   **Status:** {status} · **Labels:** {labels.join(', ')}

   ## Description

   {description converted from Atlassian wiki/ADF to markdown if possible — otherwise raw}

   ## Acceptance Criteria

   {AC field content}

   ## Attachments

   - {filename1} ({type}, {size}) — see attachments/{filename1}
   - ...
   ```

7. Bind `specSource = 'jira'`, `specPath = {bundle.md path}`, `specAttachments = [paths under attachments/]`.

## Step 4 — Resolve extra attachments from $ARGUMENTS

For each remaining token in `$ARGUMENTS`:
- Verify it's a readable path (image, pdf, md, txt, json).
- Add to `specAttachments[]`.
- Skip with a warning if missing.

## Step 5 — Verify claude-context exists

Look for `{projectRoot}/claude-context/`. If present, capture `claudeContextDir = {projectRoot}/claude-context`. If absent, set null and warn:
> "No `claude-context/` folder found. Plan will not honor project-specific business rules. Strongly recommended: create claude-context/business-rules.md, claude-context/coding-style.md, etc. — see oh-admin for the template."

## Step 6 — Run spec-analyzer agent

Use the `Task` tool to launch the **spec-analyzer** subagent with:

```
feature:           {feature}
domain:            {domain}
scope:             {scope or null}
workingLanguage:   {workingLanguage}
projectRoot:       {projectRoot}
specSource:        {specSource}
specPath:          {specPath}
specAttachments:   {specAttachments}
claudeContextDir:  {claudeContextDir or null}
catalogPath:       {projectRoot}/{catalog.path}
outputPath:        {planDir}/plan.json
```

Wait for the agent. It writes `plan.json` and `plan.md` and returns a one-line summary.

If the agent reports more than 0 open questions with `blocks` ∈ `{codegen, both}`, surface them prominently:

```
⚠ {N} open question(s) block codegen — review {planDir}/plan.md before /aad-generate:
  • q-01 ({blocks}) — {text}
```

## Step 7 — Run reuse-mapper agent

Use `Task` to launch **reuse-mapper** with:

```
planPath:        {planDir}/plan.json
catalogPath:     {projectRoot}/{catalog.path}
outputPath:      {planDir}/reuse-map.json
mdOutputPath:    {planDir}/reuse-map.md
workingLanguage: {workingLanguage}
```

Wait for it. Surface its one-line summary.

## Step 8 — Surface open questions to user

If the plan has open questions, ask the user `AskUserQuestion` for the first 3 (the agent ordered them by priority):

> "Open question {q.id} ({q.blocks}): {q.text}"
> Options:
> 1. "Provide answer now" (Recommended if codegen-blocking)
> 2. "Defer — edit plan.md manually later"
> 3. "Skip this question"

For each answered question, edit `{planDir}/plan.json` to set the answer in a new top-level field `answeredQuestions[]`, and call:

```bash
node {pluginRoot}/scripts/timeline.mjs resolve-question \
  --feature-dir "{stateDir}" --id {q.id}
```

## Step 9 — Log to timeline

```bash
node {pluginRoot}/scripts/timeline.mjs append \
  --feature-dir "{stateDir}" \
  --kind plan \
  --summary "Planned {feature}: {screenCount} screen(s), {endpointCount} endpoint(s), reuse {reusedCount}/{newCount}" \
  --data '{"reuse":{"reusedCount":<n>,"newCount":<n>},"specSource":"<local-file|jira>","jiraKey":"<or null>"}'
```

Then sync open questions to timeline:

```bash
echo '[{"id":"q-01","text":"...","blocks":"codegen"}, ...]' > /tmp/aad-questions-{feature}.json
node {pluginRoot}/scripts/timeline.mjs sync-questions \
  --feature-dir "{stateDir}" \
  --questions-file /tmp/aad-questions-{feature}.json
```

(Or use `Write` to create the temp questions file and then call the script.)

## Step 10 — Final report

Print in `workingLanguage`:

```
Plan ready: {planDir}
State (timeline + STATUS): {stateDir}

Files:
  • plan.md             — human-readable feature breakdown
  • plan.json           — structured plan (consumed by /aad-generate)
  • reuse-map.md        — for every UI requirement: reuse / Kendo / new
  • reuse-map.json      — structured map (consumed by /aad-generate)
  • STATUS.md           — phase tracker

Summary:
  • {screenCount} screen(s), {endpointCount} endpoint(s), {modelCount} model(s)
  • Reusing {reusedCount} existing component(s)
  • Creating {newCount} new component(s) ({needsNewSharedCount} flagged for shared/)
  • {i18nCount} i18n keys
  • {openQuestionsCount} open question(s) ({blockingCount} block codegen)

Next step:
  Review plan.md + reuse-map.md, then:
    /angular-admin-design:aad-generate {feature}
```

Done.
