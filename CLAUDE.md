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

A dev-facing **spec-driven codegen pipeline** for Angular admin features. Four-stage pipeline anchored by a single planning step:

```
spec.md/Jira  →  aad-plan       →  plan.json + reuse-map.json + open-questions
                                       │
                 aad-generate    →  routes/<feature>/*.ts  (NgRx feature module)
                                       │
                 aad-mock        →  MockXxxService + fixtures behind InjectionToken
                                       │
                 aad-switch      →  environment.mockMode flip (real ↔ mock)
```

The plugin's core insight: **planning runs once, deterministically**. Once `plan.json` + `reuse-map.json` exist for a feature, codegen has no creative freedom about which shared modules to import, mock-gen has no freedom about which endpoints exist. Re-runs produce the same output regardless of phrasing — solves the "five prompts → five layouts" pain.

### Skill orchestration

| Skill | Agent | Reads / writes |
|---|---|---|
| `aad-init` | — | `.claude/angular-admin-design.json` (detect Angular/Kendo/NgRx versions, paths, domain prefixes, i18n flow) |
| `aad-index` | `source-indexer` | `.claude/angular-admin-design/component-catalog.json` (crawl shared/modules + routes/ + I-interfaces + Kendo) |
| `aad-plan` | `spec-analyzer` then `reuse-mapper` | reads spec local OR via `mcp-atlassian` Jira; writes `{outputDir}/{feature}/{plan,reuse-map}.{md,json}` + timeline |
| `aad-generate` | `code-generator` | Hybrid per-file confirm. Writes to `routes/<feature>/` mandatory NgRx layout |
| `aad-mock` | `mock-generator` | Service interface + InjectionToken + Mock class + fixtures (captured or AI-synthetic with `_synthetic: true` flag); edits module providers + effects @Inject |
| `aad-switch` | (inline) | `mock-switch.mjs` edits `environment.*.ts` `mockMode` field — refuses prod without `--force` |
| `aad-status` | — | Read-only wrapper over `timeline.mjs` |

### Key invariants

- **NgRx is mandatory** — every generated feature has `actions/ reducers/ effects/ services/ components/ containers/ models/` per `knowledge/ngrx-feature-store.md`. `StoreModule.forFeature` and `EffectsModule.forFeature` are always wired.
- **Project's `claude-context/*.md` is input** — `spec-analyzer` reads `business-rules.md` and `integration-flow.md` so the generated plan honors project rules (status codes, succeedYn envelope, role guards) without dev re-stating them.
- **Two-level featureKey** — outer `<feature>` for module slice, inner `<feature>List`/`Form`/`Detail` for sub-reducer. The `reducers/index.ts` wrapper pattern is non-negotiable; flatten and `bs-event`-style code breaks.
- **`environment.prod.ts` is protected** — `mock-switch.mjs` refuses to write to it unless `--force` is passed.
- **Knowledge files in `knowledge/` are Angular 9 + Kendo 4.7 specific.** No standalone components, no `inject()` function, no Signals — these are the wrong defaults for the target codebases.

### Per-feature state — timeline contract

Same pattern as feature-mockup: every skill that mutates a feature's state ends by appending to `{featureDir}/.timeline.json` via `scripts/timeline.mjs`. Phase derivation: `planned → generated → mocked → wired-real`. Open questions from the plan are tracked in `pending.openQuestions[]` and individual questions are resolved by event ID. See `plugins/angular-admin-design/docs/workflow.md` for full lifecycle.

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
