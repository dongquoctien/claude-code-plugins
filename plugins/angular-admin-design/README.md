# angular-admin-design

> Spec-driven Angular admin generator. Read `spec.md` (or a Jira task) → produce a reuse-map of existing shared modules vs new components → scaffold NgRx feature modules with Kendo + i18n + a mock service that can switch to the real API with one flag.

## Why

You give devs a `spec.md` plus business rules. They paste it into Claude with five different prompts and get five different module layouts — none matching your project's NgRx + Kendo + `shared/modules` conventions. By the time backend is ready, the mock layer is hard-coded everywhere.

This plugin closes that gap by **anchoring every step to your real codebase**:

- Crawls `src/app/shared/modules` once → knows which components already exist so AI stops re-inventing them.
- Reads `claude-context/*.md` → applies your project's coding standards (interface `I`-prefix, observable `$`-suffix, kebab folders, domain prefixes) automatically.
- Generates each file in **Hybrid mode** — preview + write/skip/edit confirmation, so AI can't go off-rails silently.
- Mocks default-first via `InjectionToken` swap, real API via one flag.

## Install

```bash
/plugin marketplace add dongquoctien/claude-code-plugins
/plugin install angular-admin-design@dongquoctien-claude-plugins
```

## Quick start

```bash
# 1. One-time per Angular project — detect profile, write config
cd <angular-project-root>
/angular-admin-design:aad-init

# 2. One-time (re-run when shared/modules or routes/ change) — build catalog
/angular-admin-design:aad-index

# 3. Plan a feature from a local spec
/angular-admin-design:aad-plan booking-cancel ./specs/booking-cancel.md

#    ...or from a Jira task
/angular-admin-design:aad-plan booking-cancel JIRA:OHM-1234

# 4. Generate the feature module (Hybrid: per-file confirm)
/angular-admin-design:aad-generate booking-cancel

# 5. Wire mock data while backend is still in progress
/angular-admin-design:aad-mock booking-cancel

# 6. When the real API is ready
/angular-admin-design:aad-switch booking-cancel --off

# Anytime — see where you are
/angular-admin-design:aad-status booking-cancel
/angular-admin-design:aad-status                 # list all tracked features
```

## Skills

| Skill | Purpose |
|---|---|
| `/angular-admin-design:aad-init` | Detect project profile (NgRx layout, paths, domain prefixes, i18n flow) → write `.claude/angular-admin-design.json` |
| `/angular-admin-design:aad-index` | Crawl `shared/modules` + `routes/` + models → produce `component-catalog.json` |
| `/angular-admin-design:aad-plan` | Read spec.md or Jira task → write `plan.md` + `reuse-map.md` + `open-questions.md` |
| `/angular-admin-design:aad-generate` | Scaffold NgRx feature module from plan (Hybrid: per-file confirm) |
| `/angular-admin-design:aad-mock` | Generate `MockXxxService` + fixtures, wire via `InjectionToken` |
| `/angular-admin-design:aad-switch` | Flip `environment.mockMode` between mock and real API |
| `/angular-admin-design:aad-status` | Show what's planned / generated / mocked / wired-to-real |

## Architecture

```
spec.md / Jira ──► spec-analyzer ──► plan.json
                                        │
catalog.json ─────────► reuse-mapper ──► reuse-map.json ──► code-generator ──► routes/<feature>/*.ts
                                                                                    │
                                                              mock-generator ──► MockXxxService + fixtures
                                                                                    │
                                                              mock-switch ──► environment.mockMode flip
```

The plugin's core insight: **planning runs once, deterministically**. Once `plan.json` + `reuse-map.json` exist, every subsequent step (codegen, mock, switch) reads from them — so re-running with different prompts produces the same output. No more "five prompts → five module layouts."

See `docs/workflow.md` for the full flow, `docs/reuse-map-spec.md` for how the reuse decision is made, and `docs/mock-switch-spec.md` for the InjectionToken pattern.

## Status

All 5 phases shipped in v0.1.0:

| Phase | Skills | What it does |
|---|---|---|
| P1 | `aad-init`, `aad-index` | Detect profile + crawl shared/modules + routes/ + models → catalog.json |
| P2 | `aad-plan` | spec.md / Jira → plan.json + reuse-map.json + open-questions |
| P3 | `aad-generate` | plan → NgRx feature module (Hybrid per-file confirm or `--batch`) |
| P4 | `aad-mock`, `aad-switch` | MockXxxService + fixtures behind InjectionToken; flip mockMode |
| P5 | `aad-status` + docs | Resume-friendly STATUS.md per feature |

Tested end-to-end against Angular 9 + Kendo 4.7 + NgRx 9 (oh-admin, ohmyhotel-partners).

## License

MIT
