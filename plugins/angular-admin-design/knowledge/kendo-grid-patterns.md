# Kendo Grid + shared `grid-basis` — usage patterns

Both projects use `@progress/kendo-angular-grid` v4.7.x (Angular 9-compatible). They wrap it in `shared/modules/grid-basis` (most common) and `grid-simple`. Codegen should prefer the wrapper unless the catalog says otherwise.

## Decision rule (already in reuse-mapper)

1. `result-grid` section → `GridBasisComponent` (`app-grid-basis`) if present in catalog.shared. (Both oh-admin and partners ship it.)
2. Small read-only grids (e.g. dialog detail tables) → `GridSimpleComponent`.
3. Direct `<kendo-grid>` only when neither wrapper fits — rare.

## `<app-grid-basis>` template skeleton

```html
<app-grid-basis
  [columns]="columns"
  [dataList]="list$ | async"
  [gridState]="gridState$ | async"
  [gridLoading]="loading$ | async"
  [sortable]="true"
  [pageable]="{ buttonCount: 5, pageSizes: [25, 50, 100], info: true }"
  [pageSize]="50"
  (stateChangeEvent)="onGridStateChange($event)"
>
  <!-- column templates if needed -->
  <ng-template #actionCodeTpl let-row="row">
    {{ row.actionCode | detailCode: 'HARDBLOCK_ACTION' }}
  </ng-template>
</app-grid-basis>
```

## Columns in the container .ts

```typescript
import { IColumnOption } from 'src/app/shared/modules/grid-basis/grid-basis.model';

readonly columns: IColumnOption[] = [
  { field: 'hotelName',     title: 'history.column.hotelName',     width: '200px', sortable: true },
  { field: 'roomTypeName',  title: 'history.column.roomTypeName',  width: '160px', sortable: true },
  { field: 'actionCode',    title: 'history.column.actionCode',    width: '120px', sortable: true, template: 'actionCodeTpl' },
  { field: 'oldQty',        title: 'history.column.oldQty',        width: '100px', sortable: true, type: 'number' },
  { field: 'newQty',        title: 'history.column.newQty',        width: '100px', sortable: true, type: 'number' },
  { field: 'reason',        title: 'history.column.reason' },  // no width = flex
  { field: 'changedByName', title: 'history.column.changedByName', width: '160px', sortable: true },
  { field: 'changedAt',     title: 'history.column.changedAt',     width: '180px', sortable: true, type: 'date' },
];
```

`title` is the i18n key — the wrapper resolves it through the project's translate pipe.

## Grid state handler (container)

```typescript
onGridStateChange(state: any): void {
  this.store.dispatch(ThisActions.setGridStateAction({ gridState: state }));
  this.store.dispatch(ThisActions.loadList({ condition: { ...this.currentSearchCondition, ...state } }));
}
```

The state object Kendo emits has `skip`, `take`, `sort: SortDescriptor[]`, `filter: CompositeFilterDescriptor`. Pass through to backend — most project APIs accept this shape directly.

## Pageable presets

| Use case | `pageSize` | `pageSizes` |
|---|---|---|
| Long lists (history, audit, logs) | 50 | [25, 50, 100] |
| Master lists (events, hotels) | 25 | [25, 50, 100] |
| Pop-up tables | 10 | hidden (set `pageable={ pageSizes: false }`) |

## Excel export

Reserve a separate effect that calls `service.getListExcel(condition).subscribe(blob => saveAs(blob, filename))`. Don't try to use Kendo's built-in `<kendo-grid-excel>` — service-side export gives the full dataset, Kendo's built-in only exports what's loaded.

```typescript
exportExcel$ = createEffect(
  () =>
    this.actions$.pipe(
      ofType(ThisActions.exportHistoryExcelRequest),
      withLatestFrom(this.store.pipe(select(fromModule.selectListSearchCondition))),
      switchMap(([_, condition]) =>
        this.service.getListExcel(condition).pipe(
          map((blob) => ThisActions.exportHistoryExcelSuccess({ blob })),
          catchError((error) => of(ThisActions.exportHistoryExcelFailure({ error }))),
        ),
      ),
    ),
  { dispatch: true },
);
```

In the container, subscribe to a `*Success` action and trigger the actual file download with `file-saver`'s `saveAs`.

## DON'T

- ❌ `<kendo-grid>` directly when `app-grid-basis` is present in catalog — reduces consistency.
- ❌ Bind `[data]` to a raw array — use `dataList$ | async` so re-renders match store updates.
- ❌ Skip `[gridState]` — without it sort/page changes don't persist across re-loads.
- ❌ Use Kendo `<kendo-grid-excel>` for server-paged data.
