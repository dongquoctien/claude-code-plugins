---
name: fm-fix
description: "Use this to apply UI/UX + interaction fixes to a generated prototype, either from /feature-mockup:fm-verify findings or from user-described issues. Always asks the user to confirm scope and choices before editing. Invoke for prompts like 'fix the prototype', 'apply verify fixes', '/feature-mockup:fm-fix <feature>'."
argument-hint: "<feature-name> [optional: free-form fix description]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task
---

# Feature Mockup — Fix

Apply targeted fixes to a generated prototype. Two input sources:
1. The `verify` skill's report at `{featureDir}/.verify/report.md` (preferred)
2. User-described issues in the command arguments or a follow-up answer

**Core principle: confirm with the user before each batch of changes.** Never silently rewrite the prototype.

## Step 1 — Load config + resolve feature dir

Read `.claude/feature-mockup.json`. If missing, stop with:
> "Run `/feature-mockup:fm-init` first."

Extract `outputDir`, `workingLanguage`, and `theme.imported` (true/false).

`$ARGUMENTS` parsing:
- First word = feature name. Resolve `featureDir = {outputDir}/{feature}`.
- Rest of `$ARGUMENTS` = optional free-form fix description.

If `featureDir` missing, stop.

## Step 2 — Identify fix sources

Check what's available:

| Source | Path | Use when |
|---|---|---|
| Verify report | `{featureDir}/.verify/report.md` | exists |
| User free-form description | `$ARGUMENTS` after feature name | user passed text |
| Brand-new request | (neither) | ask user |

Use `AskUserQuestion`:

> "What should I fix?"

Options (only show ones that apply):
1. **Apply all P0 + P1 fixes from the verify report** (if report exists)
2. **Apply only P0 (blocking) fixes** (if report exists)
3. **Apply specific issues I'll describe** — opens a follow-up prompt
4. **Both verify report + my own issues**

If no verify report exists, suggest running `/feature-mockup:fm-verify {feature}` first OR collect the user's free-form description.

## Step 3 — Build the fix list

### When verify report is the source

Read `{featureDir}/.verify/report.md`. Extract gaps from the "Gap list" section. Filter by user's chosen priority (P0 only / P0+P1 / all).

Each gap should have:
- `id` — short tag like `gap-grid-col-04`
- `priority` — P0 / P1 / P2
- `region` — header / sidebar / filter / grid / modal / etc
- `description` — what's wrong
- `recommendedFix` — one-line action

### When user free-form is the source

Parse the user's description. For each issue identified, ask follow-up if vague:

| Vague pattern | Clarification to ask |
|---|---|
| "fix the colors" | "Which element specifically? And what color (provide hex or describe)?" |
| "make it more like {real admin}" | "Do you have a screenshot to reference? Or which specific aspect?" |
| "fix the form" | "Which field/button is broken? What's the expected behavior?" |
| "add the missing field" | "Field name + label + type + required?" |

## Step 4 — Confirm scope with user (CRITICAL STEP)

Print the parsed fix list with priority tags:

```
I plan to apply the following fixes:

  [P0] gap-grid-col-04
       Region: data grid
       Issue:  Missing 'Region' column (4th in the real admin, absent in prototype)
       Fix:    Add column with header 'Region', binding to row.regionName, width 120px

  [P0] gap-modal-validation
       Region: edit modal
       Issue:  Form submits without validating hotelCode pattern
       Fix:    Add HTML5 pattern + JS validator from validators.json

  [P1] gap-toolbar-buttons-3-of-8
       Region: toolbar
       Issue:  3 of 8 toolbar buttons missing (Recommendation, Add Region, Delete Region)
       Fix:    Add 3 buttons with matching icons + handlers wired from events.json

  [P1] gap-status-color
       Region: data grid
       Issue:  Status 'Cancelled' rendered as orange, real admin uses red
       Fix:    Change .status-cancelled color from #f59e0b → #dc2626

  [P2] gap-spacing-tight
       Region: filter area
       Issue:  Filter row gap is 16px, real admin uses 12px
       Fix:    Change .filter-grid gap from 1rem → 0.75rem
```

Use `AskUserQuestion`:

> "Apply all 5 fixes?"

Options:
1. **Apply all** (Recommended)
2. **Apply only P0** (skip P1+P2)
3. **Skip specific items** — ask user which IDs to skip
4. **Cancel** — exit without changes

## Step 5 — Apply theme + UI/UX rules check (before editing)

For each fix, validate against design system rules:

| Rule | Check | Fail action |
|---|---|---|
| Theme tokens are mandatory when `theme.imported === true` | Fix should NOT introduce hardcoded colors outside tokens | Ask user: "This fix uses hardcoded #dc2626 instead of `var(--color-danger)`. Use the token instead?" |
| Lucide icons only (no emoji) | Fix should not introduce emoji characters | Ask user: "Fix introduces 🔴 emoji. Replace with `<i data-lucide='circle-fill'>`?" |
| Maintain admin density (font-size-xs ≈ 12px) | Fix should not balloon paddings/font sizes | Ask user: "Fix sets font-size: 16px which breaks admin density. Use var(--font-size-xs)?" |
| Source-derived class names (when source-copy/ exists) | Fix should reuse existing classes, not invent new ones | Ask user: "Class .my-new-button is invented. Existing class `.btn-primary` matches — use that?" |

When user explicitly says "I want it different from the rule" (e.g. "yes, use the bigger font for this one specific button"), respect that — but log the deviation in the final report.

## Step 6 — Execute fixes (per prototype framework)

**First, detect prototype framework** (same logic as `/preview` Step 2):

| Detection | Edit target type |
|---|---|
| `index.html` at root, no `package.json` | static HTML + inline `<style>` + inline `<script>` |
| `next.config.*` | TSX/JSX components in `app/` or `pages/`, CSS modules or Tailwind, `globals.css` |
| `nuxt.config.*` | Vue SFC in `pages/` + `components/`, scoped `<style>` blocks |
| `astro.config.*` | `.astro` files (frontmatter `---` ... `---` + template body + `<style>` + `<script>`); islands may contain React/Vue/Svelte/Solid |
| `angular.json` | `*.component.html` templates + `*.component.ts` + `*.component.scss` |
| `svelte.config.*` | `.svelte` files (template + `<script>` + `<style>`) |
| `vite.config.*` AND deps `@remix-run/dev` | Remix v2 — TSX in `app/routes/` (flat-route names like `booking._index.tsx`, `booking.$id.tsx`), `app/root.tsx`, `app/components/`, CSS via `links` export |
| `vite.config.*` | depends on imports — React JSX or Vue SFC |
| `remix.config.*` | Remix classic compiler — same edit targets as Remix Vite (`app/routes/`, `app/root.tsx`) |
| `gatsby-config.*` | React TSX/JSX in `src/pages/`, `src/templates/`, `src/components/`; gatsby-{node,browser,ssr}.js for site-wide config |

Each target type has different syntax — apply the right edit pattern.

### UI/visual fixes — per framework

| Framework | Edit pattern |
|---|---|
| static HTML | Edit `class="..."` attribute or inline `<style>` block |
| React/Next.js/Remix/Gatsby | Edit `className="..."` (NOT `class=`) — JSX requirement. For Remix flat routes the file is `app/routes/<...>.tsx`; for Gatsby pages it's `src/pages/<...>.tsx` |
| Vue SFC | Edit `class="..."` in `<template>` OR `:class="{ ... }"` for dynamic |
| Svelte | Edit `class="..."` OR `class:active={cond}` for conditional |
| Angular | Edit `class="..."` in `*.component.html` OR `[ngClass]="..."` for dynamic; for color tokens edit the component's `*.component.scss` or `:host { ... }` |
| Astro | Edit `class="..."` (HTML-like) in template body OR `class:list={[...]}` for dynamic. Frontmatter `---` block holds JS — only edit there when the fix needs to change a build-time variable used in template interpolation. Scoped `<style>` block is hash-class scoped at build, but write rules with the unscoped class names (Astro adds the hash automatically) |

For colors when theme imported: prefer CSS variable (`var(--color-danger)`) over literal hex. For spacing: use existing rem/px scale found in theme.css.

### Content fixes (missing labels / fields / columns)

- Read the source-copy/ file the gap references (Angular `*.component.html`, React `*.tsx`, Vue `*.vue`, Svelte `*.svelte`)
- Copy the exact label/structure into the prototype, **adapting syntax to prototype's framework**:

| Source → Prototype | Translation |
|---|---|
| Angular `*ngFor="let x of items"` → static HTML | Materialize loop with sample data inline |
| Angular `{{ value }}` → static HTML | Replace with literal value |
| Angular `[disabled]="cond"` → static HTML | Decide at edit time and hardcode `disabled` attr |
| React `{items.map(i => <Row .../>)}` → React JSX | Keep as is, just add the new row to the items array |
| React `{items.map}` → static HTML | Materialize with sample values |
| Vue `v-for="item in items"` → Vue SFC | Keep as is in target SFC |
| Vue `v-for` → static HTML | Materialize with sample values |
| Svelte `{#each items as item}` → Svelte | Keep |
| Svelte `{#each items as item}` → static HTML | Materialize |
| Astro `{items.map(x => <Card .../>)}` → static HTML | Materialize |
| Astro `<Component prop={x} />` → static HTML | Inline the component's first-render HTML |
| Astro `<slot />` → static HTML | Inline the slot's children content from the parent |
| Astro `client:load` / `client:visible` island → static HTML | Render the island's first-render HTML; preserve event handlers via `onclick` |
| Remix `useLoaderData()` → static HTML | Inline the loader's resolved data shape as hardcoded values |
| Remix `<Form method="post">` → static HTML | Replace with `<form onsubmit="event.preventDefault(); ...">` plus a JS handler that simulates the action's behaviour (toast + state mutation) |
| Remix `<Outlet />` (parent route) → static HTML | Inline the matching child route's HTML at the outlet position |
| Remix `<Link to="/path">` → static HTML | `<a href="path.html">` (or `./pages/path.html` per link-path rules) |
| Gatsby `data.allMarkdownRemark.nodes.map(...)` → static HTML | Hardcode 3-6 sample nodes with the same shape |
| Gatsby `<StaticImage src="..." />` / `<GatsbyImage />` → static HTML | Replace with `<img src="..." />`; copy the actual image into prototype's `assets/` |
| Gatsby `<Link to="/path">` → static HTML | `<a href="path.html">` |

For tables: insert `<th>` + `<td>` at the right column index. Match column order from source-copy/. For forms: insert `<label>` + `<input>` with `id`/`for`/`name` matching source's `formControlName` (Angular), `name` attr (React/Vue), `name` (Svelte).

### Interaction fixes — per framework

**Validation:** read `validators.json[<route>][<field>]` rules.

| Prototype framework | Implementation |
|---|---|
| static HTML | Inline JS function + HTML5 attrs (`required`, `pattern`, `min`, `max`, `minlength`) |
| React / Next.js / Gatsby | `react-hook-form` + zod schema OR controlled state with manual validators OR HTML5 attrs |
| Vue / Nuxt | VeeValidate + zod OR `:rules` for Element Plus / native attrs |
| Svelte / SvelteKit | Felte + zod OR Superforms (SvelteKit) OR native attrs |
| Angular | Reactive form with `Validators.required`, `Validators.pattern(<regex>)`, etc. |
| Astro | Native HTML5 attrs in `<form>` for static-only pages; for islands use the island's framework pattern (React/Vue/Svelte) |
| Remix (classic / Vite) | Server-side: `parse(zodSchema, formData)` in the `action` export. Client-side: pair native HTML5 attrs with optional `react-hook-form` or `Conform` for richer messages |

For static prototypes, always emit BOTH HTML5 attribute (e.g. `required`, `pattern="..."`) AND JS-side check on submit (so the demo shows custom error messages).

**Event handlers:** read `events.json[<route>].handlers[<name>].actions`.

| Action kind | Static HTML | React/Next/Gatsby | Vue/Nuxt | Svelte | Angular | Astro | Remix |
|---|---|---|---|---|---|---|---|
| `toast` | `showToast(msg)` helper | `toast.success(msg)` (sonner) | `ElMessage.success(msg)` | toast helper | `MatSnackBar.open(msg)` | island toast OR `<script>` `showToast()` | `toast.success(msg)` (sonner — common) |
| `dialog-open` | `el.hidden = false` | `setOpen(true)` | `dialogVisible.value = true` | bindable boolean | `MatDialog.open(...)` | client island state OR vanilla JS | `setOpen(true)` |
| `dialog-close` | `el.hidden = true` | `setOpen(false)` | `dialogVisible.value = false` | reset bindable | `dialogRef.close()` | island state | `setOpen(false)` |
| `http-post` (simulated) | localStorage mutation + setTimeout | `useMutation` mock OR setState | `axios.post` mocked | fetch mocked | `HttpClient.post` mocked | island fetch mock | `<Form method="post">` simulated as `onsubmit` + state |
| `navigate` | `window.location.href = '...'` | `router.push(...)` | `router.push(...)` | `goto(...)` | `Router.navigate(...)` | `<a href>` OR `Astro.redirect()` (server) | `<Link to="...">` OR `useNavigate()` |
| `loader` (Remix-only) | n/a | n/a | n/a | n/a | n/a | n/a | Run client-side as `useEffect`/`onMount` fetch when porting to non-Remix; otherwise hardcode |
| `action` (Remix-only) | n/a | n/a | n/a | n/a | n/a | n/a | Replace with onsubmit handler that mocks the action's response |

For static-html prototypes (most common), always use the vanilla JS column. For other framework prototypes, use the matching framework's pattern.

**Form binding:** ensure `id`/`for`/`name` attribute consistency. For React, `htmlFor` instead of `for`. Other frameworks use `for`.

### Theme fixes — per token source

| Token source signature | Override location |
|---|---|
| `theme/theme.css` (`:root { --color-X }`) — html-tailwind import | Edit `{themeDir}/theme.css` and add override variable |
| `globals.css` with shadcn-style `:root { --primary: 222 47% 11%; }` | Edit `globals.css` `--<token>` value |
| `tailwind.config.{js,ts}` `theme.extend.colors` | Edit the config file's color value (requires rebuild for vite/next) |
| Element Plus / Vuetify / PrimeVue theme | Override via SCSS variables file OR theme.json — ask user for project-specific path |
| MUI theme provider | Edit the `createTheme({ palette: { ... } })` call site |

When user opts to override:
1. Identify the token source from theme dir / config file
2. Apply override at the right location
3. Note in final report whether the override needs a rebuild (yes for Tailwind config, no for CSS variable changes)

### Re-read verification

After complex edits (3+ lines changed in one Edit call), re-read the changed file briefly. For simple value swaps (single-line edits) skip re-read — Edit tool would have errored if it failed.

## Step 7 — Smoke test (per framework)

Run sanity checks appropriate to the prototype's framework:

### Static HTML prototype
1. **Tag balance**: count `<tagname[^/>]*>` opens vs `</tagname>` closes per non-self-closing tag (ignore `<br>`, `<img>`, `<input>`, `<hr>`, `<meta>`, `<link>`, `<source>`). Mismatches are likely real bugs.
2. **JS parse**: extract inline `<script>` blocks, run `node --check -` on the concatenated content (pipe via Bash).
3. **Class references**: grep `class="([^"]+)"` → for each class token, verify it's defined in either `theme.css` / `<style>` block / Tailwind utility set. Warn (not fail) on unknowns.
4. **No emoji introduced**: grep for `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]` in `index.html` and `pages/*.html`. Fail if any.
5. **Broken cross-page links**: extract `href="..."` values, verify each target exists. Skip `http(s)://`, `mailto:`, `#anchor`.

### React / Next.js / Gatsby / Remix prototype
1. **Lint**: `npm run lint` if script exists; otherwise skip.
2. **Type check**: `npm run typecheck` or `npx tsc --noEmit` if `tsconfig.json` present.
3. **Build smoke**: `npm run build --dry-run` (if framework supports) — only when fix is structural.
4. **className not class**: grep `class="` in `.tsx`/`.jsx` files — flag as potential bug (JSX requires `className`).
5. **htmlFor not for**: grep `<label\s[^>]*\bfor=` in `.tsx` files — JSX requires `htmlFor`.
6. **No emoji introduced**: same as static.
7. **Remix-specific**: grep `useLoaderData|useActionData` in route files — verify the corresponding `loader`/`action` export still exists in the same file (otherwise the hook errors at runtime).
8. **Gatsby-specific**: grep `graphql\`...\`` page queries — verify the field set referenced in the JSX matches the query selection set (regex `data\.\w+` ↔ query field).

### Vue SFC prototype
1. **`vue-tsc --noEmit`** if `vue-tsc` available.
2. **Template syntax**: scan for unclosed `<template>`, `<script>`, `<style>` blocks per SFC.
3. **No emoji**: same.

### Svelte prototype
1. **`svelte-check`** if available.
2. **No emoji**: same.

### Angular prototype
1. **`ng build --configuration development --no-progress`** as smoke (slow but authoritative). OR skip and trust the Edit went through cleanly.
2. **Template binding**: grep for `formControlName="X"` — verify X exists in the corresponding component class.
3. **No emoji**: same.

### Astro prototype
1. **`astro check`** if available — type-checks `.astro` files.
2. **Frontmatter balance**: every `.astro` file should have exactly 0 or 2 occurrences of the `---` line; flag files with odd counts.
3. **Hydration directive sanity**: when an island has `client:only` but no `<framework>` value (e.g. `client:only` without `="react"`), flag — Astro requires the framework name.
4. **`<style>` scoped class refs**: grep class attributes against rules in scoped `<style>` blocks; warn on unknowns.
5. **No emoji**: same.

### Remix prototype (additional checks beyond React)
1. **Route file naming**: `app/routes/*.tsx` filenames should use `.` as separator and `$` for params. Flag invalid characters.
2. **Server module split**: code that imports `~/lib/db` or `node:fs` belongs in a `loader`/`action` (server) — flag if present in the default export's component body.
3. **`<Form>` action target**: when `<Form action="?/x">` references a named action, verify the corresponding `action` export handles the `?/x` discriminator.

### Gatsby prototype (additional checks beyond React)
1. **Page query export naming**: each page file should export EXACTLY ONE `query` graphql tagged template (or zero). Flag duplicates.
2. **`StaticImage` / `GatsbyImage` src paths**: when present in JSX, verify the path resolves under `src/images/` or via `gatsby-source-filesystem` configured paths.
3. **Internal Link paths**: `<Link to="/x">` paths should be absolute from site root (start with `/`); flag relative paths.

### Common to all frameworks
- **Theme variable references**: grep `var\(--[\w-]+\)` → verify each `--name` is defined in the imported theme. Warn on unknowns.
- **Lucide icon names**: grep `data-lucide="X"` (static) or `<X />` Lucide React imports → verify X is a known Lucide icon name (cross-check against https://lucide.dev/icons OR a snapshot list bundled in the plugin).

When any check fails, print the issue summary and ask:
> "Smoke test found {N} issues after fixes. Show details and let me try to repair?"

Auto-repair is OK for trivial fixes (e.g. `class` → `className`); for ambiguous failures, surface to user and stop.

## Step 8 — Re-verify suggestion

After applying fixes, prompt the user:

> "Fixes applied. Run `/feature-mockup:fm-verify {feature}` to confirm the issues are resolved?"

Use `AskUserQuestion`:
1. **Yes, run verify now**
2. **No, I'll review manually first**
3. **Open the prototype** (run `/feature-mockup:fm-preview {feature}` first)

## Step 8b — Sync to timeline

After applying fixes, mark resolved gaps in the timeline:

```bash
# applied[] is the list of gap IDs that the user confirmed — pass them all
node {pluginRoot}/scripts/timeline.mjs resolve-gaps \
  --feature-dir "{featureDir}" \
  --ids "<comma-separated gap IDs from applied[]>" \
  --fix-event "evt-pending"   # placeholder; will be replaced by the actual event ID below

# Append the fix event itself (this will return the new event ID)
node {pluginRoot}/scripts/timeline.mjs append \
  --feature-dir "{featureDir}" \
  --kind fix \
  --summary "Fix run <N>: applied <X> fixes (<P0count> P0 + <P1count> P1), skipped <Y>" \
  --data '{"fixLogPath":".verify/fix-log-<ISO>.md","applied":[<ids>],"skipped":[<ids>],"themeDeviations":[<notes>]}'
```

The first call uses the placeholder `evt-pending`; the second call appends the event and prints its ID. If you want the resolved gaps' `resolvedBy` to reference the exact event, run resolve-gaps AGAIN with the real event ID after append. Or, simpler: run append first, parse the eventId from its output, then resolve-gaps with that ID.

After timeline writes, the next time the user runs `/feature-mockup:fm-preview` or `/feature-mockup:fm-status`, the resume hint will reflect the new pending count (which may now be zero — phase becomes `fixed`).

## Step 9 — Final report

Write `{featureDir}/.verify/fix-log-{ISO-date}.md`:

```markdown
# Fix log — {date}

Applied fixes:
  - [P0] gap-grid-col-04: Added Region column at index 4 (file: index.html)
  - [P0] gap-modal-validation: Wired hotelCode pattern validator (files: index.html, validators inline)
  - [P1] gap-toolbar-buttons-3-of-8: Added 3 buttons (file: index.html)
  - [P1] gap-status-color: Changed status-cancelled to var(--color-danger) (file: theme.css override)

Skipped (per user request):
  - [P2] gap-spacing-tight: User wants the looser 16px spacing

Theme rule deviations (per user request):
  - gap-status-color: Used hardcoded #dc2626 instead of var() because user said the token was wrong shade

Smoke test: PASS (0 issues)

Files changed:
  - {featureDir}/index.html (5 edits)
  - {featureDir}/styles.css (1 edit)
```

Print the report path so user can audit.

## Edge cases

- **Conflicting fixes**: when 2 gaps want to change the same line differently, show user both options and ask.
- **Fix introduces a new gap** (e.g. adding column makes table overflow): note in fix log; suggest re-verify.
- **User asks to fix something the brief originally said NOT to do**: ask explicitly: "The brief says 'no Booking ID column'. You want to add it anyway?"
- **Theme not imported**: skip theme-token rules; use literal values.
- **Fix requires source data we don't have**: ask user: "I need the actual {field} options to add this dropdown. Provide a list, or extract from real admin via /feature-mockup:fm-verify first?"
- **Mass rewrite request** ("redo the entire grid"): refuse, ask user to break into specific issues OR run /feature-mockup:fm-make again with updated brief.

## Done

End with:
1. Fix-log path
2. Suggested next command (re-verify or preview)
3. List of files changed (so user knows what to review)
