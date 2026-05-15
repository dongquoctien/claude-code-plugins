# angular-admin-design

> Spec-driven Angular admin generator. Read `spec.md` (or a Jira task with prototype URL) → audit existing code + propose reuse-map → scaffold NgRx feature modules with Kendo + i18n + a mock service that can switch to the real API with one flag.

**Production-ready** as of v1.0.0. Tested end-to-end against Angular 9 + Kendo 4.7 + NgRx 9 codebases (oh-admin, ohmyhotel-partners).

## Why

You give devs a `spec.md` plus business rules. They paste it into Claude with five different prompts and get five different module layouts — none matching your project's NgRx + Kendo + `shared/modules` conventions. By the time backend is ready, the mock layer is hard-coded everywhere.

This plugin closes that gap by **anchoring every step to your real codebase**:

- Crawls `src/app/shared/modules` once → knows which components already exist so AI stops re-inventing them.
- Reads `claude-context/*.md` → applies your project's coding standards (interface `I`-prefix, observable `$`-suffix, kebab folders, domain prefixes) automatically.
- **Inspects prototypes** (URL or local .tsx/.html) via Playwright/Chrome DevTools MCP to capture UI signal the spec.md misses.
- **Contract-validation gate** before every file write — refuses code that references nonexistent methods or missing deps.
- Generates each file in **Hybrid mode** — preview + write/skip/edit confirmation, so AI can't go off-rails silently.
- Mocks default-first via `InjectionToken` swap, real API via one flag.
- **Verify step** runs `tsc --noEmit` after generation to catch issues before they hit your editor.

## Install

```bash
/plugin marketplace add dongquoctien/claude-code-plugins
/plugin install angular-admin-design@dongquoctien-claude-plugins
```

## Full pipeline tutorial

### One-time per Angular project

```bash
cd <angular-project-root>

# 1. Detect project profile (Angular version, NgRx layout, paths, domain prefixes, i18n flow)
/angular-admin-design:aad-init

# 2. Build catalog: crawl shared/modules + routes + I-interfaces + core services + deps
/angular-admin-design:aad-index
```

Re-run `/aad-index` when shared/modules or routes/ change meaningfully.

### Plan a feature

```bash
# From local spec.md
/angular-admin-design:aad-plan booking-cancel ./specs/booking-cancel.md

# From Jira task (Atlassian MCP must be configured)
/angular-admin-design:aad-plan booking-cancel JIRA:ELS-1234
```

What happens (under the hood):

1. **Resolve spec source** — local file OR fetch Jira description + attachments
2. **Detect prototype** — scans spec for github.io / netlify / codesandbox URLs and local .tsx/.html files
3. **Inspect prototype** (if confirmed) — via Playwright or Chrome DevTools MCP:
   - Initial snapshot + screenshot
   - **Auto-walk** through tabs/modals/accordions (max 5)
   - **Multi-route detection** — if prototype has hash routes, walk each
   - **Network capture** — save XHR/fetch response bodies for /aad-mock later
   - **Source parse** (if .tsx/.jsx) — extract event handlers, useState shapes, fetch URLs
   - **Text + color extraction** — auto-suggest i18n keys, flag color drift
4. **Classifier** — compare every detected UI element vs `catalog.shared`, output deviations with severity (critical/warning/info). User resolves critical via AskUserQuestion.
5. **spec-analyzer** — synthesize plan.json from spec + claude-context + snapshots + source + deviations
6. **reuse-mapper** — for each UI requirement, decide: reuse-existing / use-kendo / create-feature-component / needs-new-shared

Output:
- `docs/aad/<feature>/plan.md` — human-readable plan (AC, BR, screens/sections, state, endpoints)
- `docs/aad/<feature>/plan.json` — structured (consumed by /aad-generate)
- `docs/aad/<feature>/reuse-map.md` + `.json` — per UI element decision
- `.claude/aad/<feature>/STATUS.md` + `.timeline.json` — phase tracker

### Generate code

```bash
/angular-admin-design:aad-generate booking-cancel
```

Hybrid mode (default): per-file preview + write/skip/edit confirmation. Add `--batch` to auto-write.

**Contract validation runs before every Write**:
- Rejects `import { saveAs } from 'file-saver'` when not installed
- Rejects `this._errorService.handleError(...)` when ErrorHandlerService doesn't have that method
- Rejects `[pageable]="{...}"` when catalog says `pageable: boolean`
- Auto-fixes common bug patterns; asks user when ambiguous

**Section splitting**: when a screen.section has >3 fields, generates a separate presentational component (matches bs-event convention).

### Verify TypeScript compiles

```bash
/angular-admin-design:aad-verify booking-cancel
```

Runs `tsc --noEmit -p tsconfig.app.json` filtered to generated feature files. Surfaces TS errors with auto-fix suggestions (use-catalog-method, check-deps, fix-binding-type).

### Mock data (backend not ready)

```bash
/angular-admin-design:aad-mock booking-cancel
```

Generates:
- `<feature>-api.service.interface.ts` — service contract
- `<feature>-api.token.ts` — InjectionToken
- `<feature>-api-mock.service.ts` — mock implementation reading from JSON fixtures
- Edits feature.module providers + effects @Inject

Fixture priority:
1. **Captured** — files in `mocks/<feature>/<endpoint-id>.json`
2. **Prototype-captured** (v0.7.1+) — XHR responses saved during /aad-plan prototype walk
3. **Synthetic** — AI-synthesized from response interfaces, marked `_synthetic: true`

Sets `environment.local.ts mockMode=true` so `npm run serve` picks up mocks immediately.

### Switch to real API when ready

```bash
/angular-admin-design:aad-switch booking-cancel --off
```

Flips `environment.local.ts mockMode=false`. Refuses to touch `environment.prod.ts` without `--force`.

### Resume work later

```bash
/angular-admin-design:aad-status booking-cancel    # detail for one feature
/angular-admin-design:aad-status                   # list all tracked features
```

## Skills

| Skill | Purpose | Since |
|---|---|---|
| `/angular-admin-design:aad-init` | Detect project profile → write `.claude/angular-admin-design.json` | v0.1.0 |
| `/angular-admin-design:aad-index` | Crawl shared/modules + routes/ + core services + models + deps → `component-catalog.json` | v0.1.0, v0.2.0 enhanced |
| `/angular-admin-design:aad-plan` | spec.md or Jira → plan.md + reuse-map.md + STATUS.md, with prototype inspection | v0.1.0, v0.5–v1.0 enhanced |
| `/angular-admin-design:aad-generate` | Scaffold NgRx feature module with contract validation | v0.1.0, v0.3.0 validator gate |
| `/angular-admin-design:aad-verify` | Run `tsc --noEmit`, classify errors, suggest auto-fixes | v0.4.0 |
| `/angular-admin-design:aad-mock` | Wire MockXxxService + InjectionToken + fixtures | v0.1.0, v0.7.1 prototype-captured |
| `/angular-admin-design:aad-switch` | Flip `environment.mockMode` | v0.1.0 |
| `/angular-admin-design:aad-status` | Show phase + suggested next step | v0.1.0 |

## Architecture

```
spec.md / Jira ─┐
                ├─► detect-prototype ─► Playwright/Chrome MCP ─► snapshot + walk + network capture
prototype URL ──┘                                                    │
                                                                     ▼
                                                            prototype-classifier
                                                                     │
spec-analyzer ◄──────── plan.json ◄─────────────── (deviations.json)
   │                                                                 ▲
   ▼                                                                 │
plan.json ──► reuse-mapper ──► reuse-map.json ──┐                    │
                                                ▼                    │
                              code-generator ──► routes/<feature>/*.ts
                                                ▼                    
                              mock-generator ──► MockXxxService + fixtures
                                                ▼
                              aad-verify ──► tsc --noEmit ──► auto-fix
                                                ▼
                              aad-switch ──► environment.mockMode flip
```

The plugin's core insight: **planning runs once, deterministically**. Once `plan.json` + `reuse-map.json` exist, every subsequent step reads from them — so re-running with different prompts produces the same output. No more "five prompts → five module layouts."

### Validation gates

Before file write — `agents/contract-validator.md`:
- Import resolves to installed package
- Service method exists on the referenced class (catalog.coreServices)
- Template binding type matches @Input declared type (catalog.shared.inputs)
- Naming conventions (api-path.models.ts plural, selectModuleState, etc.)

After file write — `skills/aad-verify`:
- `tsc --noEmit -p tsconfig.app.json`
- Classify each error → suggest auto-fix or escalate to user

## State layout

Plan artifacts (committed):

```
docs/aad/<feature>/
├── plan.md
├── plan.json
├── reuse-map.md
├── reuse-map.json
├── deviations.json        (v0.6.0+ — UI deviation findings)
├── mock-spec.json
├── i18n-keys.md
├── .spec/
│   ├── jira-<key>/        (when source=jira)
│   │   ├── bundle.md
│   │   └── attachments/
│   ├── prototype-snapshots/   (v0.5.0+ — Chrome MCP / Playwright captures)
│   ├── prototype-network/     (v0.7.1+ — XHR/fetch response bodies)
│   ├── prototype-source-<i>.json (v0.8.0+ — TSX parse findings)
│   └── prototype-text-<i>.json  (v1.0.0+ — text + color hints)
```

State (gitignored — add `.claude/aad/` to `.gitignore`):

```
.claude/aad/<feature>/
├── STATUS.md          (auto-regenerated on every skill run)
└── .timeline.json     (append-only event log)
```

## Reference docs

Inside this plugin:
- `docs/workflow.md` — full pipeline lifecycle
- `docs/reuse-map-spec.md` — how reuse decisions are made
- `docs/mock-switch-spec.md` — InjectionToken pattern + filter helpers
- `knowledge/angular-9-conventions.md` — naming, class structure, imports
- `knowledge/ngrx-feature-store.md` — mandatory two-level featureKey layout
- `knowledge/kendo-grid-patterns.md` — `app-grid-basis` usage
- `knowledge/shared-modules-catalog.md` — lookup protocol (don't hardcode)
- `knowledge/i18n-flow.md` — scan-download (partners) vs json-inline vs none
- `knowledge/module-prefix-map.md` — domain prefixes (fl/ho/av/bs/...)
- `knowledge/mock-switch-pattern.md` — InjectionToken + env flag pattern
- `knowledge/prototype-inspection.md` — what to extract, deviation severity
- `knowledge/mcp-browser-tools.md` — Playwright vs Chrome DevTools per task
- `knowledge/prototype-source-parsing.md` — TSX/JSX/HTML static parse
- `CHANGELOG.md` — version history v0.1.0 → v1.0.0

## Status

All planned phases shipped (v0.1.0 → v1.0.0):

| Phase | Versions | What it does |
|---|---|---|
| P1 Foundation | v0.1.0 | aad-init + aad-index — catalog source-of-truth |
| P2 Plan/reuse | v0.1.0 | spec.md / Jira → plan + reuse-map |
| P3 Codegen | v0.1.0, v0.3.0 | NgRx feature module + Hybrid validator gate |
| P4 Mock/switch | v0.1.0 | MockXxxService + InjectionToken |
| P5 Verify + state | v0.4.0 | aad-verify (tsc), state relocation |
| P6 Prototype detect | v0.5.0 | Detect URLs/files in spec, Chrome MCP snapshot |
| P6 Auto-walk + classifier | v0.6.0 | Click through interactive UI, classify vs catalog |
| P6 Multi-screen | v0.7.0 | Detect sibling routes, walk each as separate screen |
| P6 Multi-MCP | v0.7.1 | Playwright + Chrome DevTools side-by-side |
| P6 Source parse | v0.8.0 | TSX/JSX/HTML static parse for handlers + state + endpoints |
| P6 Text/color | v1.0.0 | Auto-suggest i18n keys, flag design-token drift |

See [CHANGELOG.md](./CHANGELOG.md) for detailed release notes.

## Test coverage

See [docs/test-coverage.md](./docs/test-coverage.md) for the per-feature status (verified end-to-end vs deferred to manual smoke test).

## License

MIT
