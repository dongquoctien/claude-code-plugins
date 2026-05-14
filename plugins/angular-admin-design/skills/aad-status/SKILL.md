---
name: aad-status
description: "Show what phase a feature is at (planned / generated / mocked / wired-real), what's pending, and the suggested next step. Pass a feature name for detail; omit for a list of all features tracked under outputDir."
argument-hint: "[<feature-kebab-name>]"
user-invocable: true
allowed-tools: Read, Glob, Bash
---

# Angular Admin Design — Status

Show resume-friendly status for: **$ARGUMENTS**

## Step 1 — Load config

Find `.claude/angular-admin-design.json`. If missing, stop with:
> "Not configured. Run `/angular-admin-design:aad-init` first."

Extract: `projectRoot`, `workingLanguage`, `outputDir`.

Bind `aadDir = {projectRoot}/{outputDir}` (e.g. `D:/Code/oh-admin/docs/aad`).

**All user-facing output below in `workingLanguage`.**

## Step 2 — Decide list vs detail mode

### Mode A — No argument: list all features

If `$ARGUMENTS` is empty:

1. Use `Glob` on `{aadDir}/*/.timeline.json` to enumerate every tracked feature.
2. If none found:
   ```
   No features tracked yet under {aadDir}.
   Start with: /angular-admin-design:aad-plan <feature> <spec.md or JIRA:KEY>
   ```
   Stop.
3. For each feature, run:
   ```bash
   node {pluginRoot}/scripts/timeline.mjs read --feature-dir "{aadDir}/{feature}"
   ```
   Capture `feature`, `currentPhase`, `lastActivityAt`, `totals.*`, and counts of pending open questions.
4. Print a table sorted by `lastActivityAt` descending:

```
Tracked features ({total}):

| Feature | Phase | Last activity | Open Q | Plan | Gen | Mock | Switch |
|---|---|---|---|---|---|---|---|
| ad-hardblock-allotment-history | mocked | 2 hr ago | 6 | 1 | 1 | 1 | 0 |
| ho-reservation-list-ota        | generated | 1 day ago | 2 | 1 | 1 | 0 | 0 |
| ...                           | ... | ... | ... | ... | ... | ... | ... |
```

Then print a one-line summary of where the user might want to focus:

```
Suggested next:
  • {feature with most pending blocking questions} — resolve open questions in plan.md
  • {oldest feature in 'generated' phase} — wire mocks via /aad-mock
```

Stop.

### Mode B — Argument: detail for one feature

If `$ARGUMENTS` is set, bind `feature = <first token>`. Compute `featureDir = {aadDir}/{feature}`.

If `featureDir` doesn't exist OR `featureDir/.timeline.json` is missing:
```
Feature '{feature}' is not tracked. Did you mean:
  • <closest match 1>
  • <closest match 2>
Or start it: /angular-admin-design:aad-plan {feature} <spec>
```
Stop.

## Step 3 — Detail mode: emit + read STATUS.md

The timeline script already maintains a human-readable `STATUS.md`. Refresh it first, then read and print:

```bash
node {pluginRoot}/scripts/timeline.mjs regenerate-status --feature-dir "{featureDir}"
```

Then `Read {featureDir}/STATUS.md` and print its contents verbatim to the user.

## Step 4 — Add file inventory (detail mode only)

After STATUS.md, list the artifacts present:

```
Artifacts at {featureDir}:
  ✓ plan.md / plan.json                — present
  ✓ reuse-map.md / reuse-map.json      — present
  {✓|⊘} mock-spec.json                 — {present|missing}
  ✓ STATUS.md                          — auto-generated
  ✓ .timeline.json                     — auto-generated
```

Also, check whether the feature was scaffolded into the real source tree. Read `profile.routesPath` from config and `Glob` `{projectRoot}/{routesPath}/**/{feature}/<feature>.module.ts`. Print:

```
Source code:
  {✓|⊘} {routesPath}/{feature}/<feature>.module.ts   — {generated|not generated yet}
```

## Step 5 — Done

No timeline append — `aad-status` is read-only and idempotent.
