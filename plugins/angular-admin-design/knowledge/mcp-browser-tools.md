# Browser MCP tools — when to use which (v0.7.1)

Two browser-automation MCPs are commonly available in Claude Code environments:

- **Playwright MCP** (`mcp__playwright__browser_*`) — cross-browser, locator-driven
- **Chrome DevTools MCP** (`mcp__chrome-devtools__*`) — DevTools-grade introspection

This doc documents the strengths of each and tells `/aad-plan` Step 5.6 which to call for what. **Don't force one MCP** — use the right tool per task.

---

## Quick reference table

| Task | Playwright | Chrome DevTools | Pick |
|---|---|---|---|
| Open page | `browser_navigate(url)` | `new_page(url)` / `navigate_page(url)` | Tie |
| A11y snapshot | `browser_snapshot` (markdown, depth, boxes) | `take_snapshot` (uid-tree text) | **Playwright** — markdown easier, depth limit cuts tokens |
| Screenshot | `browser_take_screenshot` (fullPage, png/jpeg) | `take_screenshot` (fullPage, png/jpeg/webp, by-uid) | Tie |
| Wait | `browser_wait_for(text \| textGone \| time)` | `wait_for(text[])` (only appear) | **Playwright** — `textGone` detects modal close |
| Click | `browser_click(element, target)` | `click(uid)` | **Playwright** — element description for human-readable permission |
| Fill input | `browser_type` / `browser_fill_form` | `fill` / `fill_form` (bulk) | **Chrome DevTools** — `fill_form` is built for bulk |
| Select dropdown | `browser_select_option` | (use click + click option) | **Playwright** — `select_option` is one-call |
| Hover | `browser_hover` | `hover(uid)` | Tie |
| Drag-drop | `browser_drag` + `browser_drop` | `drag(from_uid, to_uid)` | **Chrome DevTools** — single-call |
| Key press | `browser_press_key` | `press_key` | Tie |
| Type free text | `browser_type` | `type_text` | Tie |
| File upload | `browser_file_upload` | `upload_file` | Tie |
| Dialog handling | `browser_handle_dialog` | `handle_dialog` | Tie |
| **Network requests list** | `browser_network_requests(filter regex, static toggle)` | `list_network_requests(resourceTypes, pagination)` | **Playwright** — regex filter cleaner for API hunt |
| **Network response body** | `browser_network_request(index, part: 'response-body', filename)` | `get_network_request(reqid, responseFilePath)` | **Tie** — Playwright supports `part` enum (request-headers/body, response-headers/body) + filename save; equivalent to Chrome DevTools |
| Console messages | `browser_console_messages` | `list_console_messages(types, filter)` | **Chrome DevTools** — type filter + pagination |
| Get specific console msg | (combined list) | `get_console_message(msgid)` | **Chrome DevTools** |
| Tabs management | `browser_tabs` | `list_pages` / `select_page` / `close_page` | Tie |
| Navigate back | `browser_navigate_back` | `navigate_page(type:'back')` | Tie |
| JS evaluate | `browser_evaluate(function, element?, filename?)` | `evaluate_script(function, args, dialogAction)` | **Playwright** — save result to file |
| Run arbitrary JS | `browser_run_code_unsafe` | (use evaluate_script with side effects) | Tie |
| Resize window | `browser_resize` | `resize_page(width, height)` | Tie |
| **Lighthouse audit** | — | `lighthouse_audit(device, mode)` | **Chrome DevTools only** |
| **Performance trace** | — | `performance_start_trace` + `performance_stop_trace` + `performance_analyze_insight` | **Chrome DevTools only** |
| **Device emulation** | — | `emulate(viewport, networkConditions, cpuThrottling, geolocation, colorScheme, userAgent)` | **Chrome DevTools only** |
| **Memory snapshot** | — | `take_memory_snapshot` | **Chrome DevTools only** |

---

## Decision rules per aad-plan task

### Task: Initial navigate + snapshot

**Use Playwright** when available — `browser_snapshot` returns markdown which is easier for spec-analyzer to parse than Chrome DevTools' uid-tree text format. Markdown also supports `depth` cap for huge SPAs.

```
mcp__playwright__browser_navigate(url)
mcp__playwright__browser_snapshot(filename: 'entry.md', depth: 8)
mcp__playwright__browser_take_screenshot(filename: 'entry.png', fullPage: true)
```

Fallback to Chrome DevTools when Playwright unavailable.

### Task: Wait for SPA hydration

**Use Playwright** — `browser_wait_for(text: ...)` works the same as Chrome DevTools but also supports `textGone` (useful for detecting modal close after click).

### Task: Click walk through tabs / modals

**Use Playwright** — `browser_click(element: "Edit Override button", target: ...)` requires a human-readable element description that doubles as permission prompt. Chrome DevTools uses bare uid which is less reviewable.

### Task: Network capture (for /aad-mock prototype-based fixtures) — v0.7.1 new

**Use whichever backend is in current use** — both have equivalent capability:

```
# Playwright
mcp__playwright__browser_network_requests(filter: "/api/.*", static: false)
mcp__playwright__browser_network_request(
  index: <1-based>, part: 'response-body', filename: '{tempDir}/api-{slug}.json'
)

# Chrome DevTools (when chrome-only backend)
mcp__chrome-devtools__list_network_requests(resourceTypes: ['xhr', 'fetch'])
mcp__chrome-devtools__get_network_request(
  reqid: <id>, responseFilePath: '{tempDir}/api-{slug}.json'
)
```

When `backendChoice === 'both'`, prefer Playwright (already in session from snapshot/walk — no re-navigation needed).

### Edge case: Static demo prototypes

Some prototypes don't make API calls at all — they ship mock data inline in the JS bundle. Smoke test on `tracy-tramtran.github.io/vcomm-rate-adjustment/` found **0 dynamic requests, 5 static** (HTML/fonts only).

When `browser_network_requests(static: false)` returns empty:
- Log to `plan.stats.warnings[]`: `"Prototype <url> made no dynamic API requests — data appears to be inline in JS bundle. No network capture available for /aad-mock."`
- Don't fail the plan — fall back to synthetic mock data from interfaces.
- Surface in plan.summary: `"Prototype is static — mock data will be AI-synthesized from response interfaces."`

### Task: Console messages capture

**Use Chrome DevTools** — type filter (`warn` / `error` only) plus pagination for noisy SPAs.

### Task: Lighthouse / Performance / Device emulation

**Chrome DevTools exclusive** — no Playwright equivalent in current toolset.

### Task: Form bulk fill

**Use Chrome DevTools** `fill_form(elements[])` — single call for multi-field forms. Playwright requires N `browser_type` calls.

---

## Browser session sharing

Both MCPs operate on separate browser instances by default. Important caveats:

- **Don't expect a Playwright-navigated page to be visible to Chrome DevTools** — they're separate browser processes.
- If you need to capture network from a page Playwright already navigated, **either** re-navigate via Chrome DevTools first, **or** call `mcp__chrome-devtools__list_pages` to check if a session is shared (rare).
- Safest pattern: pick ONE backend for navigation/walk, then call the other only for network bodies AFTER walking, by re-navigating to same URL.

For aad-plan v0.7.1, the chosen pattern is:

```
1. Playwright: navigate + walk + snapshot the whole feature flow
2. After walking complete, Chrome DevTools: re-navigate to same URL,
   list_network_requests (gets all loads from this fresh navigation),
   get_network_request response bodies for API calls only
3. Both browsers close at end of run
```

---

## Detection at runtime

`/aad-plan` Step 5.6 detects which MCPs are available:

```
hasPlaywright = ToolSearch returns mcp__playwright__browser_navigate ✓
hasChromeDevTools = ToolSearch returns mcp__chrome-devtools__new_page ✓
```

Branches:
- **Both available** → use Playwright for nav/walk, Chrome DevTools for network bodies + lighthouse
- **Only Playwright** → all walking with Playwright, skip Chrome-exclusive features (lighthouse / perf trace / emulate)
- **Only Chrome DevTools** → all walking with Chrome DevTools (v0.5.0-v0.7.0 behavior)
- **Neither** → skip prototype inspection entirely, set every prototype.status to 'inspection-failed' with reason "no browser MCP available"

User-facing: skill mentions in the final report which backend was used per task so they can troubleshoot.

---

## File path constraints (carry-over from v0.5.0)

**Chrome DevTools**: file paths must be within registered workspace roots. Save to system temp first, then `cp` to final location.

**Playwright**: similar constraint — `filename` for `browser_snapshot` / `browser_take_screenshot` resolves relative to the configured output directory of the Playwright server (usually project root or a temp dir). Test the path acceptance once at session start; if rejection, fall back to temp + cp pattern.

---

## When neither MCP is enough

Some prototypes use:
- **WebSocket-only data** — neither MCP exposes WS frames in this toolset. Document as openQuestion.
- **Iframes** — both MCPs may need explicit context switching. Test before relying.
- **Server-side rendered pages** with no interaction (just static HTML) — no need for browser MCP, just `curl + cheerio` parse via Bash. Add to v0.8.0 roadmap.
