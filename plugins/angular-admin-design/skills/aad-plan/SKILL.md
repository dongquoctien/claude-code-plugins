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

## Step 5.6 — Inspect prototypes via browser MCP (v0.5.0 → v0.7.1)

For each prototype with `status === 'user-confirmed'`, the skill invokes browser MCP tools (NOT a subagent — keeps tool access at skill level).

### Step 5.6.0 — Detect available browser MCPs (v0.7.1)

Before invoking any MCP tool, check which backends are available via ToolSearch:

```
hasPlaywright = (ToolSearch loads mcp__playwright__browser_navigate)
hasChromeDevTools = (ToolSearch loads mcp__chrome-devtools__new_page)
```

Bind `backendChoice`:

| Playwright | Chrome DevTools | backendChoice | Behavior |
|---|---|---|---|
| ✓ | ✓ | `both` | Playwright for navigate/walk/snapshot; Chrome DevTools for network bodies + lighthouse |
| ✓ | ✗ | `playwright-only` | All walking via Playwright; skip Chrome-exclusive features |
| ✗ | ✓ | `chrome-only` | All walking via Chrome DevTools (v0.5.0-v0.7.0 behavior preserved) |
| ✗ | ✗ | `none` | Skip inspection for all prototypes; set `status: 'inspection-failed'` with `inspectionError: 'no browser MCP available'` |

If `both`, also ask user (optional, once per session):

> "Both Playwright and Chrome DevTools MCPs are available. Preferred backend for prototype inspection?"
> Options:
> - "Best per task" (Recommended — Playwright for snapshot/walk, Chrome DevTools for network)
> - "Playwright only" — single browser, simpler
> - "Chrome DevTools only" — v0.7.0 backward compat

See `knowledge/mcp-browser-tools.md` for the per-task decision matrix.

### Step 5.6.1 — Constraints carried over from v0.5.0

1. **File path constraint**: Both MCPs reject paths outside registered workspace roots. Workaround: save to system temp dir first, then `Bash cp` to final `.spec/prototype-snapshots/` location.

2. **Snapshot output format differs**:
   - Chrome DevTools `take_snapshot` → plain-text uid-tree (`.txt` file)
   - Playwright `browser_snapshot` → markdown a11y tree (`.md` file)
   - Skill writes filename extension based on chosen backend; spec-analyzer reads both formats.

3. **SPA prototypes need walking**: many prototypes load to a list/entry view. To capture the deep screen (modal, drawer, detail), the skill must click entry-point buttons after initial snapshot.

4. **Browser sessions don't share**: Playwright and Chrome DevTools run separate browser processes. If you navigate via Playwright then need Chrome DevTools network capture, you must RE-NAVIGATE Chrome DevTools to the same URL. Don't expect cross-backend page state.

### Workflow

```
snapshotDir = {planDir}/.spec/prototype-snapshots
networkDir  = {planDir}/.spec/prototype-network         # v0.7.1
tempDir = system temp (e.g. C:\Users\<u>\AppData\Local\Temp on Windows, /tmp on POSIX)

Bash: mkdir -p {snapshotDir} {networkDir}
```

### Backend dispatch (v0.7.1)

Per-task MCP selection — see `knowledge/mcp-browser-tools.md` for the full matrix.

| Task | If `backendChoice` is `playwright-only` or `both` | If `chrome-only` |
|---|---|---|
| Navigate | `mcp__playwright__browser_navigate(url)` | `mcp__chrome-devtools__new_page(url)` |
| Wait | `mcp__playwright__browser_wait_for(text: ...)` | `mcp__chrome-devtools__wait_for(text: [...])` |
| Snapshot | `mcp__playwright__browser_snapshot(filename: 'X.md', depth: 8)` | `mcp__chrome-devtools__take_snapshot(filePath: 'X.txt')` |
| Screenshot | `mcp__playwright__browser_take_screenshot(filename: 'X.png', fullPage: true, type: 'png')` | `mcp__chrome-devtools__take_screenshot(filePath: 'X.png', fullPage: true)` |
| Click | `mcp__playwright__browser_click(element: '<desc>', target: '<ref>')` | `mcp__chrome-devtools__click(uid: 'X_Y', includeSnapshot: true)` |
| Network list (v0.7.1 always) | `mcp__playwright__browser_network_requests(filter: '/api/', static: false)` | `mcp__chrome-devtools__list_network_requests(resourceTypes: ['xhr','fetch'])` |
| Network body (v0.7.1 always) | (use Chrome DevTools — Playwright's per-request detail in `browser_network_request` doesn't save to file) | `mcp__chrome-devtools__get_network_request(reqid: N, responseFilePath: 'X.json')` |
| Close | `mcp__playwright__browser_close()` | `mcp__chrome-devtools__close_page(pageId: N)` |

In examples below, the placeholder `<NAV>`, `<WAIT>`, `<SNAPSHOT>`, `<CLICK>` represent the chosen backend's call per the table above.

### Per-prototype walk loop

For each confirmed prototype, in serial:

```
i = 1-based prototype index
kind = prototype.kind (github-io / local-html / sandbox / ...)

# 1. Navigate
<NAV>(url: "<source>")

# 2. Wait for SPA to render
<WAIT>(text: <2-3 expected labels from spec>)

# 3. Initial snapshot (entry view)
<SNAPSHOT>(filename or filePath: "{tempDir}/aad-proto-{i}-entry.<ext>")
<SCREENSHOT>(filename or filePath: "{tempDir}/aad-proto-{i}-entry.png", fullPage: true)
# .<ext> = .md for Playwright (browser_snapshot), .txt for Chrome DevTools

# 4. Identify entry-point button — scan snapshot for buttons matching:
#    - "Open", "Edit", "Configure", "Details", "View", "Configure Override"
#    Markdown snapshot (Playwright): look for `[button "Open"](#ref-X)` patterns
#    Text snapshot (Chrome DevTools): look for `uid=X_Y button "Open"` lines

# 5. Click entry point and take secondary snapshot (drawer/modal view)
<CLICK>(element-or-uid: <entry>)
<WAIT>(text: <drawer hint label>)
<SNAPSHOT>(filename or filePath: "{tempDir}/aad-proto-{i}-drawer.<ext>")
<SCREENSHOT>(filename or filePath: "{tempDir}/aad-proto-{i}-drawer.png", fullPage: true)

# 5.5. Multi-route detection (v0.7.0)
#      Run detect-prototype-routes.mjs on the initial snapshot to find sibling
#      routes (hash/path-based). If routes.length > 0 with score >= 0.3
#      (relevant routes for THIS feature, not just sidebar nav noise),
#      ask user via AskUserQuestion:
#        "Detected {N} additional routes that match the feature scope. Walk all?"
#        Options:
#          - Yes — walk all relevant routes (Recommended)
#          - Pick subset via multi-select
#          - Skip — just walk current route
#
#      For each selected route:
#        mcp__chrome-devtools__navigate_page(url: route.url)
#        mcp__chrome-devtools__wait_for(text: <heuristic from route.label>)
#        mcp__chrome-devtools__take_snapshot(filePath: "{tempDir}/aad-proto-{i}-route-{slug}-entry.txt")
#        mcp__chrome-devtools__take_screenshot(filePath: "{tempDir}/aad-proto-{i}-route-{slug}-entry.png")
#        # Then continue with auto-walk step 6 below for THIS route's snapshot
#        # (recursive inner walking).
#
#      Save each route's snapshots to plan.spec.prototypes[i].routes[k].walked = true
#      with snapshotPath / screenshotPath. Filename pattern:
#        {i}-{kind}-route-{slug}-entry.txt
#        {i}-{kind}-route-{slug}-walk-{j}-{label}.txt
#
#      If no relevant routes (all score < 0.3 — single-screen feature like ELS-1313),
#      skip route walking entirely. Continue to step 6 below with the initial snapshot.

Bash:
  node {pluginRoot}/scripts/detect-prototype-routes.mjs \
    --in-file "{tempDir}/aad-proto-{i}-entry.txt" \
    --feature {feature} \
    --budget 5

# 6. Auto-walk loop (v0.6.0)
#    Run walk-prototype.mjs on the drawer snapshot to find walk candidates
#    (tabs, modal triggers, accordions, dropdowns). Click each in priority
#    order, snapshot after each. Cap at WALK_BUDGET (default 5).
#    v0.7.0: when multi-route detected, run THIS auto-walk loop INSIDE
#    each route's navigation. So total snapshots = routes.length × walks_per_route.
Bash:
  node {pluginRoot}/scripts/walk-prototype.mjs \
    --in-file "{tempDir}/aad-proto-{i}-drawer.txt" \
    --budget 5 \
    --exclude-uid <entry-button-uid>      # already clicked
    --exclude-context "sidebar"           # avoid nav clicks
    --exclude-context "Hotel Bookings"

# Parse the JSON output. For each candidate:
for j in 0..min(5, candidates.length):
  cand = candidates[j]

  # Click the candidate. includeSnapshot:true saves a separate take_snapshot call.
  mcp__chrome-devtools__click(uid: cand.uid, includeSnapshot: true)

  # Wait for new content to render. For tabs, look for tab-specific text from spec;
  # for modals, look for common modal labels ("Cancel", "Close", "Save").
  mcp__chrome-devtools__wait_for(text: <heuristic from cand.label + spec>)

  # Save snapshot + screenshot to temp
  label = cand.kind + '-' + slugify(cand.label).slice(0, 40)
  mcp__chrome-devtools__take_snapshot(filePath: "{tempDir}/aad-proto-{i}-walk-{j+1}-{label}.txt")
  mcp__chrome-devtools__take_screenshot(filePath: "{tempDir}/aad-proto-{i}-walk-{j+1}-{label}.png", fullPage: true)

  # Add to prototype's secondarySnapshots[] array
  prototype.secondarySnapshots.push({
    label,
    snapshotPath: ".spec/prototype-snapshots/{i}-{kind}-walk-{j+1}-{label}.txt",
    screenshotPath: ".spec/prototype-snapshots/{i}-{kind}-walk-{j+1}-{label}.png",
    candidateKind: cand.kind,
    candidateLabel: cand.label,
  })

  # Return to base state before next walk (so each walk starts fresh from drawer)
  # Strategy 1: if cand was a modal-trigger and the page now shows a modal,
  #             look for "Close" / "Cancel" / "X" button and click it
  # Strategy 2: if cand was a tab, no return needed — tabs are non-destructive
  # Strategy 3: if cand was an accordion, no return needed
  # Strategy 4 (fallback): mcp__chrome-devtools__navigate_page(reload) + re-do entry walk

  if cand.kind === 'modal-trigger':
    # Try to close the modal — scan latest snapshot for close button
    close_button = find_button_by_label(["Close", "Cancel", "X", "✕"])
    if close_button:
      mcp__chrome-devtools__click(uid: close_button.uid)
      mcp__chrome-devtools__wait_for(text: <drawer hint>)
    else:
      # Last resort: reload + re-do entry click
      mcp__chrome-devtools__navigate_page(type: 'reload')
      mcp__chrome-devtools__wait_for(text: [<labels>])
      mcp__chrome-devtools__click(uid: <entry-button-uid>)
      mcp__chrome-devtools__click(uid: <drawer-trigger-uid>)

# 7. Network capture for /aad-mock fixture base (v0.7.1)
#    Walk has captured all the API calls the prototype made (initial load + per click).
#    Save XHR/fetch response bodies so /aad-mock can later use them as captured fixtures.
#    Skip when chrome-devtools MCP unavailable (Playwright-only backend can list but
#    can't save bodies cleanly).

if backendChoice in ['both', 'chrome-only']:
  # List API requests with regex filter
  if hasPlaywright:
    network_list = mcp__playwright__browser_network_requests(filter: "/api/.*", static: false)
  else:
    network_list = mcp__chrome-devtools__list_network_requests(resourceTypes: ['xhr', 'fetch'])

  # For each API request, save response body via Chrome DevTools (explicit file save)
  for req in network_list (max 30 to prevent runaway):
    if req.status != 200 OR req.url ends with .css/.js/.png/.svg/.woff/.ico: skip
    slug = slugify(req.url after origin, max 50 chars)   # e.g. "api-bookings-list"
    mcp__chrome-devtools__get_network_request(
      reqid: req.id,
      responseFilePath: "{tempDir}/aad-proto-{i}-network-{slug}.json"
    )
    # Also save request metadata (URL, method, status, request headers/body)
    Write({tempDir}/aad-proto-{i}-network-{slug}.meta.json, {
      url: req.url,
      method: req.method,
      status: req.status,
      timestamp: req.timestamp,
      capturedFromPrototype: prototype.source,
    })

  # Add to prototype's networkCapture[] array
  prototype.networkCapture = [
    { url, method, status, slug, responsePath, metaPath } for each saved
  ]

# 8. Close page
if hasPlaywright AND backendChoice in ['playwright-only', 'both']:
  mcp__playwright__browser_close()
if hasChromeDevTools AND backendChoice in ['chrome-only', 'both']:
  mcp__chrome-devtools__list_pages()
  mcp__chrome-devtools__close_page(pageId: <prototype-page-id>)

# 9. Move files from tempDir to final dirs
Bash: cp {tempDir}/aad-proto-{i}-entry.{md,txt,png}     {snapshotDir}/{i}-{kind}-entry.<ext>
Bash: cp {tempDir}/aad-proto-{i}-drawer.{md,txt,png}    {snapshotDir}/{i}-{kind}-drawer.<ext>
Bash: cp {tempDir}/aad-proto-{i}-walk-*.{md,txt,png}    {snapshotDir}/
Bash: cp {tempDir}/aad-proto-{i}-network-*.json         {networkDir}/    # v0.7.1
Bash: rm {tempDir}/aad-proto-{i}-*.{md,txt,png,json}
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

## Step 5.7 — Run prototype-classifier + resolve critical deviations (v0.6.0)

After all confirmed prototypes inspected (with entry, drawer, and walk snapshots saved), the skill runs the **prototype-classifier** subagent to compare detected UI elements against `catalog.shared` and surface deviations.

### Step 5.7a — Gather snapshot paths

```
snapshotPaths = []
for each prototype in spec.prototypes[] with status === 'inspected':
  add prototype.snapshotPath (absolute) to snapshotPaths
  add prototype.screenshotPath
  for each secondary in prototype.secondarySnapshots:
    add secondary.snapshotPath (absolute) to snapshotPaths
```

If `snapshotPaths` is empty (no successful inspection), skip Step 5.7 entirely.

### Step 5.7b — Launch prototype-classifier subagent

Use the `Task` tool to launch:

```
agent:            prototype-classifier
catalogPath:      {projectRoot}/{catalog.path}
snapshotPaths:    {snapshotPaths absolute array}
referencePath:    {projectRoot}/.claude/angular-admin-design/reference-features.json
workingLanguage:  {workingLanguage}
outputPath:       {planDir}/deviations.json
```

The agent returns a one-line summary including counts (critical / warning / info).

### Step 5.7c — Read deviations.json

```bash
cat {planDir}/deviations.json | node -e "..."  # parse summary stats
```

Update each `prototype.deviations` field in plan.spec.prototypes[]:

```json
{
  ...,
  "deviations": {
    "critical": <n>,
    "warning": <n>,
    "info": <n>
  }
}
```

### Step 5.7d — Surface critical deviations to user (max 5 batched)

If `critical > 0`, take the top 5 (by appearance order) and ask user via `AskUserQuestion`:

For each critical deviation, present:

```
[1/N] Critical UI deviation detected

Element: {elementRole} "{elementLabel}"
From:    {prototypePath}
Context: {parentContext}

Message: {message}

Suggested: {suggestedAction}
```

`AskUserQuestion` (per critical, max 4 options + free-text for custom):
> "How should this deviation be resolved?"
> - "Accept as feature-component" (Recommended for bespoke UI) — adds new section/component to plan, will be created by /aad-generate
> - "Use closest catalog match" — uses `catalogMatch.candidate`, may need adapter
> - "Add to openQuestions for dev to decide" — defers — plan continues but section marked TODO
> - "Skip — not relevant to feature" — removed from consideration

For each user answer, augment `deviations.json` with:
```json
{
  ...,
  "userResolution": "accept-feature-component" | "use-catalog-match" | "add-openquestion" | "skip",
  "userResolvedAt": "<ISO>",
  "userNote": "<optional text>"
}
```

### Step 5.7e — Batch over budget

If `critical > 5`, ask the user FIRST batch (5), then ask "Continue with next batch of {N-5}?" Allow user to skip remaining batches (will be auto-added as openQuestions with severity note).

### When prototype-classifier fails

If the subagent reports error or no deviations file written:
- Log to `plan.stats.warnings[]`
- Set `prototype.classifierFailed: true` for affected entries
- Continue — spec-analyzer just won't have deviation hints

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
