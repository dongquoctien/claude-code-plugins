---
name: extract-design
description: "Use this when a developer wants to export their front-end's design system (tokens + component list) into a zip that a BA can hand off to /feature-mockup:ingest-theme. Run this from inside the front-end project root. Auto-detects Angular, React, Vue, and Next.js. Invoke for prompts like 'extract design from this project', 'export theme for BA', '/feature-mockup:extract-design'."
argument-hint: "[--out <path>]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task
---

# Feature Mockup — Extract Design (dev-side)

You're helping a developer turn their existing front-end project into a `fe-design-export.zip` that a BA can ingest. This is a wizard — confirm each step with the user before moving on.

## Step 0 — Sanity check

Confirm you're inside a front-end project root:
- `package.json` exists, OR
- `angular.json` exists, OR
- `nuxt.config.*` exists.

If none, stop with:
> "This skill must be run from a front-end project root (where package.json or angular.json lives)."

Read `package.json` (if present). Note name + main deps.

## Step 1 — Detect stack (wizard step)

Run the detector script:

```bash
node {pluginRoot}/scripts/detect-stack.mjs --in {projectRoot}
```

The script prints JSON like:

```json
{
  "framework": "angular | react | vue | nextjs | unknown",
  "frameworkVersion": "9.1.4",
  "css": ["scss", "css", "tailwind"],
  "uiLib": ["kendo", "material", "shadcn", "antd", "none"],
  "stylesEntries": ["src/styles.scss", "src/css/styles.css"],
  "componentDirs": ["src/app/shared", "src/app/layout/components"],
  "tokenSourceCandidates": [
    { "type": "tailwind",  "path": "tailwind.config.ts" },
    { "type": "scss-vars", "path": "src/styles.scss" },
    { "type": "css-vars",  "path": "src/styles.css" }
  ],
  "warnings": []
}
```

Show the result to the user in a short, readable summary, then ask:
> "Stack detected: **{framework} {version}** with **{css}** + **{uiLib}**. Confirm? (y / edit)"

If they choose `edit`, ask which fields to change. Persist their corrected values for the rest of the wizard.

## Step 2 — Confirm style sources (wizard step)

Show the detected `stylesEntries` and `tokenSourceCandidates`. Ask:
> "Token sources to crawl: {list}. Confirm? (y / add path / remove)"

Validate every path exists with `Glob` or `Read`. Drop missing ones with a warning.

## Step 3 — Confirm component dirs (wizard step)

Show the detected `componentDirs`. For each dir, count files matching the framework's component pattern:

| Framework | Pattern |
|---|---|
| Angular | `**/*.component.ts` |
| React/Next.js | `**/*.{tsx,jsx}` (uppercase first letter) |
| Vue | `**/*.vue` |

Print like:
```
src/app/shared        — 47 components
src/app/layout/components — 12 components
```

Ask:
> "These are the dirs we'll scan for component names. Confirm? (y / add / remove)"

## Step 4 — Choose what to include (wizard step)

Run:
```bash
node {pluginRoot}/scripts/crawl-components.mjs --in {projectRoot} --framework {framework} --dirs {componentDirs} --classify
```

The script lists every component with a heuristic classification:
- `presentational` — pure UI (Button, Card, Badge, Modal). Detected by: small, no service injection, no router/store imports.
- `business` — domain logic (BookingList, UserForm). Skipped by default.
- `unknown` — couldn't classify confidently.

Show counts:
```
Presentational: 24
Business:       18
Unknown:         5
```

Ask:
> "Include: presentational only / + unknown / all. Pick one. (default: presentational)"

Also ask:
> "Generate a textual component list to send the BA, or skip? (y/n, default: y)"

(We do NOT copy non-React component source — Angular/Vue templates can't run in a static prototype. The list lets the AI building the prototype know what design vocabulary the team uses.)

## Step 5 — Output path (wizard step)

Default: `{projectRoot}/fe-design-export.zip` (or `--out` from arguments).

Ask:
> "Write export to: {path}. Confirm? (y / edit)"

If the file exists, ask whether to overwrite.

## Step 6 — Run extraction

Now do the actual work, in this order:

1. **Tokens.** Pick the highest-priority candidate from `tokenSourceCandidates` and run:
   ```bash
   node {pluginRoot}/scripts/crawl-styles.mjs --in {projectRoot} --type {type} --path {path} --out {tmpDir}/tokens.json --globals-out {tmpDir}/globals.css [--theme-variant {activeThemeVariant}]
   ```
   Pass `--theme-variant` when the detector reported one. The script normalizes Tailwind / SCSS variables / CSS vars into the canonical `tokens.json` shape and overlays the active theme variant block on top of `:root` for multi-theme systems.

2. **Source index.** Run:
   ```bash
   node {pluginRoot}/scripts/index-source.mjs --in {projectRoot} --out {tmpDir}/source-index.json
   ```
   Produces a categorized map of every CSS/SCSS file, component, template, route folder, image, and font with size + one-line summaries. The downstream AI agent reads this index BEFORE individual files so it can prioritize globalStyles + themeFiles + componentStyles intelligently.

2b. **Icon library + brand assets.** Run:
   ```bash
   node {pluginRoot}/scripts/detect-icons.mjs --in {projectRoot} --out {tmpDir}/icon-detection.json
   ```
   Detects which icon library the project actually uses (FontAwesome / Lucide / Material / Heroicons / Phosphor / custom-svg / custom-png / none) and locates the brand logo (`header-logo*.png|svg`, `app-logo*.png|svg`). Without this, the agent defaults to Lucide and uses a text-only logo — which is wrong for any project using FontAwesome / Material / a real PNG logo. The icon library + logo path go into `manifest.brand` and `manifest.stack.iconLibrary` so the prototype-builder can pick the matching CDN and link the real logo image.

2b2. **Dialog and toast patterns.** Run:
   ```bash
   node {pluginRoot}/scripts/detect-dialogs.mjs --in {projectRoot} --out {tmpDir}/dialog-detection.json
   ```
   Scans all framework templates and component classes for dialog/modal/toast usage. Output is a per-feature map of every `<app-dialog>`, `<kendo-dialog>`, `<mat-dialog>`, `<p-dialog>`, `<el-dialog>`, `<v-dialog>`, `<a-modal>`, `<Dialog>`, `<DialogContent>`, `<Modal>` with header text and modal size, plus a global toast/alert call count and message samples. Reference benchmark on a real admin codebase (`oh-admin`): detected 272 dialogs across 101 feature routes, 1208 toast/alert calls. Critical for the prototype-builder so it renders dialogs as overlays (not separate pages) and includes toast/snackbar feedback after submit actions.

2c. **Source files — copy templates and components.** Run:
   ```bash
   node {pluginRoot}/scripts/crawl-source.mjs --in {projectRoot} --out {tmpDir}/source-copy
   ```
   Copies framework component sources verbatim into the export, preserving folder structure under `source-copy/src/...`. Caps at 20MB by default. Includes:
   - Angular: `*.component.html` + `*.component.ts` + `*.module.ts` + `*.service.ts` (use `--no-services` to skip)
   - Vue / Svelte: `.vue` / `.svelte` SFCs
   - React/Next.js: PascalCase `.tsx`/`.jsx` files

   **Why this matters:** the BA usually doesn't have the dev's source repo. Without this step, `source-index.json` lists paths the BA's agent cannot resolve. Copying the actual files makes the export self-contained — the BA agent can `Read` any path it sees in `source-index.json`. Reference benchmark on a real admin codebase (`oh-admin`): 3074 files (1153 templates + 1157 components + 387 services + 362 modules) = 12.5 MB.

2d. **Form validators.** Run:
   ```bash
   node {pluginRoot}/scripts/extract-validators.mjs --in {projectRoot} --out {tmpDir}/validators.json
   ```
   Extracts per-field validation rules (Angular `Validators.required/email/min/max/pattern`, class-validator decorators `@IsEmail`/`@MinLength`/`@Min`/`@IsNotEmpty`, HTML5 attributes `required`/`type=email`/`pattern=`/`minlength=`). Output groups by feature route. The BA-side prototype embeds these rules in inline JS and runs them on form submit (alongside HTML5 native validation). Without this file, prototype forms accept any input and the demo doesn't realistically reject bad data. Reference benchmark on a real admin codebase (`oh-admin`): 1129 fields with 1192 rules across 100+ routes.

2e1. **Event handlers + UX flows.** Run:
   ```bash
   node {pluginRoot}/scripts/extract-events.mjs --in {projectRoot} --out {tmpDir}/events.json
   ```
   Multi-stack scanner (Angular component.ts, Vue SFC `<script setup>`, React tsx, Svelte) that pulls every event handler method (onSave, onDelete, onSubmit, openXxxDialog, ...) and tags the actions inside its body: toast / dialog-open / dialog-close / navigate / http-get/post/put/delete / ngrx-dispatch / pinia-action / form-submit / form-reset / event-emit. Plus extracts trigger bindings from templates (`(click)="..."`, `@click="..."`, `onClick={...}`).

   The BA-side prototype-builder uses this to auto-wire JS handlers with the correct UX flow: e.g. `onSave<Entity>` → validate form → store mutation → toast "Saved" → close modal. Without events.json, the agent guesses the flow from dialog headers + brief text and misses real product behavior. Reference benchmark on a real admin codebase (`oh-admin`): 3492 handlers + 5134 actions + 1634 template triggers across 130 routes.

2e2. **Business rules + error messages + constants.** Run:
   ```bash
   node {pluginRoot}/scripts/extract-business-rules.mjs --in {projectRoot} --out {tmpDir}/business-rules.json
   ```
   Multi-stack scanner that captures:
   - Tagged business-rule comments: `// BR-001`, `// ERR-REG-014`, `// R12 legacy`, `/* business: ... */`
   - Imperative comments: `// must`, `// cannot`, `// max 20 chips`
   - Conditional alerts: `if (condition) { alert("Period max 3 months") }` → captures both condition AND message
   - Custom validators: `function validateFoo() { return { errorKey } }`
   - Constants with admin-meaningful prefixes: `MAX_AREA_CHIPS = 20`, `ERR_VALIDATION_xxx`, `DEFAULT_PAGE_SIZE`
   - Error codes referenced in source: `'ERR-REG-003'`, `'ERR-VAL-XXX'`
   - Conditional disable/hide: `[disabled]="region === 'multi'"`, `:disabled="..."`, `disabled={...}`

   Reference benchmark on a real admin codebase (`oh-admin`): 525 rules + 331 errors + 9 constants. ho-hotel-contents alone surfaced 4 conditional alerts with real source messages ("Period accept max 3 months", "There are no items selected", etc.) — exactly the implicit business rules the prototype must demonstrate.

2e. **Mock data — seed records per entity.** Run:
   ```bash
   node {pluginRoot}/scripts/extract-mock-data.mjs --in {projectRoot} --out {tmpDir}/mock-data.json
   ```
   Scans `*.ts` source files for hardcoded arrays of objects (status options, dropdown labels, enum lists, sample fixtures). The literal-array parser handles single-quoted strings, unquoted keys, `as Foo` casts, trailing commas. Output groups extracted entities per feature route.

   **Why this matters for the prototype:** the BA wants to demo CRUD — Create / Read / Update / Delete with realistic-looking data. Source-extracted entities (status codes, vendor lists, region tiers) ARE realistic because the dev wrote them. Plus the prototype-builder agent supplements with 5-15 invented records per main entity to fill the grid for demo. The combined seed data goes into the prototype's inline `<script>` as `SEED_DATA`, then localStorage persists user mutations across reloads.

   Reference benchmark on a real admin codebase (`oh-admin`): 11 entities, 58 records auto-extracted from service files (e.g. `contents-mapping-data.service.ts` exposes 62 mapping row labels — perfect for filling a Contents Mapping demo without inventing copy).

3. **Component styles — gather then AI-clean.** Run:
   ```bash
   node {pluginRoot}/scripts/concat-component-styles.mjs --in {projectRoot} --out {tmpDir}/component-styles.raw.scss
   ```
   Walks `src/**` and concatenates every Angular `*.component.scss` / `*.component.css`, plus Vue `<style>` blocks and Svelte `<style>` blocks. Output is RAW (variables not resolved, :host not stripped, duplicates not deduped) and is intended for the **AI cleanup pass** described in `theme-extractor.md`. The cleanup happens later, on the BA side, when `ingest-theme` runs — at extraction time we just gather the raw input.

   When the project has no component stylesheets (pure-React without CSS modules, etc.) the script still runs and writes a near-empty file. Don't fail.

4. **Assets — icons, images, fonts.** Run:
   ```bash
   node {pluginRoot}/scripts/crawl-assets.mjs --in {projectRoot} --out {tmpDir}/assets [--font-budget-mb 6] [--skip-fonts]
   ```
   Walks `src/assets/`, `public/assets/`, `public/`, or `static/` and copies icons (svg/png with `ico-` prefix or in `icons/`), images, fonts (woff2 preferred, capped to a budget), and CSS/SCSS partials into `{tmpDir}/assets/` preserving the original folder structure so url() references in the compiled CSS keep resolving.

   Default font budget is 8MB. Pass `--font-budget-mb 0` or `--skip-fonts` to skip font binaries entirely (the prototype falls back to CDN fonts like Pretendard/Inter via @import). Warn the user before fonts push the zip over 20MB.

5. **Component list.** Run `crawl-components.mjs` again (without `--classify`) to write `{tmpDir}/components.list.md`:
   ```markdown
   # Components in <project-name> (<framework version>)

   ## Presentational
   - Button (src/app/shared/modules/button/button.component.ts)
   - Card  (src/app/shared/modules/card/card.component.ts)
   ...

   ## Notes
   These are component names only. Source is not included because the prototype
   target (HTML/Tailwind or React) can't run Angular/Vue templates. The BA's AI
   will use these names + the imported tokens to render equivalent prototypes.
   ```

6. **Manifest.** Generate `{tmpDir}/manifest.json` matching the spec at `docs/fe-export-spec.md`:
   ```json
   {
     "name": "<from package.json or angular.json>",
     "version": "<from package.json>",
     "exportedAt": "<ISO now>",
     "stack": {
       "framework": "<detected>",
       "frameworkVersion": "<detected>",
       "css": "<primary css approach>",
       "uiLib": "<detected, or 'none'>",
       "tokenSource": "<which candidate was used>",
       "activeThemeVariant": "<from detector, or null>",
       "routes": [ /* up to 100 route folder names from detector */ ],
       "iconLibrary": "<from icon-detection.json — fontawesome | lucide | material-icons | heroicons | phosphor | custom-svg | custom-png | none>"
     },
     "files": {
       "tokens": "tokens.json",
       "globalsCss": "globals.css",
       "sourceIndex": "source-index.json",
       "iconDetection": "icon-detection.json",
       "dialogDetection": "dialog-detection.json",
       "validators": "validators.json",
       "events": "events.json",
       "businessRules": "business-rules.json",
       "mockData": "mock-data.json",
       "sourceCopy": "source-copy/",
       "sourceCopyManifest": "source-copy/_source-copy-manifest.json",
       "componentStylesRaw": "component-styles.raw.scss",
       "assetsManifest": "assets/_assets-manifest.json",
       "componentsList": "components.list.md"
     },
     "brand": {
       "logo": "<from icon-detection.json>",
       "logoVariants": [/* additional matching files */],
       "favicon": "<from icon-detection.json>"
     },
     "components": [ /* same names from crawl, with framework + path */ ]
   }
   ```

7. **Zip.** Bundle the temp dir into the chosen output path using:
   - Windows: `Compress-Archive -Path {tmpDir}\* -DestinationPath {outPath} -Force`
   - macOS/Linux: `cd {tmpDir} && zip -r {outPath} .`
   Detect platform via `$env:OS` or `uname`.

8. Clean up `{tmpDir}`.

## Step 7 — Final report

Print, in the working language (read from `.claude/feature-mockup.json` if present, else default to `en`):

```
Design exported.

File:        {outPath}
Stack:       {framework} {version} + {css} + {uiLib}
Tokens:      {N} colors, {N} spacing, {N} radii
Components:  {N} listed ({M} presentational, {K} unknown included)
Warnings:    {list, or "none"}

Hand this zip to the BA. They'll run:
  /feature-mockup:ingest-theme path/to/fe-design-export.zip
```

Done.
