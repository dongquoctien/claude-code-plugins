# Shared modules — when to use what

When reuse-mapper picks a shared component, codegen must know how to wire it. This is a quick reference for the 37 components in oh-admin (33 in partners — subset). For exact selectors and Inputs, **always** check `component-catalog.json` for the project being generated.

## Form controls (CVA — usable in reactive forms)

| Selector | Class | Best for | Key Inputs |
|---|---|---|---|
| `app-input-text` | `InputTextComponent` | text/number/email/password | `type`, `placeholder`, `maxLength`, `disabled` |
| `app-input-text-suggestion` | `InputTextSuggestionComponent` | text with suggest dropdown | `options`, `searchTerm` |
| `app-span-input` | `SpanInputComponent` | inline editable label | `editable` |
| `app-dropdown` | `DropdownComponent` | single-select static options | `options`, `optionLabel`, `optionValue` |
| `app-selectbox` | `SelectboxComponent` | single-select w/ dataKey/displayKey | `options`, `dataKey`, `displayKey` |
| `app-selectbox-2` | `Selectbox2Component` | newer dropdown variant | (project-specific) |
| `app-selectbox-detailcode` | `SelectboxDetailcodeComponent` | system-code-driven single select | `groupCode`, `useAllOption` |
| `app-multi-select` | `MultiSelectComponent` | multi-select static options | `options`, `displayKey`, `selectionLimit` |
| `app-multi-select-detailcode` | `MultiSelectDetailcodeComponent` | system-code-driven multi-select | `groupCode`, `useAllOptionYn` |
| `app-auto-complete` | `AutoCompleteComponent` | async-search suggest | `apiUrl`, `apiCondition`, `apiSearchTerm`, `searchResultPath`, `(completeMethod)`, `(onSelect)` |
| `app-checkbox` | `CheckboxComponent` | single checkbox | `label`, `disabled` |
| `app-radio` | `RadioComponent` | radio group | `options`, `displayKey` |
| `app-datepicker` | `DatePickerComponent` | single date | `format`, `minDate`, `maxDate` |
| `app-date` | `DateComponent` | single date alt | (project-specific) |
| `app-calendar` | `CalendarComponent` | date / **daterange** | `selectionMode: 'single' \| 'range'`, `dateFormat`, `rangeSeparator`, `defaultDate` |
| `app-month-picker` | `MonthPickerComponent` | month/year picker | `format`, `minDate`, `maxDate` |
| `app-slider` | `SliderComponent` | numeric range slider | `min`, `max`, `step` |
| `app-editor` | `EditorComponent` | rich-text WYSIWYG | `mode`, `disabled` |
| `app-file-upload` | `FileUploadComponent` | file picker | `accept`, `multiple`, `(onFileUpload)` |

## Grids

| Selector | Class | Best for |
|---|---|---|
| `app-grid-basis` | `GridBasisComponent` | full-featured: sort/page/filter/templates (default choice) |
| `app-grid-simple` | `GridSimpleComponent` | small static grids (dialogs, summaries) |
| `app-grid-virtual` | `GridVirtualComponent` | very long lists (>1000 rows) — virtual scroll |
| `app-grid-row-reorderable` | `GridRowReorderableComponent` | drag-to-sort tables |

See `kendo-grid-patterns.md` for templating.

## Dialogs

| Selector | Class | Best for |
|---|---|---|
| `app-dialog` | `DialogComponent` | inline modal (declarative, ng-content) |
| `app-dynamic-dialog` | `DynamicDialogComponent` | service-opened modal (imperative) |
| `app-alert` | `AlertComponent` | confirm / warn (use `ConfirmationService.confirm({...})`) |

## Layout

| Selector | Class | Best for |
|---|---|---|
| `app-tabs` | `TabsComponent` | sub-section tabs in a screen |
| `app-tab-group` | `TabGroupComponent` | top-level tab navigation |
| `app-tab-menu` | `TabMenuComponent` | tab strip variant |
| `app-paginator` | `PaginatorComponent` | standalone pager (rare — grid usually paginates) |

## Other

| Selector | Class | Best for |
|---|---|---|
| `app-region-cascade` | `RegionCascadeComponent` | country → city → district cascade |
| `app-photo-drag-drop` | `PhotoDragDropComponent` | image upload w/ preview |
| `app-image-shimmer` | `ImageShimmerComponent` | image with loading skeleton |
| `app-loading-icon-checked` | `LoadingIconCheckedComponent` | status icon |

## When NONE of these fit

Decide between:

1. **`use-kendo`** — if the gap is filled by a Kendo Angular component the project already has installed. Check `catalog.kendo.modules`.
2. **`create-feature-component`** — if the missing piece is feature-specific (validation tied to business rules, layout coupled to one screen). Lives in `routes/<feature>/components/`.
3. **`needs-new-shared`** — if it's clearly reusable elsewhere. **Flag for human review**: the dev should sponsor the new shared module, codegen does not silently create files under `shared/`.

When generating a feature, always **import the SharedModule** that exposes the component, not the component class directly:

```typescript
import { DropdownModule } from 'src/app/shared/modules/dropdown/dropdown.module';
// in module imports[]: DropdownModule
```

The class is imported only in TypeScript code that programmatically references it (rare).
