# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

This is a **Claude Code plugin marketplace** — not an application. The repo ships installable plugins that other Claude Code users add via `/plugin marketplace add dongquoctien/claude-code-plugins`. Today there are two plugins:

- **`feature-mockup`** — BA-facing prototype generator (spec/screenshots → runnable HTML/React mockup).
- **`angular-admin-design`** — Dev-facing Angular admin codegen (spec.md/Jira → NgRx feature module + mock-first wiring).

The marketplace manifest at `.claude-plugin/marketplace.json` is the source of truth for what's published; bumping a plugin means bumping its version there AND in its own `plugin.json`.

## Layout

```
.claude-plugin/marketplace.json   # what the marketplace publishes
plugins/<plugin-name>/
  .claude-plugin/plugin.json      # per-plugin manifest
  skills/<skill-name>/SKILL.md    # user-invocable slash commands
  agents/<agent-name>.md          # subagents (Task-tool invocable)
  scripts/*.mjs                   # Node ESM helpers the skills shell out to
  knowledge/<framework>.md        # per-framework guidance read at generation time
  templates/<template-name>/      # starter prototype templates copied into output
  schemas/*.json                  # JSON Schemas published via raw.githubusercontent for $schema refs
  docs/*.md                       # cross-skill specs (timeline, fe-export contract, etc.)
```

When adding a new plugin: create `plugins/<name>/.claude-plugin/plugin.json` AND register it in `.claude-plugin/marketplace.json` — both files must agree on the version, or installs break.

## angular-admin-design architecture

A dev-facing **spec-driven codegen pipeline** for Angular admin features. v1.0.0 production-ready, 8 skills, supports prototype inspection via Playwright/Chrome DevTools MCP.

```
spec.md/Jira (+ prototype URL) ──► aad-plan ──► plan.json + reuse-map.json + STATUS.md
                                          │
                                     aad-generate ──► routes/<feature>/*.ts (NgRx)
                                          │
                                     aad-verify ──► tsc --noEmit + auto-fix
                                          │
                                     aad-mock ──► MockXxxService behind InjectionToken
                                          │
                                     aad-switch ──► environment.mockMode flip
```

The plugin's core insight: **planning runs once, deterministically**. Once `plan.json` + `reuse-map.json` exist, codegen has no creative freedom about which shared modules to import. Re-runs produce the same output. Solves "five prompts → five layouts".

### Skill orchestration

| Skill | Agent(s) | Reads / writes |
|---|---|---|
| `aad-init` | — | `.claude/angular-admin-design.json` (profile detection) |
| `aad-index` | `source-indexer` | `.claude/angular-admin-design/component-catalog.json` (v2 — adds coreServices, dependencies, precise input types via TS Compiler API) + `reference-features.json` (v0.2.0 — verbatim source of 3 anchor features) |
| `aad-plan` | `spec-analyzer` → `reuse-mapper` (+ optional `prototype-classifier`) | Reads spec local OR Jira via `mcp-atlassian`. Multi-step: resolve spec → detect prototype → inspect via Playwright/Chrome DevTools → walk → classify → plan/reuse-map. Writes `{outputDir}/{feature}/{plan,reuse-map}.{md,json}` + state to `{stateDir}/{feature}/` |
| `aad-generate` | `code-generator` | Hybrid per-file confirm. Contract-validation gate before every Write. Section splitting when >3 fields. Routes/<feature>/ mandatory NgRx layout |
| `aad-verify` | `error-fixer` (inline) | Runs `tsc --noEmit -p tsconfig.app.json`, classifies errors, suggests auto-fixes. Optional `--build-check` runs `ng build` |
| `aad-mock` | `mock-generator` | Service interface + InjectionToken + Mock class + fixtures (priority: captured > prototype-captured > synthetic). Edits providers + effects @Inject. Adds `mockMode` to all env files |
| `aad-switch` | (inline) | `mock-switch.mjs` edits `environment.*.ts` `mockMode` field — refuses prod without `--force` |
| `aad-status` | — | Read-only wrapper over `timeline.mjs` |

### Key invariants (load-bearing, don't drift)

- **NgRx mandatory** — every generated feature has `actions/ reducers/ effects/ services/ components/ containers/ models/`. `StoreModule.forFeature` + `EffectsModule.forFeature` always wired.
- **Two-level featureKey** — outer `<feature>` (module slice), inner `<feature>List` / `Form` / `Detail` (sub-reducer). `reducers/index.ts` wrapper non-negotiable.
- **Project's `claude-context/*.md` is input** — spec-analyzer reads `business-rules.md` + `integration-flow.md` so generated plan honors project conventions (succeedYn envelope, role guards, etc.) without dev re-stating them.
- **Catalog is source of truth for reuse** — generated code must consult `catalog.shared[*].inputs` for binding types; contract-validator catches mismatches. v0.2.0 lesson: knowledge files are reference, NOT prescriptive (don't list components by name — point at catalog).
- **`environment.prod.ts` is protected** — `mock-switch.mjs` refuses to write unless `--force`.
- **Knowledge files are Angular 9 + Kendo 4.7 specific.** No standalone components, no `inject()` function, no Signals — wrong defaults for target codebases.
- **State / plan split (v0.4.0)** — plan artifacts in `docs/aad/<feature>/` (committed), state (.timeline.json + STATUS.md) in `.claude/aad/<feature>/` (gitignored).

### Per-feature state contract

Every skill that mutates feature state appends to `.timeline.json` via `scripts/timeline.mjs`. Phase derivation: `planned → generated → verified → mocked → wired-real`. Open questions tracked in `pending.openQuestions[]`, resolved by event ID. See `plugins/angular-admin-design/docs/workflow.md`.

### Prototype inspection (v0.5.0 → v1.0.0)

When spec references a prototype URL or local file, `/aad-plan` Step 5.5-5.6 detects + offers to inspect:

- **detect-prototype.mjs** scans Jira description / spec text / Jira attachments for URLs (github.io / netlify / surge / vercel / glitch / codesandbox / stackblitz) and local HTML/TSX paths with confidence scoring.
- **detect-prototype-routes.mjs** (v0.7.0) finds sibling routes for multi-screen prototypes.
- **walk-prototype.mjs** (v0.6.0) finds clickable candidates (tabs, modal triggers, accordions).
- **MCP backend dispatch** (v0.7.1) — Playwright preferred for snapshot/walk; Chrome DevTools or Playwright for network capture. Detects available at runtime, graceful fallback.
- **parse-prototype-source.mjs** (v0.8.0) — static TSX/JSX parse via TypeScript Compiler API for event handlers + useState + fetch URLs that browser DOM misses.
- **extract-prototype-text.mjs** (v1.0.0) — text + color hints → auto-suggest i18n keys + flag design-token drift.
- **prototype-classifier agent** (v0.6.0) — compares every UI element vs catalog, outputs `deviations.json` with severity. User resolves critical via AskUserQuestion.

### Lessons from v0.1.0 → v1.0.0 (for future contributors)

1. **First version's knowledge was wrong**. v0.1.0 generated code with `_errorService.handleError()` (method invented), `import 'file-saver'` (not installed), `[pageable]="{object}"` (type is boolean). Fix: catalog crawl REAL services + reference features verbatim (v0.2.0).
2. **Validator gate prevents most bugs**. v0.3.0 contract-validator caught all 8 v0.1.0 build-blockers via 9 rules. Adding new rules is the right place to extend.
3. **MCP file path constraint** — Chrome DevTools + Playwright both reject paths outside workspace roots. Save to system temp first, then `Bash cp`.
4. **Snapshot output format differs**: Chrome DevTools `take_snapshot` → `.txt`, Playwright `browser_snapshot` → `.md`. spec-analyzer reads both.
5. **SPA prototypes need walking** — single snapshot of a feature URL often only shows the list view; the actual drawer/modal needs `click` then re-snapshot.
6. **Static demo prototypes are common** — make 0 API calls (mock data inline). `/aad-mock` falls back to synthetic.
7. **TypeScript Compiler API borrowed from project node_modules** — pattern used by crawl-shared-modules + parse-prototype-source. Always check `node_modules/typescript` first, fall back to regex.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Generated code has TS errors after `/aad-generate` | Knowledge files have wrong assumption OR catalog stale | Re-run `/aad-index`, run `/aad-verify` to surface specific errors with auto-fix |
| Mock data shows same rows on every page | Mock service uses synthetic data without `_filterAndPage` | Re-run `/aad-mock`, check `mock-spec.json` for filter helper inclusion |
| Prototype inspection skipped | MCP not connected OR file unreachable | See `plan.stats.warnings[]` for diagnostic; manually provide path |
| Plan proposes weird shared component | Catalog parser missed an input type | Check `catalog.shared[*].inputs` for the component; verify TS Compiler API installed in target project |
| `environment.mockMode` cast `as any` in generated code | aad-mock Step 9 didn't run on all env files | Re-run `/aad-mock` (idempotent on env files) |
| Plan output too noisy with sidebar nav | Text extractor includes banner/sidebar | Review plan.i18n.keys[] manually, prune; or limit prototype walk scope |

## feature-mockup architecture

A BA-facing prototype generator. The mental model is a **pipeline of skills that share a per-feature state directory** (`{outputDir}/{feature}/`). Each skill is one slash command; some delegate heavy work to a subagent via the Task tool.

### Skill orchestration

| Skill | Delegates to agent | Reads / writes |
|---|---|---|
| `fm-init` | — | writes `.claude/feature-mockup.json` |
| `fm-make` | `input-analyzer` then `prototype-builder` | reads inputs, writes `{featureDir}/brief.json` + prototype files |
| `fm-extract-design` (dev-side) | `design-extractor` | runs `scripts/detect-stack.mjs` + `crawl-*.mjs`, writes `fe-design-export.zip` |
| `fm-ingest-theme` | `theme-extractor` | reads dev's zip, writes `.claude/feature-mockup/theme/` |
| `fm-preview`, `fm-verify`, `fm-fix`, `fm-deploy`, `fm-status` | (mostly inline; verify/fix may call Task) | read/write `{featureDir}/STATUS.md` + `.timeline.json` |

Skill files are markdown with YAML frontmatter (`name`, `description`, `argument-hint`, `user-invocable`, `allowed-tools`). The skill body **is** the prompt Claude executes — when editing, keep step numbering and explicit "stop with this message" instructions; they're load-bearing.

### Per-feature state — the timeline contract

Every skill that mutates a feature folder MUST end by appending to that feature's timeline via `scripts/timeline.mjs`:

```bash
node {pluginRoot}/scripts/timeline.mjs append \
  --feature-dir "{featureDir}" --kind <make|preview|verify|fix|deploy|theme-import|init> \
  --summary "<one line>" --data '<json>'
```

This script is the **only** writer for `.timeline.json` and `STATUS.md` — never hand-edit those files from a skill. The full event/phase/gap-lifecycle contract is in `plugins/feature-mockup/docs/timeline-spec.md`. Verify uses `sync-gaps`, fix uses `resolve-gaps`, the rest use `append`.

### Two theme branches in fm-make

`fm-make` picks a branch from config:
- `theme.imported === true` AND `{theme.path}/tokens.json` exists → **real-system** branch (use imported tokens + cloned components).
- otherwise → **default** branch (Tailwind CDN + auto-picked accent).

When the user reports "the prototype doesn't look like our app," the answer is almost always: theme wasn't imported, or it was imported before a recent design-system bump. Re-run `fm-extract-design` (dev) → `fm-ingest-theme` (BA).

### Stack-aware generation

`prototype-builder` reads `knowledge/<framework>.md` matching the detected stack before generating code. Adding support for a new framework means: (1) extend detection in `scripts/detect-stack.mjs`, (2) add `knowledge/<framework>.md`, (3) update the table in `agents/prototype-builder.md`.

### Working language

Config has `workingLanguage` ∈ `{en, ko, vi}`. **Every user-facing string a skill prints must be in that language**, but technical identifiers (kebab IDs, component names, file paths) stay English. Skill prompts say this explicitly — preserve it when editing.

## Conventions

- **Scripts are Node ESM** (`.mjs`, `import` syntax). Run with `node scripts/<name>.mjs --flag value`. They parse args via `process.argv.indexOf(name)` — there is no argparse helper, follow the existing pattern.
- **Skill names use `fm-` prefix** (palette discoverability). See commit `7e36356` for the rename history; don't reintroduce non-prefixed names.
- **No emojis in generated prototype output** — the README lists this as a Phase-1 invariant and `fm-fix` enforces it via theme guardrails.
- **JSON Schema `$id`s point at `raw.githubusercontent.com/.../main/...`** — when adding a new schema, follow the same URL shape so the `$schema` reference resolves for end users.
- Plugins live under `plugins/<name>/`; **never put plugin files at the repo root**. The marketplace expects this layout.

## Common operations

- Test a script locally: `node plugins/feature-mockup/scripts/detect-stack.mjs --in <some-project-path>`
- Hand-test a skill end-to-end: install the marketplace locally with `/plugin marketplace add D:\Github\claude-code-plugins`, then invoke the skill in a scratch project (config goes in that scratch project's `.claude/`, not this repo's).
- Inspect a feature's recorded state: `node plugins/feature-mockup/scripts/timeline.mjs read --feature-dir <path-to-feature-dir>`
- Regenerate STATUS.md without appending an event: same script with `regenerate-status`.

There is no build, lint, or test command at the repo level — this is a content/manifest repo. CI doesn't run; correctness of skills is validated by hand-running them.
