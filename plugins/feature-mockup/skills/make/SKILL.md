---
name: make
description: "Use when the user wants to generate a runnable mockup/prototype for a feature, given a description and optional screenshots/documents. Invoke for prompts like 'make a prototype for X', 'tạo prototype cho Y', '/feature-mockup:make ...'. Reads .claude/feature-mockup.json, parses inputs (text + images + docs), then orchestrates the input-analyzer and prototype-builder agents."
argument-hint: "<feature-kebab-name> [path-to-image-or-doc ...]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Bash, Task
---

# Feature Mockup — Make

Generate a runnable prototype for: **$ARGUMENTS**

## Step 1 — Load config

1. Read `.claude/feature-mockup.json`.
2. If missing, stop with:
   > "Feature Mockup is not configured for this project. Run `/feature-mockup:init` first."
3. Extract `workingLanguage`, `outputDir`, `defaultTemplate`, `autoPreview`, `theme.imported`, `theme.path`.

**All user-facing output below this point must be in `workingLanguage`** (en / ko / vi). Map: `en`=English, `ko`=Korean, `vi`=Vietnamese.

## Step 2 — Parse arguments

`$ARGUMENTS` should contain:
- First token: `<feature>` in kebab-case (required).
- Remaining tokens: zero or more file paths (images: png/jpg/jpeg, docs: md/txt/pdf).

Validation:
- If no feature name, stop and ask for one.
- If feature contains spaces/uppercase, normalize to kebab-case and confirm with user.
- For each path, verify it exists with `Glob` or `Read`. Skip with a warning if missing.

Compute:
- `featureDir = {outputDir}/{feature}` (e.g., `docs/mockups/booking-cancel-flow`)
- If `featureDir` already exists, ask: *"Mockup folder already exists. Overwrite, append, or pick a new name?"*

## Step 3 — Run input-analyzer agent

Use the `Task` tool to launch the **input-analyzer** subagent. Pass:

```
Feature name: {feature}
Working language: {workingLanguage}
Inputs:
  - description (free text the user typed alongside the command, if any)
  - images: [{absolute paths to png/jpg/jpeg}]
  - documents: [{absolute paths to md/txt/pdf}]

Output: write a structured brief to {featureDir}/brief.json with this schema:
  {
    "feature": "<kebab>",
    "summary": "<2-3 sentence overview in workingLanguage>",
    "userStories": ["As a ...", ...],
    "screens": [
      { "id": "<kebab>", "title": "...", "purpose": "...",
        "components": ["Header","Form","Button"],
        "fields": [{"name":"...","type":"...","required":true}],
        "ctas": [{"label":"...","action":"navigate:<screen-id>"}] }
    ],
    "flow": ["<screen-id-1>", "<screen-id-2>", ...],
    "copy": { "<screen-id>": { "<key>": "<localized text>" } },
    "openQuestions": ["..."]
  }
```

Wait for the agent to return. If it reports `openQuestions`, surface them to the user before continuing — but also write the brief so the user can see partial progress.

## Step 4 — Decide theme branch

- If `theme.imported === true` AND `{theme.path}/tokens.json` exists → **branch A: real-system**.
- Otherwise → **branch B: default**.

Tell the user which branch was chosen, in one short line.

## Step 5 — Run prototype-builder agent

Launch the **prototype-builder** subagent with this brief:

```
Feature: {feature}
Brief: {featureDir}/brief.json
Template: {defaultTemplate}             # html-tailwind | react-vite
Theme branch: {real-system | default}
Theme dir (if real-system): {theme.path}
Output dir: {featureDir}
Working language: {workingLanguage}

Generate a runnable prototype. Requirements:
  - Multi-screen click-through (use the `flow` array for navigation)
  - All copy in workingLanguage
  - For html-tailwind: single index.html OR index.html + pages/*.html
  - For react-vite: package.json + src/ scaffolded so `npm install && npm run dev` works
  - For real-system theme: import tokens from theme dir; use cloned components from {theme.path}/components if available
  - For default theme: use Tailwind via CDN with neutral palette + one accent color suiting the feature
```

## Step 6 — Final report

Print a summary in `workingLanguage`:

```
Mockup ready: {featureDir}

Files:
  - brief.json
  - <list main entry files>

How to view:
  - html-tailwind:  open {featureDir}/index.html in a browser
  - react-vite:     cd {featureDir} && npm install && npm run dev

Open questions from analyzer:
  - <list>
```

If `autoPreview === true` AND template is `html-tailwind`, suggest the user run `/feature-mockup:preview {feature}`.

Done.
