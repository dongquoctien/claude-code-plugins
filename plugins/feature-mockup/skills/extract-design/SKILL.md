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
   node {pluginRoot}/scripts/crawl-styles.mjs --in {projectRoot} --type {type} --path {path} --out {tmpDir}/tokens.json --globals-out {tmpDir}/globals.css
   ```
   The script normalizes Tailwind / SCSS variables / CSS vars into the canonical `tokens.json` shape. SCSS variables are resolved by reading the file and following `@import` chains shallowly (one level deep).

2. **Component list.** Run `crawl-components.mjs` again (without `--classify`) to write `{tmpDir}/components.list.md`:
   ```markdown
   # Components in oh-admin (Angular 9)

   ## Presentational
   - Button (src/app/shared/modules/button/button.component.ts)
   - Card  (src/app/shared/modules/card/card.component.ts)
   ...

   ## Notes
   These are component names only. Source is not included because the prototype
   target (HTML/Tailwind or React) can't run Angular/Vue templates. The BA's AI
   will use these names + the imported tokens to render equivalent prototypes.
   ```

3. **Manifest.** Generate `{tmpDir}/manifest.json` matching the spec at `docs/fe-export-spec.md`:
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
       "tokenSource": "<which candidate was used>"
     },
     "files": {
       "tokens": "tokens.json",
       "globalsCss": "globals.css",
       "componentsList": "components.list.md"
     },
     "components": [ /* same names from crawl, with framework + path */ ]
   }
   ```

4. **Zip.** Bundle the temp dir into the chosen output path using:
   - Windows: `Compress-Archive -Path {tmpDir}\* -DestinationPath {outPath} -Force`
   - macOS/Linux: `cd {tmpDir} && zip -r {outPath} .`
   Detect platform via `$env:OS` or `uname`.

5. Clean up `{tmpDir}`.

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
