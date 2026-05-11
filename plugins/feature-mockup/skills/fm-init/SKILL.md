---
name: fm-init
description: "Use this when the user wants to set up Feature Mockup in a project for the first time, or run /feature-mockup:fm-init explicitly. Initializes .claude/feature-mockup.json with output dir, default template, and working language."
argument-hint: ""
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Bash
---

# Feature Mockup — Init

You are setting up the **feature-mockup** plugin in the current project. The end state is a valid `.claude/feature-mockup.json` config file at the project root.

## Step 1 — Detect existing config

Check if `.claude/feature-mockup.json` already exists.

- If yes, read it and ask: *"A config already exists for this project. Do you want to (1) keep it, (2) edit a field, or (3) overwrite from scratch?"* Then act on the answer.
- If no, continue.

## Step 2 — Ask the user (in their working language)

Pick the working language by asking once first (default: `en`):

> "Working language for prompts and generated copy? (en / ko / vi)"

Then ask each of the following, **in the chosen language**:

1. **Output directory** for generated mockups. Default: `docs/mockups`. Ask: *"Where should mockups be written?"*
2. **Default template** for prototypes:
   - `html-tailwind` — zero install, opens via `file://`. Best for stakeholder demos.
   - `react-vite` — full React + Vite project. Best when devs will fork the prototype.
   Ask: *"Which template should be the default? (html-tailwind / react-vite)"*
3. **Auto-open preview** after `/feature-mockup:fm-make` finishes? (`true` / `false`). Default: `true`.

## Step 3 — Write the config

Create `.claude/feature-mockup.json` with this exact shape:

```json
{
  "$schema": "https://raw.githubusercontent.com/dongquoctien/claude-code-plugins/main/plugins/feature-mockup/schemas/config.schema.json",
  "version": 1,
  "workingLanguage": "<en|ko|vi>",
  "outputDir": "<docs/mockups>",
  "defaultTemplate": "<html-tailwind|react-vite>",
  "autoPreview": <true|false>,
  "theme": {
    "imported": false,
    "path": ".claude/feature-mockup/theme"
  }
}
```

Do NOT add fields that the user did not pick. Do NOT include comments — JSON only.

## Step 4 — Confirm

Print a summary in the working language:

```
Feature Mockup is ready.

Config:    .claude/feature-mockup.json
Output:    <outputDir>
Template:  <defaultTemplate>
Language:  <workingLanguage>

Next steps:
  • Make a mockup:        /feature-mockup:fm-make "<feature-name>" [image.png ...] [doc.md ...]
  • Import real theme:    /feature-mockup:fm-ingest-theme <path-to-fe-export>
```

Make sure the config is created and the path is shown. Done.
