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

## Step 2 — Detect template + framework

Inspect `featureDir` contents in priority order. **First match wins.**

| Signature (check in this order) | Template / framework | Default port | Default script |
|---|---|---|---|
| `index.html` at root + no `package.json` | `static-html` | n/a (file://) | n/a |
| `next.config.{js,ts,mjs,cjs}` | `next` | 3000 | `dev` |
| `nuxt.config.{js,ts,mjs}` | `nuxt` | 3000 | `dev` |
| `astro.config.{js,ts,mjs,cjs}` | `astro` | 4321 | `dev` |
| `angular.json` | `angular` | 4200 | `start` |
| `svelte.config.{js,ts}` | `sveltekit` | 5173 | `dev` |
| `vite.config.{js,ts,mjs,cjs}` | `vite` (React/Vue/Svelte/Solid) | 5173 | `dev` |
| `remix.config.{js,ts}` OR `vite.config` with `@remix-run/dev` import | `remix` | 3000 | `dev` |
| `gatsby-config.{js,ts,mjs}` | `gatsby` | 8000 | `develop` |
| `webpack.config.{js,ts}` + `package.json` with `dev` script | `webpack` | 8080 | `dev` |
| `package.json` only (no config file) | `node-server` | (read from script) | `start` or `dev` |
| Multiple configs / ambiguous | ask user | — | — |

When ambiguous OR multiple top-level configs detected, ask:
> "Found `{files}`. Multiple frameworks detected — which one should I start? ({option1} / {option2} / static index.html / cancel)"

Read `package.json` `scripts` to confirm the chosen script exists. If `dev` is missing, fall back in this order: `start` → `serve` → `develop` → ask user.

## Step 2b — Detect package manager

Inspect `featureDir` for lock files (priority order — first match wins):

| Lock file | Package manager | Install command | Run script command |
|---|---|---|---|
| `bun.lockb` | bun | `bun install` | `bun run <script>` |
| `pnpm-lock.yaml` | pnpm | `pnpm install` | `pnpm run <script>` (or `pnpm <script>`) |
| `yarn.lock` | yarn | `yarn install` | `yarn <script>` |
| `package-lock.json` | npm | `npm install` | `npm run <script>` |
| (none) + `package.json` exists | npm (default) | `npm install` | `npm run <script>` |

Verify the chosen package manager binary exists in PATH before running. If missing (e.g. user has `pnpm-lock.yaml` but no pnpm installed), ask:
> "Lockfile says pnpm but pnpm is not installed. Use npm instead? (recommended) / install pnpm first / cancel"

## Step 3 — Launch by template

### 3a. `static-html`

The prototype runs from `file://`. Detect platform and open default browser:

| Platform detect | Command |
|---|---|
| Windows (`$env:OS == "Windows_NT"` OR `uname` fails OR `uname -r` contains `Microsoft`) | Bash: `cmd.exe /c start "" "{abs-path-with-backslashes}\index.html"` (works in WSL too) — OR PowerShell: `Start-Process "{abs-path}\index.html"` |
| WSL (`uname -r` matches `microsoft|WSL`) | Use `cmd.exe /c start ""` with the **Windows-style path** (convert `/mnt/c/...` → `C:\...` via `wslpath -w`). `xdg-open` does NOT launch the Windows browser. |
| macOS (`uname -s == "Darwin"`) | `open "{abs-path}/index.html"` |
| Linux native (`uname -s == "Linux"` AND not WSL) | `xdg-open "{abs-path}/index.html"` |

Use `Bash` tool with the right command. **Always print the URL** so the user can paste manually if auto-open fails:

```
Opening: file:///{abs-path}/index.html
```

If the prototype has multi-screen flow (`pages/` subdirectory), list the available pages with their flow position from `brief.json` `flow` array (when readable):

```
Pages available (flow order):
  index.html         (1. main entry — opened)
  pages/results.html (2.)
  pages/confirm.html (3.)
  pages/success.html (4.)
```

### 3b. Dev-server frameworks (next / nuxt / astro / angular / sveltekit / vite / remix / gatsby / webpack / node-server)

Use the package manager detected in Step 2b and the script identified in Step 2.

```bash
cd "{featureDir}"

# Install dependencies if missing
if [ ! -d node_modules ]; then
  {PM-INSTALL-CMD}     # e.g. pnpm install / bun install / yarn / npm install
fi

# Start dev server (runs in background — use the Bash run_in_background flag)
{PM-RUN-CMD} {SCRIPT}  # e.g. pnpm run dev / bun run dev / yarn dev / npm run start
```

**URL capture per framework** — wait up to 30 seconds for dev server output, then grep stdout for the first matching URL pattern:

| Framework | Stdout signature to grep |
|---|---|
| next | `- Local:\s+(https?://[^\s]+)` OR `Ready in \d+s\s+http(s)?://([^\s]+)` |
| nuxt | `> Local:\s+(https?://[^\s]+)` OR `Listening on (https?://[^\s]+)` |
| astro | `Local\s+(https?://[^\s]+)` |
| angular | `Local:\s+(https?://[^\s]+)` |
| sveltekit / vite | `Local:\s+(https?://[^\s]+)` (vite's standard output) |
| remix | `Local:\s+(https?://[^\s]+)` (vite-based) |
| gatsby | `You can now view .* in the browser.\s+(https?://[^\s]+)` |
| webpack | `Project is running at\s+(https?://[^\s]+)` OR `webpack-dev-server.* on.* (https?://[^\s]+)` |
| Generic fallback | `(https?://(?:localhost|127\.0\.0\.1):\d+(?:/[^\s]*)?)` |

If no URL appears in stdout within 30 seconds, surface the last 20 lines of stdout to the user and ask:
> "Dev server hasn't logged a URL after 30s. Is it crashing or slow? Show me the output, or fall back to {default-port-from-Step-2}."

When URL captured, open it with the platform-specific browser command (same logic as 3a — but pass the http(s) URL instead of file:// path).

**Background process tracking** — store the Bash invocation's `bash_id` in a comment in the final report so the user knows how to stop it:

```
Dev server PID: bash_id-XXXX
Stop with: (Ctrl+C in that terminal) OR /bashes (Claude Code) → kill bash_id-XXXX
```

### Special-case launch flags

Some frameworks need extra flags for the dev server to bind correctly:

| Framework | Command tweak | Why |
|---|---|---|
| Angular | `ng serve --open=false --host=0.0.0.0` (when in WSL/container) | Default `localhost` not reachable from Windows host |
| Vite | `vite --host=0.0.0.0 --port=5173` (when WSL) | Same |
| Next | `next dev -H 0.0.0.0 -p 3000` (when WSL) | Same |
| Nuxt | `nuxi dev --host 0.0.0.0 --port 3000` (when WSL) | Same |

Apply only when WSL detected. Print a hint:
> "Detected WSL — using `--host 0.0.0.0` so Windows browser can reach the server. Open `http://localhost:{port}` in Windows browser."

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

- **Port already in use**: most dev servers auto-bump to next port (vite 5174→5175, next prompts user). Capture whichever port the framework actually picked from stdout — never assume the default.
- **Headless / WSL / SSH**: GUI auto-open often fails silently. Always print the URL so the user can manually open it. For WSL, use `cmd.exe /c start` with `wslpath -w` conversion.
- **Multiple screens, no flow links**: when prototype has `pages/` but no `index.html` cross-links, list all `pages/*.html` and ask which to open.
- **Permission denied on Windows `start`**: fall back to printing path only and tell user to open manually.
- **Monorepo prototypes** (e.g. nx workspace): `package.json` may be at workspace root, not `featureDir`. If `featureDir/package.json` is missing but `featureDir/project.json` exists, ask user for the workspace command (`nx serve <project>`).
- **Container/Docker prototypes** (`Dockerfile` present): ask user — "Run via `docker compose up` or skip and start raw dev server?"
- **Storybook only** (`.storybook/` exists, no app entry): start `{PM-RUN-CMD} storybook` instead.
- **HTTPS-only dev** (e.g. Next.js with `--experimental-https`): capture the `https://` URL, not `http://`.
- **Tunneled URL** (e.g. ngrok in dev script): capture both `http://localhost:{port}` and the tunnel URL — print both.
- **Already-running server**: if user re-runs `/preview` for the same feature, check if the previous bash_id is still alive. If yes, just print the existing URL instead of spawning a duplicate. Use `TaskList` or `BashOutput` to inspect prior backgrounds.
- **No browser GUI at all** (pure server / CI): print URL + skip the open command. Don't error.

## Done

End with the URL printed clearly so the user has a clickable line in the terminal.
