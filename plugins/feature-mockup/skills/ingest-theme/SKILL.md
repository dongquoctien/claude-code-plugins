---
name: ingest-theme
description: "Use this when the user wants to import their team's real front-end design (tokens + components) into feature-mockup, so generated prototypes look like the real product. Invoke for prompts like 'import our design', 'ingest theme', '/feature-mockup:ingest-theme <path>'. Accepts a zip file or directory."
argument-hint: "<path-to-fe-export-zip-or-dir>"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Bash, Task
---

# Feature Mockup — Ingest Theme

Import the team's real front-end design system. The end state: `.claude/feature-mockup/theme/` is populated with normalized tokens + cloned components, and `.claude/feature-mockup.json` has `theme.imported = true`.

## Step 1 — Load config

Read `.claude/feature-mockup.json`. If missing, stop with:
> "Run `/feature-mockup:init` first."

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

From now on /feature-mockup:make will use the real-system theme automatically.
To re-import after a design system update, just run this skill again.
```

Done.
