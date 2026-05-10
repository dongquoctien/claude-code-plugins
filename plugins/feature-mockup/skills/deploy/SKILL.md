---
name: deploy
description: "Use this to publish a generated prototype to a free hosting provider so stakeholders can open it in any browser without running it locally. Asks the user to pick a provider (Netlify Drop / Surge.sh / Cloudflare Pages / GitHub Pages), auto-installs the needed CLI, runs framework build if required, then captures the live URL. Invoke for prompts like 'deploy the mockup', 'share prototype URL', '/feature-mockup:deploy <feature>'."
argument-hint: "<feature-name>"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Bash, AskUserQuestion
---

# Feature Mockup — Deploy

Publish the prototype to a free static-host provider and return a shareable URL. Wraps four CLI-driven providers behind one consistent flow. Always confirm choices with the user.

**Core principles:**
1. **Default to anonymous when possible** — Netlify Drop ships a URL in 30s without any account.
2. **Provider-pick BEFORE CLI install** — never auto-install a CLI the user didn't choose.
3. **Build before deploy when framework requires it** — static-html ships `featureDir` directly; vite/next/nuxt/etc need a build step.
4. **Save deploy history** — every successful deploy goes into `.claude/feature-mockup.json` `deployHistory[]` so the user can trace prior URLs.

## Step 1 — Load config + resolve feature dir

Read `.claude/feature-mockup.json`. If missing, stop with:
> "Run `/feature-mockup:init` first."

Extract `outputDir` and `workingLanguage`.

`$ARGUMENTS` is the feature name. Resolve `featureDir = {outputDir}/{$ARGUMENTS}`.

If `featureDir` does not exist, stop with:
> "No mockup found at `{featureDir}`. Run `/feature-mockup:make {feature}` first."

## Step 2 — Detect prototype framework + build output dir

Same detection as `/feature-mockup:preview` Step 2. Determine `prototypeFramework` AND the directory that will actually be uploaded:

| Framework signature | uploadDir (relative to featureDir) | Build needed? | Build command |
|---|---|---|---|
| `index.html` at root, no `package.json` | `.` (featureDir itself) | No | n/a |
| `next.config.*` | `out` | Yes | `next build && next export` (Next ≤14) OR `next build` (Next 15 with `output: 'export'`) |
| `nuxt.config.*` | `.output/public` | Yes | `nuxt generate` |
| `astro.config.*` | `dist` | Yes | `astro build` |
| `angular.json` | `dist/{angular-project-name}/browser` (Angular 17+) OR `dist/{angular-project-name}` (older) | Yes | `ng build --configuration production` |
| `svelte.config.*` AND adapter is `@sveltejs/adapter-static` | `build` | Yes | `vite build` (or `svelte-kit build` legacy) |
| `vite.config.*` AND deps include `@remix-run/dev` | `build/client` | Yes | `remix vite:build` (Remix Vite, requires static export setup — surface error if not) |
| `vite.config.*` (other) | `dist` | Yes | `vite build` |
| `remix.config.*` (classic) | n/a — needs Node server | No build target | Surface error: "Remix classic compiler requires a Node server. Switch to static-html or Remix Vite with static adapter." |
| `gatsby-config.*` | `public` | Yes | `gatsby build` |

If the framework requires a server runtime that can't deploy as static (Remix classic, Next with server components mode = `nodejs`, full SSR Nuxt without `nuxt generate`), surface to the user:

> "This prototype's framework needs a server runtime — static deploy won't work. Options: (1) regenerate as html-tailwind via `/feature-mockup:make`, (2) deploy to a Node host (Vercel/Railway — outside this skill's scope), (3) cancel."

Use `AskUserQuestion` for these options.

## Step 3 — Pick deploy provider (ASK THE USER)

Use `AskUserQuestion`:

> "Which hosting provider should I use?"

Options (4):
1. **Netlify Drop** (Recommended) — anonymous, 1 command, URL in ~30s, claim within 1h to keep
2. **Surge.sh** — persistent URL with custom subdomain, requires email signup once
3. **Cloudflare Pages** — unlimited bandwidth, persistent, requires Cloudflare account
4. **GitHub Pages** — persistent + version-controlled, requires git push to a `gh-pages` branch

Default to Netlify Drop when user picks "Other" or doesn't have a preference.

## Step 4 — Detect CLI tool + install if missing

Each provider requires its own CLI. Detect via `which` (Unix) or `where` (Windows) — fallback to `command -v <name>` in Bash. Then verify version >= minimum.

| Provider | CLI binary | Min version | Install command |
|---|---|---|---|
| Netlify Drop | `netlify` | 17.0.0 | `npm install -g netlify-cli` |
| Surge.sh | `surge` | 0.24.0 | `npm install -g surge` |
| Cloudflare Pages | `wrangler` | 3.0.0 | `npm install -g wrangler` |
| GitHub Pages | `git` + `gh` (optional) | git 2.0+ | `git` is usually pre-installed; `gh` install: see https://cli.github.com/ |

When CLI is missing, ask:

> "{X} CLI is not installed. Install it now? (Recommended) / Skip — show me the manual command / Pick a different provider"

For "Install":
- Run `{install-command}` via Bash. Capture stdout/stderr. Surface failures (e.g. permission denied) and ask user to elevate or run manually.
- After install, re-detect to verify.

For "Manual command":
- Print the install command + the deploy command + URL where to paste output. Stop the skill so user can rerun.

## Step 5 — Build prototype (when required)

If `Build needed?` from Step 2 is "Yes":

1. Detect package manager (same logic as `/preview` Step 2b: `bun.lockb` > `pnpm-lock.yaml` > `yarn.lock` > `package-lock.json` > npm default).

2. Install dependencies if `node_modules/` is missing:
   ```bash
   cd "{featureDir}"
   {pm-install}     # e.g. pnpm install
   ```

3. Run the build:
   ```bash
   cd "{featureDir}"
   {pm-run} build   # e.g. pnpm run build
   ```
   Use `run_in_background: true` only if build typically takes > 60s; otherwise wait synchronously. Capture stdout/stderr.

4. Verify the expected `uploadDir` exists after build. If missing, surface the build's tail output (last 30 lines) and ask:
   > "Build completed but expected output `{uploadDir}` is missing. Show me the build log to debug, or pick a different framework path?"

5. For Next.js: check whether `next.config.*` has `output: 'export'`. If not, the build won't emit static `out/`. Ask:
   > "Next.js project doesn't have static export configured. Add `output: 'export'` to next.config and rebuild? (Recommended) / Cancel deploy."
   When confirmed, edit the config, retry build.

## Step 6 — Execute deploy (per provider)

### 6a. Netlify Drop (anonymous)

```bash
cd "{featureDir}"
netlify deploy --allow-anonymous --dir "{uploadDir}" --no-build
```

Capture stdout. Look for the line containing `Website Draft URL:` or `Live Draft URL:` — extract the URL via regex `(https?://[^\s]+\.netlify\.app[^\s]*)`.

After capturing URL, print a **claim notice**:
> "URL is anonymous and expires in ~1 hour unless claimed. To keep it permanently, run `netlify deploy --site=<draft-site-id>` after creating a free Netlify account."

The draft site ID appears in stdout — extract it via `Draft site ID:\s+([a-f0-9-]+)` and pass to user.

### 6b. Surge.sh

First check auth status:
```bash
surge whoami
```

If output is "Not logged in", ask:
> "Surge needs an email + password (free, ~30s). Run interactive login now? (yes / cancel)"

If yes, instruct user to type `surge login` in a separate terminal (interactive prompt — can't be automated headless). Wait for user confirmation, then proceed.

Pick a subdomain. Default to `<feature-kebab-case>.surge.sh`. Check availability:
```bash
# Try-deploy is the only reliable check; surge has no list-available endpoint
```

Ask user:
> "Deploy as `https://{feature}.surge.sh`? (yes / pick a different subdomain / cancel)"

Run:
```bash
cd "{featureDir}"
surge "{uploadDir}" "{subdomain}.surge.sh"
```

Capture stdout. Surge prints `Success! Project is published and running at <url>` — parse `(https?://[^\s]+\.surge\.sh)`.

### 6c. Cloudflare Pages

First check auth:
```bash
wrangler whoami
```

If not authed, ask:
> "Cloudflare Wrangler needs to authenticate via browser. Run `wrangler login` now? (yes / I'll do it manually / cancel)"

If yes, run `wrangler login` and instruct user to complete the browser flow. Wait for confirmation.

Project name: ask user OR derive from feature name (kebab-case, max 32 chars, alphanumeric + dashes only):
> "Project name on Cloudflare Pages? (default: `{feature-kebab}`)"

Check if project exists:
```bash
wrangler pages project list 2>&1 | grep "{project-name}"
```

If not found, create:
```bash
wrangler pages project create "{project-name}" --production-branch=main
```

Deploy:
```bash
cd "{featureDir}"
wrangler pages deploy "{uploadDir}" --project-name="{project-name}" --branch=main
```

Capture stdout. Wrangler prints `✨ Deployment complete! Take a peek over at <url>`. Parse `(https?://[a-z0-9-]+\.pages\.dev[^\s]*)`.

### 6d. GitHub Pages

This requires a Git repository. Check:
```bash
cd "{featureDir}"
git rev-parse --is-inside-work-tree 2>/dev/null
```

If not in a git repo, ask:
> "GitHub Pages needs a git repository. Initialize a new one in `{featureDir}` and create a GitHub remote? (yes / cancel)"

Required user inputs:
1. **GitHub username/org** — ask if not in `gh auth status`
2. **Repository name** — default `{feature-kebab}-prototype`
3. **Visibility** — public (required for free GitHub Pages on personal accounts) or private (Pro/Team only)

Steps:
```bash
cd "{featureDir}"
git init -b main
git add -A
git commit -m "Prototype deploy via feature-mockup"

# Create remote repo (uses gh CLI when available)
gh repo create "{username}/{repo}" --{visibility} --source=. --push --remote=origin

# Create gh-pages branch from current state
git checkout --orphan gh-pages
git add -A
git commit -m "Deploy to GitHub Pages"
git push -u origin gh-pages

# Switch back to main for future changes
git checkout main
```

If `gh` CLI is missing, surface manual instructions:
> "Manual steps:
> 1. Create the repo at https://github.com/new
> 2. Run: `git remote add origin <url>` then `git push -u origin main` then `git push -u origin gh-pages`
> 3. Enable Pages: Repo settings → Pages → Source: gh-pages branch → Save"

URL pattern: `https://{username}.github.io/{repo}/` (deploy can take 1–5 min after push).

After push, verify via API:
```bash
gh api repos/{username}/{repo}/pages 2>/dev/null
```

When status is `built`, surface URL.

## Step 7 — Smoke-check the deployed URL

After URL captured, run:
```bash
curl -s -o /dev/null -w "%{http_code}" "{deployedUrl}"
```

Expected: `200`. If the site is still propagating (Cloudflare Pages, GitHub Pages can take 30s–2min), retry with a 10-second wait, max 6 attempts. Print:
> "Site is propagating... attempt {N}/6"

If still not 200 after 1 minute, surface URL anyway with a note:
> "Deploy command succeeded but the URL isn't reachable yet. CDN propagation can take a few minutes — try opening the URL in your browser shortly."

## Step 8 — Save deploy history + log to timeline

### 8a. Global deploy history (in config)

Read `.claude/feature-mockup.json`. Append to `deployHistory[]` (create the array if missing):

```json
{
  "deployHistory": [
    {
      "feature": "<feature-name>",
      "provider": "netlify-drop | surge | cloudflare-pages | github-pages",
      "url": "<deployed URL>",
      "deployedAt": "<ISO timestamp>",
      "uploadDir": "<relative path used>",
      "framework": "<prototypeFramework>",
      "providerMeta": {
        "draftSiteId": "<for netlify drop only>",
        "subdomain": "<for surge only>",
        "projectName": "<for cloudflare only>",
        "repository": "<for github only>",
        "expiresAt": "<for netlify drop, ISO 1h after deployedAt>"
      }
    }
  ]
}
```

Cap the array at the 20 most recent entries. Older entries get truncated.

### 8b. Per-feature timeline event

Also append to the feature's own timeline so a returning BA sees deploys in STATUS.md:

```bash
node {pluginRoot}/scripts/timeline.mjs append \
  --feature-dir "{featureDir}" \
  --kind deploy \
  --summary "Deployed to <provider>" \
  --data '{"provider":"<provider>","url":"<deployed-url>","expiresAt":"<for netlify-drop, ISO 1h after now>","providerMeta":<full meta object>}'
```

This regenerates `STATUS.md` with a Deployments section listing this URL plus any prior deploys.

## Step 9 — Print final report

Print, in `workingLanguage`:

```
Prototype deployed.

Provider:    {provider}
URL:         {deployedUrl}
Feature:     {feature}
Framework:   {prototypeFramework}
Deployed at: {ISO timestamp}

{Provider-specific notes:}
  - Netlify Drop: Anonymous URL — claim within 1 hour at https://app.netlify.com/drop or it
    will be deleted. Draft site ID: {id}.
  - Surge.sh: URL is persistent. To redeploy, run /feature-mockup:deploy {feature} again
    OR `surge {uploadDir} {subdomain}.surge.sh` directly.
  - Cloudflare Pages: Persistent. To set a custom domain, run
    `wrangler pages project domain add {project-name} <yourdomain.com>`.
  - GitHub Pages: Persistent. To enable a custom domain, push a CNAME file to gh-pages branch
    and configure DNS.

Share this URL with stakeholders to demo the prototype.
History saved to .claude/feature-mockup.json deployHistory[].
```

Use `AskUserQuestion`:
> "Open the deployed URL in browser now?"

Options:
1. **Open now** — runs the same browser-launch logic as `/feature-mockup:preview` Step 3a (platform-specific `start`/`open`/`xdg-open` with the URL)
2. **Print URL only** — done

## Step 10 — Optional QR code for mobile preview

After URL printed, ask:
> "Show a QR code so stakeholders can open the URL on mobile?"

If yes, install `qrcode-terminal` if missing:
```bash
npx qrcode-terminal "{deployedUrl}"
```

The package is ~5KB and runs ad-hoc via npx — no global install needed.

## Edge cases

- **Build script missing** — `package.json` has no `build` script. Ask user for the right command, or fall back to deploying without build (assume already built).
- **Build artifact wrong path** — common in Angular when `outputPath` is custom. Read `angular.json` `projects.<name>.architect.build.options.outputPath`.
- **CLI hangs** (e.g. wrangler login waiting for browser callback in WSL). Print the URL it's waiting on and instruct user to open it manually.
- **Anonymous Netlify rate limit** — Netlify caps anonymous deploys per IP. Surface 429 errors and suggest claiming via account.
- **Cloudflare Pages name conflict** — project name already taken. Append a random suffix and retry.
- **GitHub Pages 404 after push** — Pages needs to be enabled in repo settings. Print: "Open `https://github.com/{username}/{repo}/settings/pages` and set Source to `gh-pages` branch."
- **CORS on prototype's external resource calls** — when prototype fetches a real API at runtime and the API doesn't allow the deployed origin, the deploy works but the demo breaks. Ask user pre-deploy if any fetch URLs need CORS allowlist updates.
- **Already-deployed feature** — check `deployHistory` for an existing entry with same feature+provider. Ask:
  > "This feature was last deployed to {url} on {date}. Update that deploy or create a new one?"
  Surge/Cloudflare/GitHub support update; Netlify Drop creates new draft each time.
- **Custom domain follow-up** — print provider-specific guide URL when user asks "how do I add my own domain?"
- **Framework requires server runtime** (Remix classic, Next with full SSR, Nuxt without `nuxt generate`) — surface in Step 2; refuse with clear message rather than emit a half-broken deploy.

## Done

End with:
1. Final URL prominently displayed (clickable in most terminals)
2. Provider-specific persistence note (anonymous expiry / claim instructions)
3. Suggested next command (e.g. `/feature-mockup:verify {feature}` to confirm deployed prototype matches reference)
