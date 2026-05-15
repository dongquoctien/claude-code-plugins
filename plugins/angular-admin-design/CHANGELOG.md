# Changelog

All notable changes to angular-admin-design.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.0] — production-ready release

### Added
- **Text + color extraction from snapshots** — `scripts/extract-prototype-text.mjs` parses captured snapshots (Chrome DevTools `.txt` and Playwright `.md`) and source findings, extracts user-visible text strings + inline color hints (hex/rgb).
- **Auto-suggest i18n keys** — spec-analyzer Step 1.9 reads text findings, proposes dot-path i18n keys per text string (e.g. `usCompVcommOverride.dialog.save_changes`). Capped at 80 keys per prototype.
- **Color drift detection** — colorHints flagged as info-severity openQuestions for design-token review.
- **README rewrite** — full pipeline tutorial, all 8 skills documented, architecture diagram.
- **CHANGELOG.md** — this file, documenting v0.1.0 → v1.0.0 evolution.
- **docs/test-coverage.md** — per-feature status (verified end-to-end vs deferred).

### Known limitations
- Text extraction can include chrome elements (sidebar nav, banner buttons) when snapshot includes those regions. spec-analyzer surfaces a note to review and prune.
- Color hints don't auto-match against project design tokens (manual cross-reference needed).

---

## [0.8.0] — TSX/JSX/HTML source parsing

### Added
- **Source code parser** — `scripts/parse-prototype-source.mjs` uses TypeScript Compiler API (borrowed from project's node_modules) to extract event handlers, useState/useReducer initial shapes, fetch/axios URLs, JSX component composition. HTML regex parser as fallback.
- **Improved bare filename detection** — `scripts/detect-prototype.mjs` now searches common prototype dirs (docs/, prototypes/, mockups/, design/, etc.). Confidence upgraded `low` → `medium` when file found on disk.
- **spec-analyzer Step 1.8** — consumes source findings: events → state.actions[], state → state.shape, endpoints → plan.endpoints[], components → suggested sections.
- **Conflict detection** — when both source and DOM snapshot exist, flag mismatches (DOM has button not in source, etc.).

### Limitations
- String concatenation URLs (`fetch('/api/' + id + '/...')`) not captured — only string-literal URLs.
- Dynamic imports (`React.lazy`), HOC, CSS-in-JS not extracted.

---

## [0.7.1] — Multi-MCP backend (Playwright + Chrome DevTools)

### Added
- **Backend auto-detection** — skill detects Playwright + Chrome DevTools MCP availability at runtime, binds `backendChoice ∈ {both, playwright-only, chrome-only, none}`.
- **Per-task best-tool dispatch** — see `knowledge/mcp-browser-tools.md` for the capability matrix. Playwright for snapshot/walk (cleaner markdown); both backends equivalent for network capture.
- **Prototype network capture** — XHR/fetch response bodies saved to `.spec/prototype-network/api-{slug}.json` during prototype walk. `/aad-mock` later uses these as captured fixtures.
- **`fixtureSource: 'prototype-captured'`** — new priority level in mock-spec (between captured and synthetic).

### Edge case documented
- Static demo prototypes (mock data inline in JS bundle) — log warning, fall back to synthetic.

---

## [0.7.0] — Multi-screen prototype support

### Added
- **Route detector** — `scripts/detect-prototype-routes.mjs` parses initial snapshot, extracts sibling routes (hash/path/nav-link) with confidence scoring (feature-name match + location).
- **Multi-route walking** — for each route ≥ 0.3 score, navigate + snapshot + auto-walk inner candidates. Filename pattern `{i}-{kind}-route-{slug}-...`.
- **Classifier route grouping** — deviations.json adds `byRoute: {slug: [dev-ids]}` index. Same element across routes flagged as `shared-pattern info`.
- **spec-analyzer Step 1.7** — maps each prototype route to most-similar plan.screens[] by slug/label similarity.

### Backward compat
- Single-screen prototypes (like ELS-1313) detect 0 routes ≥ threshold → unchanged behavior.

---

## [0.6.0] — Auto-walk + prototype classifier

### Added
- **Auto-walk** — `scripts/walk-prototype.mjs` parses snapshot, returns walk candidates (tabs/modals/accordions/dropdowns) with priority. Skill clicks each (max 5), snapshots after each.
- **Classifier subagent** — `agents/prototype-classifier.md` compares every detected UI element vs `catalog.shared`. Outputs `deviations.json` with severity (critical/warning/info).
- **Custom-pattern detection** — flags known bespoke types: 12-month grids, color-coded mode tabs (numbered prefix), slide-in drawers >70vw, M×N matrix grids, Month/Day/Year spinbutton groups.
- **User resolution loop** — skill Step 5.7 batches critical deviations (max 5 per AskUserQuestion), user picks: accept-feature-component / use-catalog-match / add-openquestion / skip.
- **spec-analyzer Step 1.6** — reads deviations.json, injects user-resolved bespoke patterns into plan, escalates unresolved criticals.

---

## [0.5.0] — Prototype detection + Chrome MCP snapshot

### Added
- **Prototype detection** — `scripts/detect-prototype.mjs` scans Jira description / spec text / args / Jira attachments for prototype URLs (github.io / netlify / surge / vercel / glitch / codesandbox / stackblitz) and local HTML/TSX paths. Confidence scoring (high/medium/low) via context-keyword boost.
- **Skill Step 5.5 + 5.6** — detect + AskUserQuestion confirm + Chrome MCP inspection (navigate, wait_for, take_snapshot, take_screenshot). Skip-on-error policy.
- **spec-analyzer Step 1.5** — reads `.txt` snapshots, augments plan with observed UI signals.
- **plan.spec.prototypes[]** field in schema.

### Constraints discovered
- Chrome MCP `take_snapshot` outputs plain text (`.txt`), not JSON.
- File paths must be within registered workspace roots — workaround: save to temp, then `cp` to final location.

---

## [0.4.0] — aad-verify + state relocation + mock polish

### Added
- **`/aad-verify` skill** — runs `tsc --noEmit -p tsconfig.app.json` filtered to feature files. Classifies errors (missing-property → use-catalog-method, missing-import → check-deps, type-mismatch → fix-binding-type) with auto-fix suggestions. Optional `--build-check` runs full `ng build`.
- **State relocation** — `.timeline.json` + `STATUS.md` moved to `.claude/aad/<feature>/` (gitignored). Plan artifacts stay in `docs/aad/<feature>/` (committed).
- **Style extension kind-aware detection** — containers default to `.css`, sub-components default to `.scss` (matches oh-admin convention).
- **`data.store` grep rule** — only generate `data: { store: '...' }` when project majority uses it. oh-admin: 0/128 → omit.
- **Type-safe `environment.mockMode`** — validator catches `(environment as any).mockMode` cast.
- **Angular.json assets verification** — `/aad-mock` Step 1.5 confirms `src/assets` in build assets.
- **`_filterAndPage` mock helper** — client-side filter+sort+page for paged mock endpoints.

---

## [0.3.0] — Contract-validation gate + section splitting

### Added
- **`agents/contract-validator.md`** — per-file gate before every `Write`. Validates against catalog with 9 rules.
- **`scripts/validate-against-catalog.mjs`** — script the validator shells out to. Rules: importExists / coreServiceMethodExists / styleExtensionMatch / selectorNaming / apiPathFileNaming / gridStateShape / templateBindingValid / selectorExists / sharedModuleImport.
- **Auto-fix patterns** — `handleError` → `errorHandler` + `_catchErr` helper; `file-saver` → `URL.createObjectURL`; flat `gridState` → nested `{pageInfo, sortInfo}`; `selectFeatureState` → `selectModuleState`.
- **Section splitting** — code-generator Step 3.6: when a screen.section has >3 fields, splits into a presentational sub-component under `components/<feature>-<section>/`.

### Fixed
- v0.1.0 bugs caught: `handleError` (8 build-blocking errors), `file-saver` import, `[pageable]="{...}"` object literal, etc.

---

## [0.2.0] — Anchor codegen to real catalog + reference features

### Added
- **`scripts/crawl-core-services.mjs`** — indexes every public method in `core/services/*.service.ts`. Catalog now knows `ErrorHandlerService.errorHandler` (not the invented `handleError`).
- **`scripts/crawl-package.mjs`** — indexes installed deps + missing-from-lockfile. Generator refuses to import packages not in `node_modules/`.
- **TypeScript Compiler API parser** — `scripts/crawl-shared-modules.mjs` rewritten. Precise types: `pageable: boolean` (not unknown), `gridState: IBasisGridState (getter)`, `templates: Record<string, TemplateRef<any>>` with `isTemplateRef: true` flag.
- **Reference features** — `scripts/extract-reference-features.mjs` captures verbatim source of N anchor features (default: `bs-event`, `ho-reservation-list-ota`, `ad-dashboard` for oh-admin). Code-generator reads these instead of guessing patterns.
- **Knowledge rewrites** — `ngrx-feature-store.md`, `kendo-grid-patterns.md`, `shared-modules-catalog.md` regenerated from real anchor code (no more hand-written generic patterns).

### Fixed
- 8 v0.1.0 build-blocking bugs by anchoring generation to real catalog + reference snapshots.

---

## [0.1.0] — Initial release

### Added
- 5-phase pipeline: aad-init → aad-index → aad-plan → aad-generate → aad-mock → aad-switch → aad-status
- 6 schemas: config, component-catalog, plan, reuse-map, mock-spec, plus the marketplace + plugin manifests
- 5 agents: source-indexer, spec-analyzer, reuse-mapper, code-generator, mock-generator
- 6 knowledge files: Angular 9 conventions, NgRx feature store, Kendo grid patterns, shared modules catalog, i18n flow, module prefix map
- 3 docs: workflow.md, reuse-map-spec.md, mock-switch-spec.md
- Jira integration via `mcp-atlassian` MCP

### Tested
- oh-admin (Angular 9.1.4 + Kendo 4.7 + NgRx 9): catalog detection, plan + reuse-map for `ad-hardblock-allotment-history` feature, code generation against `bs-event` anchor pattern.
- ohmyhotel-partners: profile detection only (smoke).

### Known issues at v0.1.0
- 8 build-blocking bugs in generated code (handleError, file-saver, type mismatches). Fixed in v0.2.0 + v0.3.0.

---

## Upgrade notes

- **v0.4.0** moves state files. Old configs auto-fall back to `outputDir`. New configs use `stateDir: ".claude/aad"`. Add `.claude/aad/` to `.gitignore`.
- **v0.5.0+** introduces prototype detection. Existing plans don't break — new spec.prototypes[] field is optional.
- **v0.7.1** picks best MCP backend per task. Existing single-MCP setups continue working.

---

## Roadmap (post-1.0)

Possible v1.x features:
- Design token comparison (parse `shared/scss/_variables.scss` → match against prototype color hints)
- Plan diff between re-runs (show what changed when spec/prototype updated)
- Multi-language i18n key sync (auto-add to vi/en/ko JSON files)
- WebSocket prototype support (currently neither MCP captures WS frames)
- Cross-feature integration plans (e.g. when feature touches multiple existing modules)
