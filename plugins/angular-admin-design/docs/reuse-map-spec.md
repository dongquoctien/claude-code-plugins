# Reuse-map spec

`reuse-map.json` is the contract between `aad-plan` (which produces it) and `aad-generate` (which consumes it). It exists to make one decision concrete:

> For every UI requirement in the plan, which existing component fulfils it — or what new component needs to be created?

This is the file that prevents AI from re-inventing components that already exist in `shared/modules`.

## Producer / consumer

```
spec.md ──► spec-analyzer ──► plan.json
                                   │
catalog.json ─────────► reuse-mapper ──► reuse-map.json ──► code-generator ──► .ts files
```

## Decisions

Each row in `items[]` is one decision. Four kinds:

### `reuse-existing`

Use a shared component already in `catalog.shared`. This is preferred.

```json
{
  "screenId": "history-list",
  "sectionId": "search",
  "requirement": "Autocomplete khách sạn — gọi /admin/hotel/autocomplete, debounce + chọn theo hotelCode/hotelName",
  "decision": "reuse-existing",
  "match": {
    "name": "AutoCompleteComponent",
    "selector": "app-auto-complete",
    "modulePath": "src/app/shared/modules/auto-complete/auto-complete.module",
    "score": 0.95,
    "rationale": "Field type `autocomplete` khớp kind `form-control`; CVA; expose `apiUrl`/`apiCondition`/`apiSearchTerm`/`searchResultPath` + `completeMethod`/`onSelect` đủ cho debounce-driven suggest."
  }
}
```

Codegen reads `modulePath` and adds an import to the feature module. It reads `selector` and renders `<app-auto-complete ...>` in the template.

### `use-kendo`

When no `shared` entry fits BUT the project has a Kendo Angular module installed that fits natively.

```json
{
  "decision": "use-kendo",
  "kendo": {
    "module": "@progress/kendo-angular-grid",
    "component": "kendo-grid",
    "rationale": "Long list with virtualization needed; project's grid-basis wrapper doesn't support virtual scroll."
  }
}
```

Codegen imports the Kendo module (e.g. `GridModule`) and renders the Kendo element directly.

### `create-feature-component`

When no shared/Kendo fits AND the component is too domain-specific to belong in `shared/`. Lives in `routes/<feature>/components/`.

```json
{
  "decision": "create-feature-component",
  "newComponent": {
    "name": "BookingCancelReasonComponent",
    "location": "feature",
    "rationale": "Cancellation reason picker has business-rule-specific validation (BKS03/BKS06 status check) — too domain-coupled for shared/."
  }
}
```

Codegen creates `routes/<feature>/components/<feature>-cancel-reason.component.ts` (and .html/.css).

### `needs-new-shared`

When no shared/Kendo fits BUT the component IS generic enough to belong in `shared/`. **Flagged for human review.**

```json
{
  "decision": "needs-new-shared",
  "newComponent": {
    "name": "MaskedPhoneInputComponent",
    "location": "shared",
    "rationale": "Phone input with country-mask formatting — useful in many features beyond this one. Should live in shared/modules/masked-phone-input."
  }
}
```

Codegen DOES NOT auto-create files under `shared/`. It surfaces the row to the user, who decides whether to create the shared module manually before re-running `aad-generate`.

## Matching heuristic (reuse-mapper internals)

Score from 0 to 1, additive:

- **+0.5** Kind match
  - `field.type='date'` → shared kind `form-control` with selector containing `date|calendar|picker`
  - `field.type='select'` → `dropdown` / `selectbox` (or `selectbox-detailcode` if requirement mentions system-code)
  - `field.type='multiselect'` → `multi-select` (or `-detailcode` variant)
  - `field.type='autocomplete'` → `auto-complete`
  - `field.type='checkbox'|'radio'` → matching name
  - `field.type='text'|'number'|...` → `input-text` (or fall through to Kendo)
  - `field.type='textarea'` → `editor`
  - `field.type='file'` → `file-upload`
  - Grid → `grid-basis` > `grid-simple` > `grid-virtual`
  - Dialog → `dialog` or `dynamic-dialog`
- **+0.2** CVA fit (component `implementsCVA: true` and requirement is reactive-form-bound)
- **+0.2** Input fitness (component exposes the inputs the requirement needs)
- **+0.1** Output fitness (component emits the events the requirement needs)

Threshold: `score >= 0.6` for `reuse-existing`. Below that, fall through to Kendo / new-component / new-shared.

## Why explicit scores

Two reasons:

1. **Transparency.** When a dev disagrees with a match, they can see *why* the planner picked it.
2. **Threshold tuning.** If a project consistently mismatches (e.g. has a custom `app-typeahead` that the planner doesn't pick because it scored 0.55), the team can either improve component metadata (JSDoc on inputs) or lower the threshold per project.

## What reuse-map.json does NOT decide

- Layout / CSS — that's codegen's freedom guided by the screen's `kind`.
- Form validation logic — comes from `plan.fields[*].validation`.
- API URLs — from `plan.endpoints[]`.
- NgRx action / selector / effect names — codegen derives from `plan.state.*`.

Reuse-map is strictly about **which component class fills which slot**.

## Compatibility

`reuse-map.schema.json` is at `version: 1`. Breaking changes will bump the version and the consumer (`aad-generate`) will refuse to read a newer schema than it understands — forcing a plugin upgrade rather than silent miscompile.
