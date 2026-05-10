---
name: verify
description: "Use this to compare a generated prototype against the real admin site or original screenshots. Identifies visual/content/interaction gaps. Asks user questions throughout to confirm scope and choices. Invoke for prompts like 'verify the mockup', 'compare prototype with real admin', '/feature-mockup:verify <feature>'."
argument-hint: "<feature-name>"
user-invocable: true
allowed-tools: Read, Write, Glob, Grep, Bash, Task
---

# Feature Mockup — Verify

Compare a generated prototype side-by-side with a reference (live admin URL OR user-provided screenshots) and produce a gap report. The goal is to maximize fidelity to the source design.

**Core principle: ask the user questions at every uncertain choice.** Never silently assume scope, credentials, or comparison strategy.

## Step 1 — Load config + resolve feature dir

Read `.claude/feature-mockup.json`. If missing, stop with:
> "Run `/feature-mockup:init` first."

Extract `outputDir` and `workingLanguage`.

`$ARGUMENTS` = feature name. Resolve `featureDir = {outputDir}/{feature}`. If missing, stop:
> "No mockup found at `{featureDir}`. Run `/feature-mockup:make {feature}` first."

## Step 2 — Pick reference source (ASK THE USER)

Use `AskUserQuestion`:

> "What should the prototype be compared against?"

Options:
1. **Live admin URL** — capture screenshots in real-time via headless browser
2. **User-provided screenshots** — user pastes/uploads images of the real admin
3. **Original brief screenshots** — re-use the screenshots passed to `/feature-mockup:make` (in `{featureDir}/brief.json` `inputs[].path`)
4. **Both live + screenshots** — combined check

## Step 3 — Pick browser-automation backend (when live URL chosen)

Use `AskUserQuestion`:

> "Which browser-automation MCP should I use to capture the live admin?"

Options:
1. **Chrome DevTools MCP** (Recommended) — already common in Claude Code installs
2. **Playwright MCP** — robust automation
3. **I don't have either installed** — guide me to install one

### Detect available MCP tools

Look for these tool names in the available tool list:
- `mcp__chrome-devtools__navigate_page`, `mcp__chrome-devtools__take_screenshot`, `mcp__chrome-devtools__fill`, `mcp__chrome-devtools__click`
- `mcp__playwright__browser_navigate`, `mcp__playwright__browser_take_screenshot`, `mcp__playwright__browser_fill`, `mcp__playwright__browser_click`

If user picks a backend that isn't installed, ask:

> "{X} MCP is not detected in your environment. Would you like instructions to install it?"

For Chrome DevTools MCP install:
```
1. Run: claude mcp add chrome-devtools npx @anthropic-ai/mcp-server-chrome-devtools
2. Restart Claude Code
3. Re-run /feature-mockup:verify
```

For Playwright MCP install:
```
1. Run: claude mcp add playwright npx @playwright/mcp@latest
2. npx playwright install chromium
3. Restart Claude Code
4. Re-run /feature-mockup:verify
```

If user picks "neither installed", default to **user-provided screenshots** flow (Step 2 option 2).

## Step 4 — Gather credentials (when live URL needs login)

Ask the user, ONE question at a time, only the fields needed:

1. > "What is the admin URL to compare against? (e.g. `https://admin.example.com`)"
2. > "Does the admin require login? (yes / no)"
3. If yes: > "Provide the login URL (default: same URL with `/login`)?"
4. If yes: > "Username/email for login?"
5. If yes: > "Password for login? (will only be used in this session, not saved)"
6. > "Which path/route should I navigate to for the comparison? (e.g. `/admin/hotels`, `/booking-list`)"
7. > "Any preconditions before screenshot? (e.g. 'click Search button first', 'select date range')"

**Never persist credentials to disk.** Use them only within this skill session. Mention this to the user.

## Step 5 — Capture reference screenshots

### Live URL flow

Use the chosen MCP backend:

```
1. navigate_page → loginUrl
2. fill username + password → click submit
3. wait for navigation success (URL change OR specific element)
4. navigate_page → comparisonUrl
5. apply preconditions (clicks, fills) if user described any
6. take_screenshot at desktop viewport (1440x900)
7. take_screenshot at tablet viewport (768x1024) — only if user wants responsive check
```

Save screenshots to `{featureDir}/.verify/reference-desktop.png` (and `-tablet.png` if applicable).

If login fails, take a screenshot of the failure state and surface to user:
> "Login appears to have failed. The screenshot is at `{featureDir}/.verify/login-failed.png`. Should I retry with different credentials, or switch to user-provided screenshots?"

### User-provided screenshots flow

Ask:
> "Drop the reference screenshot path(s) here, or paste the image directly."

For each input, copy to `{featureDir}/.verify/reference-{N}.png`.

### Original brief screenshots flow

Read `{featureDir}/brief.json`. Find `inputs[]` entries with `kind: "image"`. Copy each to `{featureDir}/.verify/reference-brief-{N}.png`.

## Step 6 — Capture prototype screenshots

The prototype is at `{featureDir}/index.html` (static) or running on a dev server.

### Static (html-tailwind)

Use the same MCP backend:
```
1. navigate_page → file:///{abs-path}/index.html
2. take_screenshot at 1440x900 → {featureDir}/.verify/prototype-desktop.png
3. For each pages/*.html → screenshot if user wants multi-page comparison
```

If MCP is unavailable, ask user:
> "Open `{featureDir}/index.html` in your browser, take a screenshot, then drop it here."

### Vite

If a dev server is required, ask user:
> "Run `/feature-mockup:preview {feature}` first to start the dev server, then come back and re-run /feature-mockup:verify."

## Step 7 — Run comparison agent

Use the `Task` tool with the **general-purpose** subagent:

```
Reference screenshot(s):  {featureDir}/.verify/reference-*.png
Prototype screenshot(s):  {featureDir}/.verify/prototype-*.png
Brief:                    {featureDir}/brief.json
Theme dir:                .claude/feature-mockup/theme (if imported)

Goal:
  Produce {featureDir}/.verify/report.md with sections:

  1. Visual fidelity (per region: header, sidebar, filters, grid, footer, modals)
     - Layout structure match (Y/N + notes)
     - Color match (Y/N + delta)
     - Typography match (font family, size, weight)
     - Spacing/density match
     - Icon set match

  2. Content completeness
     - Every label visible in the reference is also in the prototype (Y/N + missing list)
     - Every column/field/button in the reference exists in the prototype
     - i18n labels match (when locale switcher present)

  3. Interaction parity (best-effort, since prototype is static)
     - Buttons trigger the right action chain (per events.json)
     - Form validation rules match validators.json
     - Dialog/modal flow matches dialog-detection.json
     - Multi-screen flow links work

  4. Gap list (prioritized: P0/P1/P2)
     - P0: blocking visual or content omission (e.g. missing column, wrong layout)
     - P1: noticeable polish gap (e.g. wrong padding, color shade off)
     - P2: minor (e.g. icon variant, font weight subtle)

  5. Recommended fixes
     - For each P0/P1, write a one-line fix prompt the user can pass to /feature-mockup:fix

Output format: Markdown with screenshots inline (relative paths), Y/N checklist tables, prioritized gap list.

Be specific: cite the exact element ('the 4th grid column header', 'the Search button in the filter area').
Don't be vague ('overall looks similar').
```

Wait for the agent. Surface its summary.

## Step 8 — Present findings + ask next step

Print, in `workingLanguage`:

```
Verification complete.

Report:    {featureDir}/.verify/report.md
Reference: {featureDir}/.verify/reference-*.png
Prototype: {featureDir}/.verify/prototype-*.png

Summary:
  P0 issues:  {count}  ({first 1-line P0 issue})
  P1 issues:  {count}
  P2 issues:  {count}

What next?
  1. Apply fixes:    /feature-mockup:fix {feature}
  2. Re-verify:      /feature-mockup:verify {feature}
  3. Open report:    open `{report path}`
```

Use `AskUserQuestion`:
> "Apply recommended fixes now via `/feature-mockup:fix`?"

If yes, surface the fix prompts that should be passed.

## Cleanup

Do NOT delete `.verify/` — user may want to inspect screenshots later. The folder is hidden from git via the prototype's own `.gitignore` (add it if missing).

## Edge cases

- **Slow page load**: increase wait time; ask user if a specific element signals "ready" (e.g. wait for `.k-grid` to render).
- **Different data on real admin**: compare structure not values (e.g. prototype shows 5 sample hotels, real admin shows 539 — that's expected).
- **Authentication MFA / SSO**: ask user if MFA blocks automation. If yes, switch to manual screenshot flow.
- **VPN-only admins**: warn user that the MCP runs on the local machine, so VPN must be active.
- **Locale-specific UI**: if reference is KR but prototype is EN, ask user which locale to compare; OR run prototype's language switcher to KR before screenshot.
- **Responsive**: by default desktop only. Ask if user wants tablet/mobile viewports too.

## Done

Don't end the session until the user has either:
1. Confirmed they read the report
2. Triggered `/feature-mockup:fix`
3. Said "skip fixes for now"
