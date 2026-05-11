---
name: fm-ingest-theme
description: "Use this when the user wants to import their team's real front-end design (tokens + components) into feature-mockup, so generated prototypes look like the real product. Invoke for prompts like 'import our design', 'ingest theme', '/feature-mockup:fm-ingest-theme <path>'. Accepts a zip file or directory."
argument-hint: "<path-to-fe-export-zip-or-dir>"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Bash, Task
---

# Feature Mockup — Ingest Theme

Import the team's real front-end design system. The end state: `.claude/feature-mockup/theme/` is populated with normalized tokens + cloned components, and `.claude/feature-mockup.json` has `theme.imported = true`.

## Step 1 — Load config

Read `.claude/feature-mockup.json`. If missing, stop with:
> "Run `/feature-mockup:fm-init` first."

Extract `workingLanguage` for user-facing output. All messages below use that language.

## Step 2 — Resolve input path

`$ARGUMENTS` is a path to either:
- a zip file (`.zip`)
- a directory containing `manifest.json` at the root

Validate:
- Path exists. If not, stop with the error path.
- If zip: extract to a temp folder using `unzip -o` (Unix) or `Expand-Archive` (Windows). Use `Bash` and detect platform via `$env:OS` or `uname`.
- After extracting/resolving, you should have a directory with `manifest.json` at the root. If not, stop with:
  > "Could not find manifest.json. The export must follow the spec at https://github.com/dongquoctien/claude-code-plugins/blob/main/plugins/feature-mockup/docs/fe-export-spec.md"

Set `EXPORT_DIR` = that directory's absolute path.

## Step 3 — Validate manifest

Read `{EXPORT_DIR}/manifest.json`. Required fields: `name`, `stack`. Recommended: `version`, `files`, `components`.

If `files.tokens` AND `files.tailwindConfig` AND `files.globalsCss` are ALL absent, stop with:
> "The export must include at least one of: tokens.json, tailwind.config.*, or globals.css. None found."

## Step 4 — Run theme-extractor agent

Use the `Task` tool to launch the **theme-extractor** subagent with:

```
Export dir:     {EXPORT_DIR}
Manifest:       {EXPORT_DIR}/manifest.json
Output dir:     {projectRoot}/.claude/feature-mockup/theme

Goal:
  Produce {output}/tokens.json (normalized) + {output}/theme.css (CSS variables) +
  {output}/components/ (cloned with rewritten imports) + {output}/source-manifest.json (copy of input manifest).

Additionally, when the export contains the following, copy them verbatim into the output (preserving folder structure so url() refs resolve):
  - {EXPORT_DIR}/source-index.json → {output}/source-index.json (categorized map of every source file with one-line summaries — read this BEFORE individual files when you need to navigate the design).
  - {EXPORT_DIR}/icon-detection.json → {output}/icon-detection.json (icon library + brand logo path).
  - {EXPORT_DIR}/dialog-detection.json → {output}/dialog-detection.json (per-feature map of dialog/modal headers and toast patterns — prototype-builder uses this to render overlays).
  - {EXPORT_DIR}/validators.json → {output}/validators.json (per-field validation rules — prototype embeds in inline JS for form submit validation).
  - {EXPORT_DIR}/events.json → {output}/events.json (event handlers + action tags per route — prototype auto-wires onclick handlers with correct UX flow: validate→mutate→toast→close).
  - {EXPORT_DIR}/business-rules.json → {output}/business-rules.json (conditional alerts + error messages + constants extracted from source — prototype shows real domain logic, not invented).
  - {EXPORT_DIR}/route-patterns.json → {output}/route-patterns.json (per-route filter-grid templates + cell two-line patterns + auto-derived prefix→group map — prototype-builder uses these to match the real admin's filter density and sidebar grouping instead of hardcoded defaults).
  - {EXPORT_DIR}/i18n.json → {output}/i18n.json (label dictionaries per locale extracted from source assets/i18n — prototype renders a language switcher and swaps labels at runtime, demoing the real multilingual UX instead of a single hardcoded language).
  - {EXPORT_DIR}/mock-data.json → {output}/mock-data.json (entity records auto-extracted from source services — prototype uses as SEED_DATA for CRUD).
  - {EXPORT_DIR}/source-copy/ → {output}/source-copy/ (verbatim Angular templates / Vue SFCs / React components — agent reads from here, not the dev's machine).
  - {EXPORT_DIR}/component-styles.raw.scss → run AI cleanup pass to produce {output}/component-styles.compiled.css (see theme-extractor.md Phase 2).
  - {EXPORT_DIR}/assets/ → {output}/assets/ (icons + images + fonts + raw style partials).

Pipeline:
  1. Detect token source priority: tokens.json > tailwind.config > globals.css.
     Use scripts/extract-tokens.mjs from the plugin to do the parsing — invoke with:
       node {pluginRoot}/scripts/extract-tokens.mjs --in {EXPORT_DIR} --out {output}/tokens.json
     Inspect stdout for warnings.

  2. If components/ exists in the export, run:
       node {pluginRoot}/scripts/clone-components.mjs --in {EXPORT_DIR}/components --out {output}/components --manifest {EXPORT_DIR}/manifest.json
     This rewrites @/lib/utils → ../utils, strips next/image and next/link imports, etc.
     If a component cannot be cleanly cloned, the script writes it to {output}/components/_quarantine/ instead — list these in your final report.

  3. Generate {output}/theme.css from tokens.json: a single :root block with CSS variables matching the html-tailwind template's var names (--color-bg, --color-fg, --color-accent, --radius, --font-sans, etc.). Map missing tokens to sensible defaults.

  4. Write {output}/source-manifest.json = a copy of the input manifest plus an "ingestedAt" ISO timestamp.

Return a structured summary: tokens extracted, components cloned (count + names), components quarantined (list + reasons), warnings.
```

Wait for the agent to finish. Surface its summary to the user.

## Step 5 — Update config

Edit `.claude/feature-mockup.json`:

```json
{
  ...,
  "theme": {
    "imported": true,
    "path": ".claude/feature-mockup/theme",
    "source": {
      "name": "<from manifest>",
      "version": "<from manifest>",
      "ingestedAt": "<ISO now>"
    }
  }
}
```

## Step 6 — Final report

Print, in `workingLanguage`:

```
Theme imported.

Source:           <name>@<version>
Tokens:           <count> color, <count> spacing, <count> radii, etc.
Components:       <names> (cloned)
Quarantined:      <names> (reason)  -- empty when all good
Theme path:       .claude/feature-mockup/theme

From now on /feature-mockup:fm-make will use the real-system theme automatically.
To re-import after a design system update, just run this skill again.
```

## Step 7 — Log to feature timelines (when applicable)

If this project has feature folders already (i.e. `outputDir` contains subdirectories with `brief.json` files), append a `theme-import` event to each one's timeline so future skill invocations know the theme was refreshed:

```bash
for featureDir in {outputDir}/*/; do
  if [ -f "$featureDir/brief.json" ]; then
    node {pluginRoot}/scripts/timeline.mjs append \
      --feature-dir "$featureDir" \
      --kind theme-import \
      --summary "Theme imported from <source-name>@<version>: <X> tokens, <Y> components" \
      --data '{"source":"<name>","version":"<version>","tokensCount":<X>,"componentsCount":<Y>,"themeDir":".claude/feature-mockup/theme"}'
  fi
done
```

When no features exist yet (first-time setup), skip this step.

Done.
