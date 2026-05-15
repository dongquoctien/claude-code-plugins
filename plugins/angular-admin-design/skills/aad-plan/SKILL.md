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

## Step 5.5 — Detect UI prototype references (v0.5.0)

Spec text often points at a runnable prototype (`prototype.html`, `tracy-tramtran.github.io/...`, CodeSandbox link, raw TSX file). The plugin can fetch and snapshot these via Chrome DevTools MCP so spec-analyzer has actual UI signal to plan from — not just spec prose.

Run the detector against all known spec inputs:

```bash
# Build the input list:
#   - bundle.md (always present for Jira; written by Step 3 Case B)
#   - specPath (for local file source)
#   - every entry in specAttachments[] that is a readable text file (.md/.txt)
node {pluginRoot}/scripts/detect-prototype.mjs \
  --project-root "{projectRoot}" \
  --in-file "{specPath}" \
  --in-file "{each specAttachments[i] that is text}" \
  > /tmp/aad-protos-{feature}.json
```

Parse the output JSON:

```json
{
  "prototypes": [
    { "kind": "github-io", "source": "https://.../...", "confidence": "high",
      "contextLine": "...", "lineNumber": 6, "sourceFile": "...", "hostHint": "..." }
  ],
  "warnings": [...]
}
```

### If `prototypes.length === 0`

Skip Step 5.6. Continue with Step 6 (spec-analyzer with no prototype data).

### If `prototypes.length > 0`

Cap at 5 (most relevant). If detector found more, surface this:

> "Detector found {N} prototype references; plugin will offer to inspect the top 5 by confidence. Pick which 5, or accept the default sort?"

Show the user the detected list with confidence + context:

```
🔍 Detected {N} prototype reference(s) in spec:

  [1] https://tracy-tramtran.github.io/vcomm-rate-adjustment/  (HIGH)
      from: bundle.md:6 — "Prototype: https://..."
  [2] remixed-ca0f0e7d.tsx  (LOW, bare filename)
      from: vcomm-rate-adjustment-spec.md:11 — "Prototype simulator v2 (\`remixed-...\`)"
```

Use `AskUserQuestion`:

> "Inspect prototypes via Chrome DevTools MCP before building the plan?"
> Options:
> - "Yes — inspect all high-confidence detections" (Recommended)
> - "Yes — let me pick which to inspect"
> - "Skip prototype inspection — proceed with spec-only plan"

If user picks "let me pick", show another multi-select `AskUserQuestion` with each prototype as an option.

Mark every prototype in the plan with `status` field:
- `user-confirmed` — user said "inspect this"
- `user-skipped` — user said skip
- low-confidence prototypes NOT in user's pick → `user-skipped`

## Step 5.6 — Inspect prototypes via Chrome DevTools MCP (v0.5.0)

For each prototype with `status === 'user-confirmed'`, the skill itself invokes Chrome MCP tools (NOT a subagent — keeps tool access at skill level).

### Important constraints (v0.5.0 — verified at implementation)

1. **MCP file path constraint**: `mcp__chrome-devtools__take_snapshot` and `mcp__chrome-devtools__take_screenshot` ONLY accept paths within registered workspace roots. They will reject paths outside (e.g. arbitrary project directory). **Workaround**: save to system temp dir (always accessible) then `cp` to final location.

2. **Snapshot output is `.txt`, not `.json`**: `take_snapshot` writes a plain-text accessibility tree (lines like `uid=X_Y RootWebArea ...`). It is human-readable. Do NOT expect JSON.

3. **SPA prototypes need walking**: many prototypes load to a list/entry view. To capture the deep screen (modal, drawer, detail), the skill must click entry-point buttons after initial snapshot.

### Workflow

```
snapshotDir = {planDir}/.spec/prototype-snapshots
tempDir = system temp (e.g. C:\Users\<u>\AppData\Local\Temp on Windows, /tmp on POSIX)

Bash: mkdir -p {snapshotDir}
```

For each confirmed prototype, in serial:

```
i = 1-based prototype index

# 1. Open the prototype in a new page
mcp__chrome-devtools__new_page(url: "<source>")

# 2. Wait for SPA to render — use a text hint specific to the feature
#    For ELS-1313 vcomm: wait_for(text: ["Override", "Mode", "Trader"])
#    (Use text/labels mentioned in spec attachments as proxy for "loaded")
mcp__chrome-devtools__wait_for(text: [<2-3 expected labels from spec>])

# 3. Initial snapshot (entry view)
mcp__chrome-devtools__take_snapshot(filePath: "{tempDir}/aad-proto-{i}-entry.txt")
mcp__chrome-devtools__take_screenshot(filePath: "{tempDir}/aad-proto-{i}-entry.png", fullPage: true)

# 4. Identify entry-point button — scan snapshot text for buttons matching:
#    - "Open", "Edit", "Configure", "Details", "View", "Configure Override"
#    The first matching uid is the entry point. If multiple, prefer the one
#    whose surrounding text best matches the feature name from spec.

# 5. Click entry point and take secondary snapshot (drawer/modal view)
mcp__chrome-devtools__click(uid: <entry-button-uid>, includeSnapshot: true)
# If snapshot in click response is enough, skip the next 2 calls. Else:
mcp__chrome-devtools__take_snapshot(filePath: "{tempDir}/aad-proto-{i}-drawer.txt")
mcp__chrome-devtools__take_screenshot(filePath: "{tempDir}/aad-proto-{i}-drawer.png", fullPage: true)

# 6. (Optional, v0.5.0 deferred to v0.6.0) Click through visible mode tabs
#    if drawer has them. For each tab role with `selectable=true`:
#       mcp__chrome-devtools__click(uid) → wait_for → snapshot/screenshot
#    Cap at 5 secondary captures total per prototype.

# 7. Close page
mcp__chrome-devtools__list_pages()  # to get the pageId
mcp__chrome-devtools__close_page(pageId: <prototype-page-id>)

# 8. Move files from tempDir to snapshotDir
Bash: cp {tempDir}/aad-proto-{i}-entry.{txt,png} {snapshotDir}/{i}-{kind}-entry.{txt,png}
Bash: cp {tempDir}/aad-proto-{i}-drawer.{txt,png} {snapshotDir}/{i}-{kind}-drawer.{txt,png}
Bash: rm {tempDir}/aad-proto-{i}-*.{txt,png}
```

Snapshot filenames produced (all relative to planDir):
- `.spec/prototype-snapshots/{i}-{kind}-entry.txt` — accessibility tree of initial view
- `.spec/prototype-snapshots/{i}-{kind}-entry.png` — screenshot of initial view
- `.spec/prototype-snapshots/{i}-{kind}-drawer.txt` — after first entry click (if applicable)
- `.spec/prototype-snapshots/{i}-{kind}-drawer.png` — screenshot after click

Each prototype's plan entry gets:
- `inspectedAt`: ISO timestamp
- `snapshotPath`: `.spec/prototype-snapshots/{i}-{kind}.json` (relative to planDir)
- `screenshotPath`: `.spec/prototype-snapshots/{i}-{kind}.png`
- `status: 'inspected'`

### Skip-on-error (mandatory)

If ANY MCP call fails (`mcp__chrome-devtools__*` raises error, timeout, network down, MCP not available):
- Log the error message to `plan.stats.warnings[]`
- Set `status: 'inspection-failed'`
- Set `inspectionError: <error message>`
- Continue with next prototype (do NOT abort the whole plan)

If MCP isn't connected at all (first call raises "MCP server not available"), warn ONCE and set all remaining prototypes to `inspection-failed`:

> "⚠ Chrome DevTools MCP not connected. Skipping prototype inspection for all {N} prototypes. Install or connect MCP if you want to use this feature: https://github.com/.../chrome-devtools-mcp"

Continue with spec-only flow.

### Bare filename (low-confidence) handling

For prototypes with `kind: 'local-react'` AND `confidence: 'low'` (bare filename like `remixed-ca0f0e7d.tsx`):
- The path likely doesn't exist on disk — `note: 'bare filename...'` will be set.
- Skip Chrome inspection. Instead, set `status: 'user-skipped'` and add an open question to the plan:
  - `q-NN: Spec references prototype file '<filename>' but location unknown. Provide an absolute path or URL if you want it inspected.`

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
prototypes:        {array of prototype objects from Step 5.5/5.6, including any with status=inspected — agent reads snapshotPath JSON}
outputPath:        {planDir}/plan.json
```

The agent reads `prototypes[*].snapshotPath` (when status === 'inspected') to augment its plan with observed UI patterns. Final plan.spec.prototypes[] must match the array passed in (including inspected metadata).

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
