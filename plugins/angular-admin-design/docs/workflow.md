# Workflow — angular-admin-design

End-to-end flow for one feature, from a fresh spec.md to a runnable UI wired against either mock fixtures or the real backend.

## One-time setup (per Angular project)

```bash
# 1. Configure: detect Angular version, NgRx layout, Kendo, paths, domain prefixes, i18n flow
cd <angular-project-root>
/angular-admin-design:aad-init

# 2. Build the component catalog — crawls shared/modules + routes + models
/angular-admin-design:aad-index
```

After (2), `.claude/angular-admin-design/component-catalog.json` exists. This is the single source of truth used by `aad-plan` and `aad-generate` to decide reuse-vs-new.

Re-run `aad-index` whenever:
- New modules are added under `shared/modules/`
- New features land under `routes/`
- The Angular or Kendo version bumps

## Per-feature flow

```
spec.md or Jira task
        │
        ▼
/aad-plan <feature> <source>          ─►  plan.md + plan.json
                                          reuse-map.md + reuse-map.json
                                          (open-questions surfaced)
        │
        ▼  user reviews & answers blocking questions
        │
/aad-generate <feature>               ─►  routes/<feature>/ scaffolded
                                          (NgRx feature store + container + module)
        │
        ▼
/aad-mock <feature>                   ─►  MockXxxService + fixtures
                                          environment.local.ts: mockMode=true
                                          providers[] + effects rewired via InjectionToken
        │
        ▼  dev runs `npm run serve` → UI works end-to-end against fixtures
        │
        ▼  backend ships
        │
/aad-switch <feature> --off           ─►  environment.local.ts: mockMode=false
                                          UI now hits real API, no code change
```

At any time:

```bash
/angular-admin-design:aad-status                # list all tracked features
/angular-admin-design:aad-status <feature>      # detail for one
```

## Phases tracked per feature

`STATUS.md` and `.timeline.json` are auto-maintained per feature folder under `docs/aad/<feature>/`. Phases:

| Phase | Reached when | Next |
|---|---|---|
| `planned` | After `/aad-plan` | `/aad-generate` |
| `generated` | After `/aad-generate` | `/aad-mock` |
| `mocked` | After `/aad-mock` | `/aad-switch --off` when backend ready |
| `wired-real` | After `/aad-switch --off` | (terminal — reversible by `--on`) |

## What each skill writes

| Skill | Touches |
|---|---|
| `aad-init` | `.claude/angular-admin-design.json` |
| `aad-index` | `.claude/angular-admin-design/component-catalog.json` |
| `aad-plan` | `docs/aad/<feature>/plan.json`, `plan.md`, `reuse-map.json`, `reuse-map.md`, `.timeline.json`, `STATUS.md` |
| `aad-generate` | `src/app/routes/<feature>/**/*.ts` (mandatory NgRx layout) + timeline |
| `aad-mock` | New mock service + token + interface files; edits module + effects; writes fixtures to `mocks/<feature>/` AND `src/assets/mocks/<feature>/`; sets `mockMode` in `environment.*.ts` (skip prod) |
| `aad-switch` | `environment.<target>.ts` only |
| `aad-status` | Read-only |

## When something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `aad-plan` proposes weird component matches | Catalog stale | Re-run `aad-index` |
| `aad-generate` puts feature in wrong subtree | Profile detection picked wrong `routesPath` | Edit `.claude/angular-admin-design.json` `profile.routesPath`, or re-run `aad-init` |
| Mock UI shows empty grid | Fixture file exists but wrapped envelope is wrong | Open `mocks/<feature>/<endpoint-id>.json`, match the real backend's shape (succeedYn/result/list/totalCount) |
| `aad-switch` refuses to touch prod | By design | Pass `--force` only if you genuinely want prod to mock (CI smoke tests, etc.) |
| Generated code has `// TODO: q-NN` | Open question wasn't answered before codegen | Edit `plan.md` to answer, then `/aad-generate <feature>` again (it offers overwrite-with-confirm) |

## Mental model

`aad-plan` is the **anchor**. It captures:

1. What the feature does (from spec.md / Jira)
2. What's already in the codebase that can serve it (from catalog)
3. What's missing (open questions, new components needed)

Once `plan.json` + `reuse-map.json` exist, every subsequent step is deterministic: codegen has no creative freedom about which shared modules to import, mock-gen has no creative freedom about which endpoints exist. This is why the plugin doesn't suffer from "different prompt → different output" — the planning step has done all the deciding.
