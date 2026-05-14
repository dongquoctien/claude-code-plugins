---
name: aad-switch
description: "Use this to flip mockMode in environment.*.ts between mock and real API for a feature (or globally). Refuses to touch environment.prod.ts without --force. Idempotent. Run after /aad-mock when the real backend is ready."
argument-hint: "<feature-kebab-name> --on|--off [--env local|dev|staging|prod]"
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion
---

# Angular Admin Design — Switch

Flip mock ↔ real for: **$ARGUMENTS**

## Step 1 — Load config

Find `.claude/angular-admin-design.json`. If missing, stop.

Extract: `projectRoot`, `workingLanguage`, `outputDir`, `mock.envFlagPath` (default `mockMode`).

**All user-facing output below in `workingLanguage`.**

## Step 2 — Parse arguments

`$ARGUMENTS`:
- First token: `<feature>` (kebab-case)
- `--on` OR `--off` (required, exactly one)
- `--env <name>` (optional, default `local`). Values: `local | dev | staging | prod | all` (`all` = local + dev + staging, never prod).

Validation:
- If both `--on` AND `--off` present, stop with error.
- If neither, ask `AskUserQuestion` "Switch to mock (--on) or real (--off)?".
- If `--env prod` specified without `--force`, refuse with the same protection message the script gives.

Compute `featureDir = {projectRoot}/{outputDir}/{feature}` — needed only for timeline logging.

## Step 3 — Resolve target env files

Map `--env`:

| --env | files touched |
|---|---|
| `local` (default) | `src/environments/environment.local.ts` |
| `dev` | `src/environments/environment.dev.ts` |
| `staging` | `src/environments/environment.staging.ts` |
| `prod` | `src/environments/environment.prod.ts`  (only with --force) |
| `all` | `environment.local.ts`, `environment.dev.ts`, `environment.staging.ts` |

For each target, verify it exists. Skip missing with a warning.

## Step 4 — Show before-state

For each target file, run:

```bash
node {pluginRoot}/scripts/mock-switch.mjs --file {abs-path} --check
```

Show a table:

```
Current state:
  environment.local.ts   →  mockMode: {true | false | missing}
  environment.dev.ts     →  mockMode: ...
  ...
```

## Step 5 — Confirm if anything will change

If any target's current value matches the requested value, it'll be a no-op for that file. If ALL files are already in the requested state, ask:

> "Everything is already in the requested state. Re-write anyway?"
> Options: "No, exit" / "Yes, re-write (no-op)"

Otherwise (some flips will happen) skip confirmation — the user already opted in by passing `--on`/`--off`.

## Step 6 — Apply

For each target:

```bash
node {pluginRoot}/scripts/mock-switch.mjs --file {abs-path} --value {true|false} {--force if prod}
```

Capture each line's JSON output. Build a result table:

```
Changes:
  environment.local.ts   →  mockMode: false → true   (updated)
  environment.dev.ts     →  mockMode: false (unchanged)
  ...
```

If the script returns `error`, stop and surface — do not continue with remaining files.

## Step 7 — Log to timeline

```bash
node {pluginRoot}/scripts/timeline.mjs append \
  --feature-dir "{featureDir}" \
  --kind {switch-on if --on, switch-off if --off} \
  --summary "Switched {feature}: env.{envList} mockMode → {true|false}" \
  --data '{"target":"{mock|real}","envFiles":[<list>],"changed":<list of files actually changed>}'
```

`target` mapping: `--on` → `mock`, `--off` → `real`.

## Step 8 — Final report

```
Switched {feature} to {mock|real} on {envList}.

{Result table from Step 6}

To run the dev server with this state:
  cd {projectRoot}
  {'npm run serve' if env=local else 'npm run start' or similar — leave the suggestion generic if env is not local}

To roll back:
  /angular-admin-design:aad-switch {feature} {--off if was --on else --on}
```

Done.

## Note on per-feature scope

The current implementation switches **all features at once** — `mockMode` is a single global flag in environment.ts. Per-feature switching would require a more elaborate scheme (Map<feature, boolean> in environment, or per-feature InjectionToken factory reading from a registry). This is intentionally out of scope for v0.1; if multiple features have mocks wired, they all flip together.

Surface this to the user the FIRST time they run `aad-switch` if multiple features have `mock-spec.json` files:

> "Note: {featureCount} features have mocks wired. They share one global mockMode flag, so this switch affects ALL of them. Per-feature switching is planned but not yet implemented."
