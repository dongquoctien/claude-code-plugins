# Kendo Grid + shared `app-grid-basis` — patterns derived from real anchor features

This doc derives every pattern from real code in oh-admin (anchors: `av-markup-item`, `bs-event`). Generated code MUST match these patterns exactly — knowledge templates from v0.1.0 invented several inputs that don't exist and used wrong types.

---

## Decision rule (from reuse-mapper)

When the plan has a `result-grid` section:

1. **First** check `catalog.shared` for entries with `kind: 'grid'`. Pick `GridBasisComponent` if present (canonical wrapper).
2. **Fall back** to `kendo-grid` directly only if no shared wrapper exists.

oh-admin always has `GridBasisComponent` in `catalog.shared` → always use the wrapper.

---

## `<app-grid-basis>` template — canonical from av-markup-item

```html
<app-grid-basis
  #gridBasis
  [gridLoading]="loading$ | async"
  [gridState]="gridState$ | async"
  [checkedState]="gridCheckedState$ | async"
  [columns]="columns"
  [pageSize]="listPageSize$ | async"
  [checkboxUseYn]="true"
  [dataList]="gridDataList$ | async"
  [templates]="{
    useYnTpl: useYnTpl,
    markupValueTpl: markupValueTpl
  }"
  (dbClickRowEvent)="dbClickRowHandler($event)"
></app-grid-basis>
```

### Inputs that are actually used (verified against av-markup-item, av-markup-master, av-meeting-point, av-promotion-list, bs-api-service)

| Input | Type (per catalog) | Common usage |
|---|---|---|
| `gridLoading` | `boolean` | `[gridLoading]="loading$ \| async"` |
| `gridState` | `IBasisGridState` (getter) | `[gridState]="gridState$ \| async"` — see "gridState shape" below |
| `checkedState` | (getter) | `[checkedState]="gridCheckedState$ \| async"` — Observable |
| `columns` | `IColumnOption[]` (getter) | `[columns]="columns"` — local property |
| `pageSize` | `number` (getter) | `[pageSize]="listPageSize$ \| async"` — Observable |
| `dataList` | `any[]` (getter) | `[dataList]="gridDataList$ \| async"` — Observable from store |
| `templates` | `Record<string, TemplateRef<any>>` (field, required) | `[templates]="{ tplName: tplRef }"` — object literal |
| `checkboxUseYn` | `boolean` (field, default null/false) | `[checkboxUseYn]="true"` when row-checkbox needed |
| `gridName` | `string` (field, default `'default'`) | rarely overridden |

### Inputs you almost never use (defaults are fine)

| Input | Default | Note |
|---|---|---|
| `pageable` | `true` | Boolean, NOT an object. v0.1.0 generated `[pageable]="{buttonCount:5,pageSizes:[25,50,100]}"` — this is invalid (TS error). Override with `[pageable]="false"` to disable. |
| `sortable` | `true` | Boolean. Override with `false` to disable. |
| `filterable` | `true` | Boolean. |
| `isAutoColumnWidthMode` | `true` | Boolean. |
| `isHiddenGridSetup` | `false` | Boolean. |
| `checkedRowids` | (none) | `string[]` array of pre-checked row IDs. |

### Outputs

| Output | Type | Usage |
|---|---|---|
| `stateChangeEvent` | `EventEmitter<IBasisGridState>` | Fires on page/sort/filter change. Dispatch a `setGridStateAction({ gridState: $event })`. |
| `cellClickEvent` | `EventEmitter<any>` | Cell click — rare. |
| `dbClickRowEvent` | `EventEmitter<any>` | **Double-click row** — open detail/edit dialog: `(dbClickRowEvent)="onRowDblClick($event)"`. |
| `onCheckEvent` | `EventEmitter<any>` | Row checkbox toggled. |

---

## `gridState` shape — `IBasisGridState`

Verified against `bs-event/reducers/bs-event.reducer.ts:58-61`:

```typescript
gridState: {
  pageInfo: { skip: 0, take: 20 },   // ← nested under pageInfo
  sortInfo: [],                       // ← sortInfo NOT 'sort'
}
```

### Type definition (from `shared/modules/grid-basis/grid-basis.model.ts`)

```typescript
export interface IBasisGridState {
  skip?: number;                       // top-level skip — DEPRECATED, dev convention uses pageInfo.skip
  sortInfo?: SortDescriptor[];         // ← project field name
  filter?: CompositeFilterDescriptor;
}
```

There's a mismatch between the **declared** interface (`skip?` top-level) and **actual usage** (`pageInfo: { skip, take }`). The wrapper internally reads both. **Match the project's reducer convention**:

```typescript
const initialState = adapter.getInitialState({
  gridState: {
    pageInfo: { skip: 0, take: 20 },
    sortInfo: [],
  },
});
```

v0.1.0 generated `{ skip: 0, take: 50, sort: [], filter: {} }` — flat shape with wrong field names. Refuse to generate flat shape.

---

## Columns declaration — canonical from av-markup-item-data.service.ts

```typescript
generateGridColumns = () => {
  return [
    { field: 'markupItemSeq',     title: 'M/U Item SEQ',     type: 'numeric', style: { 'text-align': 'center' } },
    { field: 'vendorCompName',    title: 'Vendor',           type: 'text' },
    { field: 'activityNames',     title: 'Product Name',     type: 'text', useTitleAttrYn: true },
    {
      field: 'markupValue',
      title: 'M/U Value',
      type: 'numeric',
      template: 'markupValueTpl',                            // ← STRING name, not TemplateRef
      style: { 'text-align': 'right' },
    },
    { field: 'useYn',             title: 'Use',              type: 'boolean', template: 'useYnTpl', style: { 'text-align': 'center' } },
    { field: 'lastUpdateName',    title: 'Last Update User', type: 'text' },
    { field: 'lastUpdateDatetime', title: 'Last Update Time', type: 'text', style: { 'text-align': 'center' } },
  ];
};
```

### Field rules (verified against multiple anchor features)

| Field | Project convention | Notes |
|---|---|---|
| `field` | always set (string) | Backend property name. Required. |
| `title` | always set (string) | Display label. In `workingLanguage`. |
| `type` | `'text' \| 'numeric' \| 'boolean' \| 'date'` (string) | NOT a strict enum — but stick to these 4 values. |
| `template` | **STRING template name** | `'useYnTpl'` not the `TemplateRef` ref. The wrapper looks up `template[name]` against the `[templates]="..."` object. |
| `style` | `Record<string, string>` | Common: `{ 'text-align': 'center' }` or `{ 'text-align': 'right' }`. |
| `useTitleAttrYn` | `true` to enable title-attr tooltip on long values | Set on text columns where values may overflow. Default falsy. |
| `format` | `'yn'` or other format string | Used by some teams; not common. |
| `width` | (number) — **rarely used** | Most columns use auto-sizing. Don't generate widths unless the plan says so. |

### Column declaration target

Project convention is to **delegate to a data service method `generateGridColumns()`**, not declare inline in the container:

```typescript
// container
columns: any[];

ngOnInit() {
  this.columns = this._dataService.generateGridColumns();
}
```

```typescript
// services/<feature>-data.service.ts
@Injectable({ providedIn: 'root' })
export class <Feature>DataService {
  generateGridColumns = () => [
    { field: 'foo', title: 'Foo', type: 'text' },
    // ...
  ];
}
```

### Why `columns: any[]` not `IColumnOption[]`?

The project's `IColumnOption` interface declares `useTitleAttrYn: boolean` as **required (no `?`)**. But real columns omit it. The codebase has `strict: false` in tsconfig so it gets away with this; declaring as `any[]` avoids strict-mode complaints if/when strict mode is enabled. Generated code should also use `columns: any[]`.

---

## ng-template templates — paired with column.template strings

For every column with `template: 'fooTpl'`, the container HTML must declare `<ng-template #fooTpl>` AND the `[templates]` input must map the string to the TemplateRef.

```html
<ng-template #useYnTpl let-dataItem="dataItem" let-column="column" let-columnIndex="columnIndex">
  <input type="checkbox" [checked]="dataItem[column.field] === 'Y'" disabled />
</ng-template>

<ng-template #markupValueTpl let-dataItem="dataItem">
  {{ dataItem.markupValue | number: '1.0-2' }}%
</ng-template>

<app-grid-basis
  ...
  [templates]="{
    useYnTpl: useYnTpl,
    markupValueTpl: markupValueTpl
  }"
></app-grid-basis>
```

The wrapper exposes `let-dataItem`, `let-column`, `let-columnIndex` context vars. Access the row value via `dataItem[column.field]` or directly `dataItem.fieldName`.

---

## Excel export — pattern from bs-event (no file-saver)

oh-admin does NOT install `file-saver`. Use `URL.createObjectURL` + `<a download>` instead:

```typescript
// In effect
exportListExcel$ = createEffect(() =>
  this.actions$.pipe(
    ofType(ThisActions.exportListExcelRequest),
    withLatestFrom(this.store.pipe(select(fromModule.selectSearchCondition))),
    switchMap(([_, condition]) =>
      this.service.getListExcel(condition).pipe(
        map((blob) => {
          this._downloadBlob(blob, `list-${condition.fromDate}_${condition.toDate}.xlsx`);
          return ThisActions.exportListExcelSuccess();
        }),
        catchError((error) => {
          this._catchErr(error, 'Excel export failed.');
          return [];
        }),
      ),
    ),
  ),
);

private _downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

**Critical:** Before generating any `import` statement, check `catalog.dependencies.installed`. `file-saver` is NOT installed in oh-admin — refuse to import it.

---

## Common-sense defaults from anchor features

| Project pattern | Why |
|---|---|
| `pageSize` defaults to 20 (`bs-event`) or driven by `listPageSize$` from store | Store-managed so user preferences persist via metareducer |
| Don't generate `[pageable]` or `[sortable]` explicit — defaults work | Cleaner template |
| Grid column auto-width — don't set `width` unless plan specifies | Layout via CSS class on parent |
| `dataList` is always an Observable piped through `\| async` | Driven by NgRx selector |
| `(dbClickRowEvent)` opens edit dialog | Common UX: dblclick → open form |
| `useYn` columns use `useYnTpl` template with checkbox | Standard yes/no display |

---

## DON'T (lessons from v0.1.0)

- ❌ `[pageable]="{ buttonCount: 5, pageSizes: [25, 50, 100], info: true }"` — `pageable` is `boolean`, not object. Wraps no settings.
- ❌ `[pageSizes]="..."` or `[buttonCount]="..."` — not actual inputs.
- ❌ `width: '200px'` (string) — interface says `number`. Project never uses it anyway.
- ❌ `template: ActionCodeTpl` (TemplateRef value) — pass the **string name** + the `[templates]` map.
- ❌ `gridState: { skip: 0, take: 50, sort: [...] }` — flat shape. Use `{ pageInfo: { skip, take }, sortInfo: [...] }`.
- ❌ `columns: IColumnOption[]` strict typing — use `any[]` to match project convention.
- ❌ `<kendo-grid>` direct usage when `app-grid-basis` is in catalog. Reduces consistency.
- ❌ `<kendo-grid-excel>` for server-paged data — service-side export gives full dataset; the in-grid Kendo export only exports loaded rows.
- ❌ `from 'file-saver'` import — not installed. Use `URL.createObjectURL` pattern above.
