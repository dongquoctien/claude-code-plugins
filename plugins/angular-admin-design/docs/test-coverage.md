# Test coverage — v1.0.0

Per-feature status across v0.1.0 → v1.0.0. Each row indicates whether the feature was verified end-to-end against a real codebase OR requires manual smoke test in your project.

## Legend

- ✅ **Verified** — tested end-to-end against `D:/Code/oh-admin` during plugin development, builds + runs correctly
- ⚠️ **Partial** — script/agent runs correctly but full pipeline not exercised in test; surface-area verified
- 🧪 **Manual smoke** — should work but verification deferred to per-project usage feedback
- ❌ **Known limitation** — documented constraint, not a bug

---

## Catalog + indexing (v0.1.0, v0.2.0)

| Capability | Status | Notes |
|---|---|---|
| `/aad-init` profile detection | ✅ | Tested on oh-admin (15 domain prefixes detected) + ohmyhotel-partners (subtree pattern recognized) |
| `/aad-index` catalog build | ✅ | 37 shared + 129 features + 491 models + 17 core services + 86 deps catalogued from oh-admin |
| Shared modules TS Compiler API parse | ✅ | Verified — extracts precise types (boolean vs object), CVA detection, getter/setter, isTemplateRef flag |
| Core services method indexing | ✅ | ErrorHandlerService methods extracted correctly (apiErrorHandler, errorHandler, parseApiError, invokeConsoleMethod) |
| Reference features extraction | ✅ | 3 anchors (bs-event, ho-reservation-list-ota, ad-dashboard) snapshotted verbatim |

---

## Plan + reuse-map (v0.1.0)

| Capability | Status | Notes |
|---|---|---|
| Spec-analyzer with local spec.md | ✅ | Tested on `hardblock-allotment-history.md` (5 endpoints, 17 actions, 14 selectors generated correctly) |
| Spec-analyzer with Jira input | ✅ | Tested with ELS-1313 (epic — 11 FRs, 29 ACs, 144KB attachments processed) |
| claude-context cross-reference | ✅ | spec-analyzer pulled br-04 (date format) and br-05 (succeedYn pattern) from claude-context/business-rules.md and integration-flow.md |
| Reuse-mapper decisions | ✅ | 100% reuse on hardblock feature (5 shared components matched at score ≥ 0.9); 13/3/20 split on ELS-1313 (reuse/kendo/new) |
| Audit-mode plan (existing folder check) | ✅ | ELS-1313: 21 expected/24 existing/3 extra correctly identified |

---

## Code generation + validation (v0.3.0)

| Capability | Status | Notes |
|---|---|---|
| Hybrid per-file confirmation | ✅ | Tested in batch mode (Yes/Skip/Edit options work) |
| Section splitting (>3 fields) | ✅ | Hardblock search section (5 fields) correctly split into `components/<feature>-search/` |
| Contract validation gate | ✅ | All 9 rules tested: importExists, coreServiceMethodExists, gridStateShape, etc. — caught v0.1.0 bugs in synthetic input |
| Auto-fix patterns | ✅ | `handleError` → `errorHandler` + `_catchErr` helper auto-applied during smoke test |
| `data.store` grep rule | ✅ | oh-admin: 0/128 → omitted correctly |
| Style extension kind-aware | ✅ | Container `.css`, sub-component `.scss` (matches bs-event convention) |
| TypeScript build pass | ✅ | Generated `ad-hardblock-allotment-history` feature compiles cleanly (0 new errors; pre-existing us-comp errors not from plugin) |

---

## Verify + state (v0.4.0)

| Capability | Status | Notes |
|---|---|---|
| `/aad-verify` runs tsc | ✅ | Tested on us-comp feature (caught 7 pre-existing `handleError` errors with correct classification + suggestedRule) |
| Error classification | ✅ | TS2339 → missing-property; TS2307 → missing-import; TS2322 → type-mismatch all detected |
| Auto-fix loop | 🧪 | Single re-verify cycle works; full multi-iteration loop deferred to real-project usage |
| Build check (`--build-check`) | ✅ | `ng build --configuration=development` integration tested |
| State relocation (`.claude/aad/`) | ✅ | All skills correctly write to stateDir vs planDir; timeline.mjs handles both layouts |
| `.gitignore` suggestion | ✅ | aad-init Step 7.5 verified |

---

## Mock + switch (v0.1.0, v0.4.0)

| Capability | Status | Notes |
|---|---|---|
| InjectionToken generation | ✅ | Token + interface + mock service all created correctly |
| `environment.*.ts` patching | ✅ | mock-switch.mjs idempotent, prod-refused (without `--force`), add-default works |
| Captured fixture priority | ⚠️ | Logic verified; no captured fixtures in test scenarios so synthetic fallback always used |
| Synthetic mock generation | ✅ | 5 fixtures generated for hardblock feature with `_synthetic: true` flag + realistic values |
| Effects @Inject rewrite | ✅ | Edit (not Write) preserves existing effect logic, only changes constructor injection |
| `angular.json` assets verification | 🧪 | oh-admin already has `src/assets`; the "add automatically" branch unstressed |

---

## Prototype inspection (v0.5.0 → v1.0.0)

| Capability | Status | Notes |
|---|---|---|
| URL detection (github.io / netlify / etc) | ✅ | ELS-1313 prototype URL detected with high confidence |
| Local file detection (.tsx/.html) | ✅ | Bare `remixed-ca0f0e7d.tsx` detected with low confidence; common-dir search verified |
| Chrome DevTools `take_snapshot` | ✅ | ELS-1313 entry + drawer views captured (text-tree format) |
| Playwright `browser_snapshot` | ✅ | Same prototype captured via Playwright (markdown format) |
| Auto-walk (`walk-prototype.mjs`) | ✅ | 5 candidates returned correctly (2 tabs + 3 modal triggers) for ELS-1313 drawer |
| Multi-route detection | ✅ | ELS-1313 detected 0 relevant routes (sidebar nav filtered out — correct behavior for single-screen) |
| Prototype-classifier severity | 🧪 | Logic + heuristics defined; full end-to-end run vs catalog deferred to manual smoke test |
| Network capture XHR/fetch bodies | 🧪 | Tools verified available; ELS-1313 prototype made 0 dynamic requests (edge case) |
| Static demo edge case | ✅ | Detected + documented (5 static requests only, 0 dynamic) |
| Source parse TSX/JSX | ✅ | Sample TSX with useState/useReducer/axios extracted correctly (5 events, 3 state, 1 endpoint, 4 components) |
| HTML source parse | ⚠️ | Regex parser implemented; no test HTML prototype in current set |
| Text + color extraction | ✅ | 240 → 180 text strings after sidebar filter; i18n key suggestions correct format |

---

## Multi-MCP backend (v0.7.1)

| Capability | Status | Notes |
|---|---|---|
| Detect Playwright + Chrome DevTools at runtime | ✅ | Both detected via ToolSearch in test environment |
| Backend dispatch per task | ⚠️ | Decision matrix defined; full skill run with both backends side-by-side deferred |
| Browser session isolation | ✅ | Confirmed via docs — separate processes, can't share state |
| Skip-on-error policy | ✅ | Empty network requests (static demo) handled gracefully — no plan failure |

---

## Deferred to per-project verification

These need manual smoke test in YOUR project:

1. **i18n flow `scan-download`** — partners-style spec scan. oh-admin uses `none` so partners flow untested in plugin dev.
2. **Multi-route walking with real multi-screen prototype** — ELS-1313 is single-screen. Test with a prototype having `#/list`, `#/detail/:id`, etc.
3. **Auto-fix for unknown TS errors** — verify-feature.mjs has classifier for common patterns; novel errors fall through to user.
4. **Mock service `_filterAndPage` with real grid** — generated correctly but UI behavior with mock paging deferred.
5. **Source parse on real production .tsx** — sample test passed; real-world TSX prototypes may have higher complexity (HOC, dynamic imports, etc.).
6. **Concurrent /aad-plan invocations** — plugin assumes single-user per project. Concurrent runs on same feature folder may race on .spec/ writes.
7. **Hot-reload mockMode flip** — `/aad-switch` flips env file, but Angular dev server may need restart depending on how `environment` is imported.

---

## Known limitations (acceptable for v1.0.0)

| Limitation | Workaround | Future |
|---|---|---|
| String concatenation URLs in source parse not captured | Document in plan.openQuestions[] for dev | v1.1+ AST evaluation |
| Color hints don't auto-match design tokens | Manual cross-reference with `claude-context/coding-style.md` or `shared/scss/_variables.scss` | v1.1+ parse design-token file |
| Sidebar nav text leaks into i18n suggestions | Manually prune in plan.i18n.keys[] | v1.1+ deeper context heuristics |
| Per-feature mock mode (currently global) | Single `mockMode` env flag affects all features | v1.1+ per-feature flag registry |
| WebSocket prototype data | Neither MCP captures WS frames | document only |
| Iframe content | MCPs may need context switching | document only |

---

## Test environment

| Project | Version | Used for |
|---|---|---|
| `D:/Code/oh-admin` | Angular 9.1.4 + Kendo 4.7.1 + NgRx 9.1.1 | Primary e2e test bed |
| `D:/Code/ohmyhotel-partners` | Angular 9.1.4 + Kendo 4.7.1 | Profile detection smoke (catalog only) |
| ELS-1313 prototype | `https://tracy-tramtran.github.io/vcomm-rate-adjustment/` | Prototype inspection e2e |
| Sample TSX | Hand-crafted Drawer component | Source parse e2e |

If you want to extend coverage on a new Angular project, the test pattern is:
1. `/aad-init` → confirm profile detection
2. `/aad-index` → confirm catalog reflects your project
3. `/aad-plan <feature> <spec>` → confirm plan.json sensible
4. Inspect output, file an issue/PR for unexpected behavior
