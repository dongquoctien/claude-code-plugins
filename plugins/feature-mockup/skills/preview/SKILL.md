---
name: preview
description: "Use this when the user wants to open a generated prototype in a browser. Auto-detects template (static HTML or vite) and starts the right server. Invoke for prompts like 'preview the mockup', 'open prototype', '/feature-mockup:preview <feature>'."
argument-hint: "<feature-name>"
user-invocable: true
allowed-tools: Read, Bash, Glob
---

# Feature Mockup — Preview

Open a generated prototype in the user's default browser. Detect template (static HTML vs vite) and pick the right launch strategy.

## Step 1 — Load config + resolve feature dir

Read `.claude/feature-mockup.json`. If missing, stop with:
> "Run `/feature-mockup:init` first."

Extract `outputDir` and `workingLanguage`.

`$ARGUMENTS` is the feature name. Resolve `featureDir`:

```
featureDir = {projectRoot}/{outputDir}/{$ARGUMENTS}
```

If `featureDir` does not exist, stop with:
> "No mockup found at `{featureDir}`. Run `/feature-mockup:make {feature}` first, or check the spelling."

## Step 2 — Detect template

Inspect `featureDir` contents:

| Signature | Template |
|---|---|
| `index.html` exists at root, no `package.json` | `html-tailwind` (static) |
| `package.json` + `vite.config.{ts,js}` exists | `react-vite` |
| `package.json` only (no vite config) | `node-server` (run `npm start`) |
| Other / ambiguous | Ask user |

When ambiguous, ask:
> "Found `{files}` in the mockup folder — is this static HTML or a Node project to start?"

## Step 3 — Launch by template

### 3a. `html-tailwind` (static)

The prototype runs from `file://`. Open in default browser by detecting the platform:

| Platform detect | Command |
|---|---|
| Windows (`$env:OS == "Windows_NT"` OR `uname` fails) | `Start-Process "{featureDir}\index.html"` (PowerShell) OR `cmd /c start "" "{featureDir}\index.html"` (Bash) |
| macOS (`uname -s == "Darwin"`) | `open "{featureDir}/index.html"` |
| Linux (`uname -s == "Linux"`) | `xdg-open "{featureDir}/index.html"` |

Use `Bash` tool with the right command. Print the absolute path so the user can paste it manually if auto-open fails:

```
Opening: file:///{absolute-path}/index.html
```

If the prototype has multi-screen flow (`pages/` subdirectory), list the available pages:

```
Pages available:
  index.html         (main entry — opened)
  pages/results.html
  pages/confirm.html
  pages/success.html
```

### 3b. `react-vite` (or any `package.json` project)

```bash
cd {featureDir}

# Check node_modules
if [ ! -d node_modules ]; then
  npm install
fi

# Start dev server in background
npm run dev
```

The dev server logs the URL (typically `http://localhost:5173`). Capture stdout, find the URL, then open it with the platform's open command (same as 3a).

If `npm run dev` is not in `package.json`'s scripts, fall back to `npm start`. If neither, ask the user how to start.

For background launch on Windows: use the `run_in_background: true` parameter on the Bash tool. After 3 seconds, read the background output to capture the dev server URL.

### 3c. `node-server`

```bash
cd {featureDir}
npm install   # if needed
npm start
```

Same URL-capture flow as 3b.

## Step 4 — Print final report

Print, in `workingLanguage`:

**For static (html-tailwind):**
```
Prototype opened.

Path:      {featureDir}/index.html
URL:       file:///{abs-path}

If the browser did not open automatically, copy-paste the URL above.
```

**For dev-server (react-vite / node-server):**
```
Dev server started.

Local:     http://localhost:{port}
Path:      {featureDir}

Press Ctrl+C in the terminal where the server is running to stop it.
```

## Edge cases

- **Port already in use**: vite auto-bumps to next port (5174, 5175...). Capture whichever port it actually picked from stdout.
- **Headless / WSL / SSH**: `xdg-open` may fail silently. Always print the URL so the user can manually open it.
- **Multiple screens, no flow links**: when prototype has `pages/` but no `index.html` cross-links, list all `pages/*.html` and ask which to open.
- **Permission denied on Windows `start`**: fall back to printing path only and tell user to open manually.

## Done

End with the URL printed clearly so the user has a clickable line in the terminal.
