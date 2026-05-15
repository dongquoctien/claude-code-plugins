# Shared modules — how to find and wire them

This doc does NOT list shared components by name. That list lives in `component-catalog.json` and is regenerated every `/aad-index` run. The catalog is the source of truth; this doc is the lookup protocol.

**The rule: never hardcode component names in generated code. Always grep `catalog.shared[*]` first.**

---

## How code-generator MUST consult the catalog

For every UI requirement in `plan.screens[*].sections[*]`:

1. Read `reuse-map.json` → pick the `match.modulePath` for the requirement.
2. Read `catalog.shared[N]` where `name === match.name` (or `selector === match.selector`).
3. Use **`inputs[]`** to know which `[attr]="..."` bindings are valid.
4. Use **`outputs[]`** to know which `(event)="..."` handlers can be wired.
5. Use **`modulePath`** to know what to add to `imports[]` in the feature module.
6. If the catalog entry's `inputs[*].type` says `boolean`, generate `[x]="true"` not `[x]="{...}"`.
7. If the catalog entry's `inputs[*].type` says `TemplateRef<any>` or has flag `isTemplateRef: true`, the binding expects a TemplateRef variable (`@ViewChild('foo') foo: TemplateRef`), not a string literal.

**If a catalog entry is missing the input you want, the component does not have it. Do not invent it.** Skip the binding or check for an alternative selector.

---

## Sample lookup workflow (worked example)

Given the plan says **"Autocomplete khách sạn — gọi /admin/hotel/autocomplete, debounce + chọn theo hotelCode/hotelName"**:

### Step A — Open `reuse-map.json`

```json
{
  "requirement": "Autocomplete khách sạn ...",
  "decision": "reuse-existing",
  "match": {
    "name": "AutoCompleteComponent",
    "selector": "app-auto-complete",
    "modulePath": "src/app/shared/modules/auto-complete/auto-complete.module"
  }
}
```

### Step B — Open `catalog.shared` and find the entry

```json
{
  "name": "AutoCompleteComponent",
  "selector": "app-auto-complete",
  "moduleName": "AutoCompleteModule",
  "modulePath": "src/app/shared/modules/auto-complete/auto-complete.module",
  "componentPath": "src/app/shared/modules/auto-complete/auto-complete.component.ts",
  "implementsCVA": true,
  "kind": "form-control",
  "inputs": [
    { "name": "apiUrl",         "type": "string",   "required": true,  "kind": "field" },
    { "name": "apiCondition",   "type": "any",      "required": false, "kind": "field" },
    { "name": "apiSearchTerm",  "type": "string",   "required": false, "kind": "field" },
    { "name": "searchResultPath", "type": "string[]", "required": false, "kind": "field" },
    { "name": "placeholder",    "type": "string",   "required": false, "kind": "field" },
    { "name": "minLength",      "type": "number",   "defaultValue": "1" },
    { "name": "delay",          "type": "number",   "defaultValue": "300" },
    { "name": "field",          "type": "string" },
    { "name": "dataKey",        "type": "string" },
    { "name": "forceSelection", "type": "boolean",  "defaultValue": "true" },
    { "name": "isInvalid",      "type": "boolean" }
    // ... 38 total inputs
  ],
  "outputs": [
    { "name": "completeMethod", "type": "EventEmitter<any>" },
    { "name": "onSelect",       "type": "EventEmitter<any>" },
    { "name": "onUnselect",     "type": "EventEmitter<any>" },
    { "name": "onFocus",        "type": "EventEmitter<any>" },
    { "name": "onBlur",         "type": "EventEmitter<any>" }
    // ...
  ]
}
```

### Step C — Generate template using only what the catalog confirms

```html
<app-auto-complete
  formControlName="hotelCode"
  apiUrl="/admin/hotel/autocomplete"
  [apiCondition]="{ keyword: '' }"
  apiSearchTerm="keyword"
  [searchResultPath]="['result', 'list']"
  field="hotelName"
  dataKey="hotelCode"
  placeholder="Search hotel by name or code"
  (completeMethod)="onHotelComplete($event)"
  (onSelect)="onHotelSelect($event)">
</app-auto-complete>
```

Every attribute above maps to a catalog `inputs[*].name` or `outputs[*].name`. Generator never reaches for an attribute not in the catalog.

### Step D — Generate module imports

```typescript
import { AutoCompleteModule } from 'src/app/shared/modules/auto-complete/auto-complete.module';

@NgModule({
  imports: [
    // ...
    AutoCompleteModule,  // from catalog.shared[*].modulePath of the auto-complete entry
  ],
})
```

---

## Type-driven binding rules

For each binding, the catalog input type tells you the syntax:

| Catalog input type | Binding syntax |
|---|---|
| `string` (no default) | `attr="literal"` or `[attr]="expr"` |
| `string` (default value) | omit unless overriding |
| `number` | `[attr]="42"` or `[attr]="expr"` |
| `boolean` | `[attr]="true"` / `[attr]="false"` — **never `[attr]="{...}"`** |
| `T[]` (array) | `[attr]="arrayExpr"` |
| `T \| null` or `T \| undefined` | optional — generate only when plan requires |
| `TemplateRef<any>` (or `isTemplateRef: true`) | `[attr]="tplRefVar"` where `@ViewChild('tplName') tplRefVar: TemplateRef<any>` |
| `Observable<T>` (or `isObservable: true`) | `[attr]="obs$ \| async"` — should be Observable from store |
| `EventEmitter<T>` (output) | `(name)="handler($event)"` |

Default values matter: if `inputs[*].defaultValue === 'true'`, omit the binding unless overriding to false. Cleaner template.

---

## Module wiring rule

After reuse-mapper picks N existing shared components, the feature module's `imports[]` MUST include `<Name>Module` for each unique `match.modulePath` — no duplicates.

```typescript
// Resolve from reuse-map.json:
//   uniqueModules = [...new Set(reuseMap.items
//     .filter(it => it.decision === 'reuse-existing')
//     .map(it => it.match.modulePath))]
// For each module path, look up its NgModule class name in catalog.shared:
//   catalog.shared.find(s => s.modulePath === path).moduleName

import { AutoCompleteModule } from 'src/app/shared/modules/auto-complete/auto-complete.module';
import { SelectboxModule }    from 'src/app/shared/modules/selectbox/selectbox.module';
import { CalendarModule }     from 'src/app/shared/modules/calendar/calendar.module';
// ...

@NgModule({
  imports: [
    // ... CommonModule, FormsModule, etc.
    AutoCompleteModule,
    SelectboxModule,
    CalendarModule,
    // ...
  ],
})
```

---

## CVA components in reactive forms

Catalog `implementsCVA: true` means the component is usable with `formControlName` directly.

```html
<form [formGroup]="form">
  <app-selectbox formControlName="hotelCode" ...></app-selectbox>
  <app-calendar  formControlName="dateRange" ...></app-calendar>
</form>
```

Catalog `implementsCVA: false` (rare for input-like components) — bind via `[value]` + `(change)` instead of `formControlName`.

---

## Output event naming convention

The catalog records the output names exactly as they appear in the component. Some are non-standard:

- `(completeMethod)` (auto-complete) — fires during typing for async search
- `(onSelect)`, `(onUnselect)` (auto-complete)
- `(onChange)` (multi-select-detailcode)
- `(stateChangeEvent)` (grid-basis) — page/sort/filter change
- `(dbClickRowEvent)` (grid-basis) — double-click row
- `(visibleChange)` (dialog) — dialog open/close

Don't normalize these to camelCase or invent variants. Use the exact name from `catalog.shared[N].outputs[*].name`.

---

## Worked example: building search form section

Given plan section:

```json
{
  "id": "search",
  "fields": [
    { "name": "hotelCode",    "type": "autocomplete", "label": "Khách sạn" },
    { "name": "roomTypeCode", "type": "select",       "label": "Loại phòng" },
    { "name": "dateRange",    "type": "daterange",    "label": "Khoảng thời gian" },
    { "name": "actions",      "type": "multiselect",  "label": "Loại hành động" }
  ]
}
```

For each field:

1. Find catalog entry by selector matching the field type (per reuse-map).
2. Check `inputs[]` for the bindings the plan needs (`apiUrl`, `options`, `selectionMode='range'`, `useAllOptionYn`).
3. If a needed binding isn't in `inputs[]`, the component doesn't support it. Stop and surface to user.

Result:

```html
<form [formGroup]="form" class="search-section">

  <!-- hotelCode (autocomplete) -->
  <app-auto-complete
    formControlName="hotelCode"
    apiUrl="/admin/hotel/autocomplete"
    apiSearchTerm="keyword"
    [searchResultPath]="['result', 'list']"
    field="hotelName"
    dataKey="hotelCode"
    placeholder="...">
  </app-auto-complete>

  <!-- roomTypeCode (selectbox) -->
  <app-selectbox
    formControlName="roomTypeCode"
    [options]="roomTypeOptions$ | async"
    dataKey="roomTypeCode"
    displayKey="roomTypeName"
    [disabled]="!form.get('hotelCode').value">
  </app-selectbox>

  <!-- dateRange (calendar with selectionMode='range') -->
  <app-calendar
    formControlName="dateRange"
    selectionMode="range"
    dateFormat="yy-mm-dd"
    rangeSeparator=" ~ ">
  </app-calendar>

  <!-- actions (multi-select-detailcode, system-code-driven) -->
  <app-multi-select-detailcode
    formControlName="actions"
    [options]="actionOptions$ | async"
    dataKey="value"
    displayWord="label"
    [useAllOptionYn]="true">
  </app-multi-select-detailcode>

</form>
```

The generator decided **every selector + every attribute** by consulting the catalog. No imagination.

---

## What this doc explicitly does NOT do

- Does not list shared components by name. Use the catalog.
- Does not describe component appearance. Use the catalog or look at the real `.component.html`.
- Does not assume default behaviors. The catalog records `defaultValue`; respect it.

If a new shared module is added to the project, `/aad-index` re-runs and the catalog updates. This doc never needs editing.

---

## Common shared kinds and selectors (for orientation — NOT a binding contract)

These are signposts. The catalog has the truth.

- **form-control + CVA** — usable with `formControlName`: dropdown, selectbox, input-text, checkbox, radio, calendar, auto-complete, multi-select, multi-select-detailcode, selectbox-detailcode
- **grid** — `app-grid-basis` (canonical), `app-grid-simple`, `app-grid-virtual`, `app-grid-row-reorderable`
- **dialog** — `app-dialog` (declarative ng-content), `app-dynamic-dialog` (service-opened), `app-alert` (confirm/warn via `ConfirmationService`)
- **input** — `app-input-text`, `app-input-text-suggestion`, `app-span-input`
- **layout** — `app-tabs`, `app-tab-group`, `app-tab-menu`, `app-paginator`
- **data-display** — `app-alert`, `app-image-shimmer`, `app-loading-icon-checked`

Always confirm selector + inputs by reading the catalog before generating.
