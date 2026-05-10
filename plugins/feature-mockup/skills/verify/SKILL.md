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

## Step 1 — Load config + resolve feature dir + show resume status

Read `.claude/feature-mockup.json`. If missing, stop with:
> "Run `/feature-mockup:init` first."

Extract `outputDir` and `workingLanguage`.

`$ARGUMENTS` = feature name. Resolve `featureDir = {outputDir}/{feature}`. If missing, stop:
> "No mockup found at `{featureDir}`. Run `/feature-mockup:make {feature}` first."

### Resume status — show when timeline has prior runs

If `{featureDir}/.timeline.json` exists AND has prior verify events, surface a quick summary:

```bash
node {pluginRoot}/scripts/timeline.mjs status --feature-dir "{featureDir}"
```

Print, only when `totals.verifyRuns >= 1`:

```
ℹ This is verify run {N+1}. Previous verify ({lastActivityAge}) found {p0+p1+p2} issues;
  {pendingCount} are still pending. Continue?
```

Use `AskUserQuestion`:
1. **Continue with new verify** (Recommended) — full re-verify with current prototype
2. **Skip verify, just regenerate report from existing screenshots** — when user just wants to re-read findings
3. **Cancel**

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

For Chrome DevTools MCP install (Unix shell):
```bash
claude mcp add chrome-devtools -- npx -y @anthropic-ai/mcp-server-chrome-devtools
# Then restart Claude Code and re-run /feature-mockup:verify
```

For Chrome DevTools MCP install (PowerShell on Windows):
```powershell
claude mcp add chrome-devtools -- npx -y "@anthropic-ai/mcp-server-chrome-devtools"
# Then restart Claude Code and re-run /feature-mockup:verify
```

For Playwright MCP install (Unix shell):
```bash
claude mcp add playwright -- npx -y "@playwright/mcp@latest"
npx playwright install chromium
# Then restart Claude Code and re-run /feature-mockup:verify
```

For Playwright MCP install (PowerShell):
```powershell
claude mcp add playwright -- npx -y "@playwright/mcp@latest"
npx playwright install chromium
# Then restart Claude Code and re-run /feature-mockup:verify
```

If user picks "neither installed", default to **user-provided screenshots** flow (Step 2 option 2).

### MCP scope flag

If user is in a project-scoped Claude Code (per-repo settings), suggest adding `--scope project` to install at project level:
```bash
claude mcp add --scope project chrome-devtools -- npx -y @anthropic-ai/mcp-server-chrome-devtools
```
Otherwise default `user` scope is fine.

## Step 4 — Gather credentials + auth strategy (when live URL needs login)

First, classify the auth type by asking:

> "What auth type does the admin use?"

Use `AskUserQuestion` with:
1. **Form login** — username + password on a login page (most common admin auth)
2. **SSO / OAuth** — e.g. Google / Azure AD / Okta / SAML — redirects to identity provider
3. **MFA / OTP** — form login + second factor (TOTP code, SMS, push approval)
4. **API token / JWT** — set via header or cookie, no UI login flow
5. **Already logged in** — user has an existing browser session, skip login entirely
6. **No auth** — public admin URL

### 4a. Form login flow

1. > "What is the admin URL to compare against? (e.g. `https://admin.example.com`)"
2. > "Login URL? (default: `{baseUrl}/login`)"
3. > "Username/email field selector or label? (e.g. `#email`, `input[name='username']`, label `Email`)"
4. > "Username/email value?"
5. > "Password field selector? (default: `input[type='password']`)"
6. > "Password value? (used only in this session, not saved to disk or logs)"
7. > "Submit button selector? (default: `button[type='submit']`)"
8. > "Path to navigate after login for comparison? (e.g. `/admin/hotels`)"

### 4b. SSO flow

> "SSO requires interactive consent. I'll open the login page and pause. You complete login in the spawned browser, then return here and reply 'continue'. Confirm?"

If user agrees, the MCP opens the login URL in a NON-headless window (Playwright's `launch({ headless: false })` or Chrome DevTools' visible mode), waits for the user to manually complete auth, then resumes. After 5 minutes of no progress, ask again.

### 4c. MFA / OTP flow

Same as 4a + after submit, pause:
> "Submit form complete. Now provide the OTP code from your authenticator: ____"

Fill the OTP field, submit. If MFA uses push notification (Okta Verify, Duo), use SSO flow (4b) instead.

### 4d. API token / JWT flow

> "Provide the token (will be sent as `Authorization: Bearer <token>` OR set as a cookie — confirm which)?"

Ask whether the token goes in:
- HTTP header `Authorization: Bearer <token>`
- Cookie name `<cookieName>`
- localStorage key `<key>`

Then `mcp__playwright__browser_evaluate` to set the storage/cookie BEFORE navigation, OR pass headers to `navigate_page` if MCP supports.

### 4e. Already-logged-in flow

> "Provide the cookie value(s) or session ID that authenticate your existing browser session. Inspect via DevTools → Application → Cookies."

User pastes cookie string (e.g. `JSESSIONID=abc123; CSRF-TOKEN=xyz`). MCP sets cookies before navigation.

Alternative: > "Or provide the path to a Playwright `storage-state.json` file exported from your existing browser (run `playwright codegen --save-storage`)."

### 4f. No auth

Skip all credential prompts. Proceed directly to Step 5.

### Common to all paths

Always ask:
> "Any preconditions before screenshot? (e.g. 'click Search button', 'select date range from 2024-01 to 2024-12', 'open the Edit dialog for the first row')"

User describes preconditions in natural language. Translate to MCP click/fill/select calls — confirm with user if ambiguous.

**Never persist credentials to disk.** Mention this explicitly. Don't write them to logs, reports, or temp files. After the session ends, they're gone.

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

The prototype's framework is detected the same way as the `/preview` skill (Step 2 of preview). Inspect `featureDir` for these signatures in priority order — first match wins:

| Signature | Framework |
|---|---|
| `index.html` at root, no `package.json` | `static-html` |
| `angular.json` | `angular` |
| `gatsby-config.{js,ts,mjs}` | `gatsby` |
| `astro.config.{js,ts,mjs,cjs}` | `astro` |
| `next.config.{js,ts,mjs,cjs}` | `next` |
| `nuxt.config.{js,ts,mjs}` | `nuxt` |
| `remix.config.{js,ts}` | `remix` (classic compiler) |
| `vite.config.*` AND `package.json` deps include `@remix-run/dev` | `remix-vite` |
| `svelte.config.{js,ts}` | `sveltekit` |
| `vite.config.*` (any other) | `vite` (React/Vue/Svelte/Solid) |
| `package.json` only | `node-server` |

### Static (html-tailwind / index.html at root)

Use the same MCP backend:
```
1. navigate_page → file:///{abs-path}/index.html
2. take_screenshot at 1440x900 → {featureDir}/.verify/prototype-desktop.png
3. Read brief.json for the flow array; for each pages/{id}.html in the flow,
   navigate + screenshot if user wants multi-screen comparison
```

If MCP is unavailable, ask user:
> "Open `{featureDir}/index.html` in your browser, take a screenshot for each screen in the flow, then drop them here."

### Dev-server frameworks (vite / next / nuxt / astro / angular / sveltekit / remix / gatsby / webpack)

Check whether a dev server is already running for this prototype:
1. Look for prior `/preview` background bash by checking `BashOutput`/`TaskList` for matching `featureDir`
2. If running, get URL from its captured stdout
3. If not running, ask:
   > "Need to start the dev server first. Should I run `/feature-mockup:preview {feature}` for you, or have you already started it on another terminal? If yes, what URL?"

When user has it running, navigate the MCP to that URL. When they don't, defer to `/preview` and ask them to re-run `/verify` afterwards (avoids double-spawning servers).

### Multi-screen flow comparison

When `brief.json` has `flow.length > 1`, ask:
> "This prototype has {N} screens in flow ({list}). Capture screenshots of all screens, or just the entry?"

For "all screens":
- Static: navigate to each `pages/{id}.html` (or `index.html` for the first entry), screenshot each, name `prototype-{flow-position}-{id}.png`.
- Dev-server: navigate to corresponding routes per framework convention. Read `brief.routes` if present, else infer from screen IDs. Same naming.
- Reference (live admin): for each prototype screen, ask user the corresponding live admin URL/path. Capture matching reference screenshots `reference-{flow-position}-{id}.png`.

The comparison agent (Step 7) gets paired screenshots and compares per-screen.

### Responsive viewports

By default capture desktop only (1440x900). Ask:
> "Compare responsive layouts too? (desktop only / + tablet 768 / + mobile 375 / all three)"

For each chosen viewport, capture both reference and prototype, suffix filenames with `-desktop`, `-tablet`, `-mobile`.

## Step 7 — Run comparison agent

Use the `Task` tool with the **general-purpose** subagent. **Pass framework context** so the agent compares correctly (Angular component class names != React JSX class names != Vue scoped class names):

```
Reference screenshot(s):  {featureDir}/.verify/reference-*.png
Prototype screenshot(s):  {featureDir}/.verify/prototype-*.png
Brief:                    {featureDir}/brief.json
Theme dir:                .claude/feature-mockup/theme (if imported)
Source framework:         {manifest.stack.framework}  (read from theme/source-manifest.json)
                          one of: angular, react, nextjs, vue, nuxt, svelte, sveltekit,
                                  astro, remix, gatsby, unknown
UI library:               {manifest.stack.uiLib}      (e.g. kendo / antd / mui / element-plus /
                          shadcn / vuetify / chakra / quasar / headlessui / none)
Prototype template:       {prototype-framework}       (one of: static-html / angular / next /
                          nuxt / astro / remix / remix-vite / sveltekit / vite / gatsby /
                          node-server)

Framework knowledge file:
  Load `{pluginRoot}/knowledge/<source-framework>.md` so the agent compares
  against framework-specific class name conventions, template syntax, and
  copy-from-source rules.
    angular → knowledge/angular.md
    react → knowledge/react.md
    nextjs → knowledge/nextjs.md
    vue / nuxt → knowledge/vue.md
    svelte / sveltekit → knowledge/svelte.md
    astro → knowledge/astro.md
    remix → knowledge/remix.md
    gatsby → knowledge/gatsby.md

Extract artifacts:
  - validators.json       (per-field validation rules from source)
  - events.json           (handler → action chain map)
  - dialog-detection.json (modals + toasts inventory)
  - route-patterns.json   (filter grids + cell two-line + prefix groups)
  - mock-data.json        (entity records)
  - i18n.json             (locale labels) [if present]
  - icon-detection.json   (icon library + brand logo)
  - assets/               (icons + images + fonts copied from source)
Source-copy/ root:        {themeDir}/source-copy (real source files)

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

## Step N — Sync findings to timeline

The comparison agent's `report.md` should also write a parallel JSON file at `{featureDir}/.verify/gaps.json` containing only the gap list (so timeline.mjs can ingest it). Have the agent emit BOTH report.md AND gaps.json.

`gaps.json` shape (array):

```json
[
  {"id": "gap-grid-col-04", "priority": "P0", "region": "data grid",
   "description": "Missing 'Region' column"},
  {"id": "gap-status-color", "priority": "P1", "region": "grid cells",
   "description": "Status color wrong shade"}
]
```

Gap ID conventions:
- Slug from region + a stable identifier in the description
- Reuse the same ID across re-verifies of the same feature when the issue is the same — preserves resolvedBy state

Then sync to timeline:

```bash
node {pluginRoot}/scripts/timeline.mjs sync-gaps \
  --feature-dir "{featureDir}" \
  --gaps-file "{featureDir}/.verify/gaps.json"

node {pluginRoot}/scripts/timeline.mjs append \
  --feature-dir "{featureDir}" \
  --kind verify \
  --summary "Verify run <N>: <p0> P0 + <p1> P1 + <p2> P2 issues" \
  --data '{"reportPath":".verify/report.md","gapsPath":".verify/gaps.json","referenceSource":"<live-url|user-screenshots|brief|both>","browserBackend":"<chrome-devtools-mcp|playwright-mcp|none>","p0":<n>,"p1":<n>,"p2":<n>,"screenshots":[<paths>]}'
```

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
