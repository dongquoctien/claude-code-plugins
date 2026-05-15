# Prototype inspection — v0.6.0

When a spec references a runnable prototype (URL or local file), the plugin can fetch it via Chrome DevTools MCP, **auto-walk** through interactive elements (tabs / modals / accordions), and use the **classifier agent** to flag deviations vs project catalog. This doc describes what to extract, how to phrase findings in `plan.json`, and how to handle deviations between prototype and project conventions.

## v0.6.0 changes

- **Auto-walk** in Step 5.6 — after initial snapshot, plugin runs `walk-prototype.mjs` to find clickable candidates (tabs, modal triggers, accordions, dropdowns), then clicks each in priority order (max 5 per prototype) and captures a snapshot after each. Walking reveals UI state hidden behind interaction (e.g. mode tabs in the vcomm drawer).
- **prototype-classifier agent** (new Step 5.7) — reads all snapshots + catalog, classifies each UI element as match / partial-match / no-match. Outputs `deviations.json` with severity (critical / warning / info). User resolves critical via AskUserQuestion before spec-analyzer runs.
- spec-analyzer reads both snapshots AND deviations — injects user-resolved bespoke components into plan, adds warnings to openQuestions[].

> **Important caveat (read first)**: prototype only describes **logic of events, actions, layout & data display**. UI deviations that breaks project's design system OR introduces patterns not in `catalog.shared[*]` **must** be flagged as `openQuestions[]` and confirmed with dev before codegen — never silently adopted.

---

## Detection (Step 5.5 of /aad-plan)

Plugin scans 4 sources for prototype references:
1. Jira description + comments (passed via bundle.md)
2. Spec text (local file or bundle)
3. `$ARGUMENTS` paths
4. Jira attachments

A hit is a prototype-like URL or file path:

**URL whitelist** (auto-detected, confidence boosted by context keyword):
- `*.github.io`
- `*.netlify.app`, `*.surge.sh`, `*.cloudflare.app`, `*.pages.dev`, `*.vercel.app`
- `*.glitch.me`
- `*.codesandbox.io`, `*.stackblitz.io`, `*.stackblitz.com`, `*.webcontainer.io`

**File ext whitelist**: `.html`, `.htm`, `.tsx`, `.jsx`

**Context keywords** (within ±2 lines boost to `high` confidence):
prototype, mockup, mock-up, demo, preview, wireframe, design, figma, storyboard

**Confidence levels:**
- `high` — URL match + context keyword in same/adjacent line
- `medium` — URL match, no context keyword (or path match with keyword)
- `low` — bare filename in backticks/quotes, only with keyword (asks user before inspect)

---

## Inspection (Step 5.6 of /aad-plan)

The skill invokes Chrome DevTools MCP itself (NOT the agent — keeps tool access at skill level). For each confirmed prototype:

```
mcp__chrome-devtools__new_page(url)
mcp__chrome-devtools__wait_for(text: [<labels from spec>])    # SPA-aware wait
mcp__chrome-devtools__take_snapshot(filePath: <temp>.txt)     # plain-text a11y tree
mcp__chrome-devtools__take_screenshot(filePath: <temp>.png, fullPage: true)
# Walk: click entry-point ("Open" / "Edit" / "Configure" buttons), snapshot again
# Move files from temp to .spec/prototype-snapshots/ via Bash cp
mcp__chrome-devtools__close_page(pageId)
```

### Important caveats from v0.5.0 implementation

1. **`take_snapshot` output is plain text, not JSON.** Files end `.txt`. Format:
   ```
   uid=1_0 RootWebArea "Title" url="..."
     uid=1_1 banner
       uid=1_2 link "Home" url="..."
     ...
   ```
   Parse this as line-oriented tree, not JSON.

2. **File paths must be within registered workspace roots.** MCP refuses arbitrary paths. Save to system temp first (e.g. `C:\Users\<u>\AppData\Local\Temp\` on Windows or `/tmp/` on POSIX), then `Bash cp` to final `.spec/prototype-snapshots/` location.

3. **SPA prototypes need walking.** A single snapshot of `tracy-tramtran.github.io/vcomm-rate-adjustment/` shows only the entry list — the actual drawer needs `click "Open" → click "Edit Override"`. Skill should walk at least one level if entry-point buttons are visible.

4. **Use `wait_for(text: [...])` not `wait_for(time: ...)` when possible.** Text wait is deterministic; time wait races SPA hydration.

5. **`click` accepts `includeSnapshot: true`** — the response includes a fresh snapshot, saving a separate `take_snapshot` call. Use this when chaining clicks.

### Skip-on-error policy

If any MCP call fails (URL unreachable, MCP not connected, timeout, workspace-path rejection):
- Log error to `plan.stats.warnings[]`
- Set `status: 'inspection-failed'`, populate `inspectionError`
- Continue with the next prototype (do NOT abort the plan)

This keeps the plugin tolerant of network issues + missing MCP setup.

---

## What spec-analyzer extracts from snapshots

Snapshot is a tree of UI nodes (Chrome's accessibility-derived view). For each tree, extract:

### 1. Section structure → `plan.screens[*].sections[*]`

Top-level visible regions become sections. Look for:
- `<header>`, `<section>`, `<aside>` elements
- Divs with role landmarks
- Headings (h1-h3) and what follows them

Example mapping:
```
Snapshot tree:
  region "Search panel"
    input[name=hotelCode]
    input[name=dateRange]
    button "Search"
  region "Results"
    table with 6 columns

Plan output:
  screens[0].sections = [
    { id: 'search', fields: [hotelCode, dateRange], actions: [{id: 'search', label: 'Search'}] },
    { id: 'results-grid', columns: [...6...] }
  ]
```

### 2. Buttons / CTAs → `state.actions[]` (UI kind)

Every clickable element with a label becomes a UI action. Naming convention from the label:
- "Search" → `searchSubmit` or `loadList`
- "Configure Override" → `openOverrideDrawer`
- "Discard Changes" → `discardDrawerStaging`
- "View History" → `openHistoryPopup`

### 3. Form fields → `sections[*].fields[*]`

Map HTML input types to plan field types:
- `<input type="text">` → `text`
- `<input type="number">` → `number`
- `<input type="date">` → `date`
- `<input type="checkbox">` → `checkbox`
- `<input type="radio">` → `radio`
- `<select>` → `select`
- `<textarea>` → `textarea`
- Custom widgets — see "Deviation handling" below

Field name comes from `name` attribute or first label above.

### 4. Table columns → `sections[*].columns[*]`

Every column header `<th>` or column heading becomes a column entry. Capture:
- `field`: derived from header label (camelCase)
- `title`: visible label
- `type`: inferred from cell content (numbers → 'number', dates → 'date')
- `sortable`: true if header has sort indicator (▲/▼/arrow icon)

### 5. Modal triggers

Buttons whose labels imply modal opening → dispatches `open<X>Dialog` action.

Heuristics:
- "View Details", "Edit", "Configure", "Add New" → modal-open
- "Save", "Cancel", "OK" inside a modal → modal-close + dispatch

### 6. Tab labels

Multi-tab containers → suggest either:
- Sub-sections per tab (if content is grouped data)
- Sub-components per tab (if logic is split — like vcomm-override's mode tabs)

### 7. Color identity / mode coding

Visible color usage that's semantic (e.g. blue tab = booking mode, green tab = combined) goes into:
- `plan.summary` mention
- `plan.openQuestions[]` (info severity) flagging design-token check

---

## Deviation handling

When prototype shows a UI pattern that doesn't fit project conventions:

### Severity levels

**`critical`** — completely unknown pattern. Examples:
- Custom drawing/canvas element
- Drag-and-drop interaction not in catalog
- Custom date-range picker with non-Gregorian calendar
- Inline-edit grid with bulk operations

**`warning`** — similar component exists but inputs/outputs differ. Examples:
- Prototype's calendar shows year-less dates (month-day only) but `app-calendar` requires year
- Table uses card-style row instead of grid row
- Form section uses inline expand/collapse instead of standard form

**`info`** — cosmetic / copy difference. Examples:
- Button label differs from project convention ("Apply All" vs "Apply to all")
- Icon set differs (Lucide vs Material)
- Subtle spacing/padding deviation

### How to flag

For each deviation, add to `plan.openQuestions[]`:

```json
{
  "id": "q-NN",
  "text": "Prototype at <url> shows <pattern>. Project convention from claude-context/<file> uses <other>. <Why critical>. Confirm before codegen: <choice>?",
  "blocks": "codegen"   // when critical
            "nothing"   // when info
            "both"      // when critical AND affects mock data shape
}
```

Reuse-mapper later sees this and chooses:
- `reuse-existing` — if dev confirms project convention wins
- `create-feature-component` — if dev accepts prototype pattern as bespoke
- `needs-new-shared` — if dev wants to extract pattern to shared/

### Example deviation: vcomm CrossRefMatrix

Prototype shows a 5×5 interactive grid that recomputes on cell click. No equivalent in catalog.shared (closest match `app-grid-basis` is single-axis, no interactive matrix).

Plan output:
```json
{
  "openQuestions": [{
    "id": "q-15",
    "text": "Prototype CrossRefMatrix is a 5x5 interactive grid with live recompute on cell click (≤300ms). No similar component in catalog.shared. Confirm: create feature-local UsCompVcommCrossRefMatrixComponent? Alternative: split into 5 stacked tables with separate row click handlers (lower complexity).",
    "blocks": "codegen"
  }]
}
```

Reuse-mapper sees `q-15` blocked-codegen → flags row for confirmation:
```
| Requirement | Decision | Detail |
| CrossRefMatrix | needs-confirmation (q-15) | If confirmed → create-feature-component UsCompVcommCrossRefMatrixComponent. |
```

---

## Anti-patterns to avoid

❌ **Don't auto-adopt prototype patterns** that aren't in catalog. Always ask via `openQuestions[]`.

❌ **Don't generate template HTML that matches prototype exactly** when project's `coding-style.md` says otherwise (e.g. project uses Kendo grid but prototype uses custom div table).

❌ **Don't replace `catalog.shared` components** with prototype custom widgets. The catalog is the project's design system — prototype is one design's interpretation.

❌ **Don't extract color values directly into generated `.scss`** files. Note them in plan.summary as "verify against design-tokens.md or shared/scss/_variables.scss".

❌ **Don't generate code that depends on data the prototype loads via fetch()** — those URLs are mock/demo, not real API. Use spec `endpoints[]` as truth.

✅ **DO use prototype to fill in spec gaps** — when spec says "list of items" and prototype shows 6 columns, capture those 6 columns.

✅ **DO note prototype-derived patterns** as `prototypeRef` on the affected action/section so dev can locate them.

✅ **DO classify deviations** as info/warning/critical so user sees severity at a glance.

---

## File layout

```
{planDir}/
├── plan.json
├── plan.md
├── .spec/
│   ├── jira-{key}/
│   │   ├── bundle.md
│   │   └── attachments/
│   │       └── *.{md,png,pdf,txt}
│   └── prototype-snapshots/                      ← v0.5.0
│       ├── 1-github-io.json                      ← Chrome MCP take_snapshot output
│       ├── 1-github-io.png                       ← Chrome MCP take_screenshot
│       ├── 1-github-io-tab-Booking.json          ← per-tab snapshot (if walked)
│       └── ...
```

---

## Future (v0.6.0+)

- **Auto-walk**: detect tab/wizard navigation in prototype, click through automatically and capture each state
- **Deviation classifier agent**: dedicated subagent that compares each prototype element against catalog and outputs structured `deviations[]` array
- **Event handler extraction**: read inline `onClick` handlers in raw HTML/JSX prototypes (when accessible) to derive more precise dispatched-action names
- **Multi-screen prototype support**: when prototype has multiple routes (e.g. `/dashboard`, `/detail/:id`), inspect each and map to corresponding screens
