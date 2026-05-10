# Stack knowledge — Angular

Read this when `manifest.stack.framework === "angular"`. Especially relevant for oh-admin–style enterprise admins (Angular 9+ with Kendo / NgRx / ng-select).

## How styles flow at build time (and why source files mislead you)

- Angular's default ViewEncapsulation is `Emulated`: each component template gets a unique `_nghost-c-X` attribute and child elements get `_ngcontent-c-X`. The CLI rewrites every selector in `.component.scss` to include `[_ngcontent-c-X]` so the styles only match that component.
- This means the **same `.btn` selector** in `_buttons.scss` (global) and inside `Button.component.scss` (encapsulated) end up with different reach in the running app. The global one wins for non-Angular markup; the encapsulated one wins inside the component's view.
- A static prototype runs **without** the encapsulation rewrite. So:
  - Global SCSS partials (`_buttons.scss`, `_form.scss`, `_layout.scss`, `_table.scss`) are the most useful — they apply unconditionally.
  - Component SCSS files often look like `:host { display: block } .btn { ... }` — the `:host` only makes sense inside the component view. Strip `:host { ... }` wrappers entirely; their inner rules become root rules in the prototype.
  - `::ng-deep` is a leakage operator that disables encapsulation. Remove the `::ng-deep` keyword and keep the rest of the selector.
  - `[_ngcontent-...]` and `[_nghost-...]` attribute selectors should be dropped entirely.
  - `:host-context(...)` only matches when the component is rendered inside an ancestor matching the selector — usually safe to drop the wrapper and keep the inner rules, with a comment.

## Variable naming convention quirks

- Many Angular admins (Korea-built, oh-admin–lineage) use `$--name` (double-leading-dash) SCSS variables, e.g. `$--primary: #96ddf2`, `$--xs: 24px`. The plugin's crawl-styles already handles this, but if you write CSS yourself, remember the leading `--` is part of the SCSS variable name, NOT a CSS custom-property prefix.
- A separate `:root` block in the same project holds proper CSS custom properties (`--primary`, `--theme-color1`...). These ARE the runtime tokens — prefer them over the SCSS sources when both exist.

## Multi-theme system (data-theme attribute)

Angular admin templates often ship 3-4 named themes selected at runtime via `document.documentElement.setAttribute('data-theme', name)`. Variants typically live in CSS as:

```css
:root { /* default theme */ }
html[data-theme=basic] { /* override */ }
html[data-theme=sky] { /* override */ }
```

The detector picks `themeList[0]` from `theme.component.ts` as the default. Pass `--theme-variant <name>` to crawl-styles so the active variant overlays `:root`. Never assume `:root` alone is correct — it's often the dark variant by default.

## Common admin layout class names (oh-admin style — match by name when possible)

| Region | Class |
|---|---|
| Body wrap | `.page-wrap` |
| Inner flex | `.page-inner` |
| Sidebar | `.page-sidebar` (width 215px) |
| Logo bar | `.page-logo` (height 50px, bg `var(--primary)`) |
| Sidebar nav | `.nav-menu`, `.nav-filter`, `.nav-search-input` |
| Topbar | `.page-header` (height 50px) |
| Tab card | `.tab-bar`, `.tab.active` |
| Filter region | `.filter-area`, `.filter-grid` |
| Grid | `.k-grid` (Kendo), `.k-grid-scroll`, `.row-line2` |
| Pagination | `.pagination`, `.page-num.active`, `.summary` |
| Buttons | `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, with size modifiers `.xs`, `.md`, `.lg` (height 24/38/50px) |
| Inputs | `.input` wrap with `.search`, `.calendar` modifiers |
| Status (NOT badges) | `.status-confirmed`, `.status-cancelled` etc. — plain colored TEXT |

When you find these in `globalStyles` or `componentStyles`, use them by name in the prototype. The CSS already exists.

## Kendo Angular component patterns

- `kendo-grid` — multi-row cells with `<span class="row-line2">` for the secondary line. Header cells separated by 1px right border. Sort indicators are CSS pseudo-elements, not extra DOM. Hover row gets `#f9f9f9`.
- `kendo-dropdownlist`, `kendo-combobox` — text input + caret button pattern. Border becomes primary on focus.
- `kendo-datepicker` — text input + calendar icon pattern.
- `kendo-window` (modal) — fixed dialog with `.k-window-titlebar` + `.k-window-content`.

When the source uses Kendo components, the prototype should mirror class names (`.k-grid`, `.k-window`, `.k-button`) so a dev opening the prototype recognizes the patterns.

## ng-select

`<ng-select>` renders as `<div class="ng-select">` with `<div class="ng-select-container">` inside. When you see ng-select in templates, render a styled `<select>` with a custom caret — close enough for static prototypes.

## NgRx hints

If components import from `@ngrx/store` or use `select(...)` operators, they're NOT presentational. The crawl-components classifier already flags these as `business`. Don't include them when generating a static prototype — the data flow won't be reproducible without the store.

## Form patterns

- `[(ngModel)]` — two-way binding. In a static prototype, render a plain `<input>` with `value="..."` and `name="..."`.
- `formGroup` + `formControlName` — reactive forms. Same treatment: plain inputs.
- `<button type="button" (click)="..">` — strip `(click)` handlers; replace with `onclick="alert('(prototype) ...')"` or a navigation `<a>`.

## Icon and brand assets — detect, don't assume

Angular admin templates rarely use Lucide. The most common patterns:

- **FontAwesome** (oh-admin, most KR/JP enterprise admins) — `<i class="fas fa-desktop"></i>`. Loaded via `@fortawesome/fontawesome-free` package + a global SCSS `@import "~@fortawesome/.../all.min.css"`.
- **Material Icons** (Angular Material projects) — `<mat-icon>home</mat-icon>` or `<span class="material-icons">home</span>`.
- **PrimeIcons** (PrimeNG projects) — `<i class="pi pi-home"></i>`.
- **Custom PNG/SVG sprites** — `<img src="/assets/images/icons/ico-bed.svg">`. Many older Korean admin templates use this pattern with `ico-*.png` and `ico-*.svg` files in `assets/images/icons/`.

The plugin runs `detect-icons.mjs` to figure this out. Read `manifest.stack.iconLibrary` and `manifest.brand.logo` before generating the prototype:
- For oh-admin specifically: `iconLibrary === "fontawesome"`, brand logo at `src/assets/images/common/header-logo-white.png`.
- Use FontAwesome class names that appear in `icon-detection.json` `iconSamples` (real names from real templates) when picking icons for the prototype's nav and toolbars.
- Render the brand logo as `<img>` when the file is in `assets/`. The text-logo fallback ("OOHMYHOTEL&CO" with cyan accent) is only when no PNG/SVG logo was detected.

## Sidebar nav structure (oh-admin pattern)

The real oh-admin sidebar has TWO sections:

1. **Favorites** (top, with star icon header) — flat list of starred menu items, each highlighted with `class="active has-dot"` (cyan dot) when current. The dot is a `::before` pseudo-element with `position: absolute; right: 18-22px`.

2. **Domain groups** (below Favorites) — each rendered as `<app-layout-sidebar-menu-group>` with:
   - Group title row: FontAwesome icon (`fa-desktop` for Bookings, `fa-hotel` for Products, `fa-plane-departure` for Marketing, `fa-briefcase` for Users, `fa-cogs` for Settlement) + group name + chevron-up/down on the right
   - Expandable subgroup body with nested items
   - 8 default groups: **Bookings / Products / Marketing / Users / Settlement / Flight DSR/BSP / System Control / Statistics**

When generating the admin shell:
- Read `manifest.stack.routes` to seed the menu items, but ALSO read the actual `app-layout-sidebar-menu-group` template if present in source (`grep "app-layout-sidebar-menu-group" src/`).
- Use FontAwesome icons matching each group's domain.
- Even if the prototype only highlights ONE menu item as active, render the full 8 groups so the prototype looks like a real admin shell, not a stub.

## Dialog / modal patterns — most admin actions open overlays, not new pages

Angular admins rarely use route-based navigation for create/edit/detail flows. Instead they have a **state-driven dialog pattern**:

```html
<!-- Container template -->
<button (click)="openDetailPopup()">New</button>

<app-dialog
  header="Hotel Master"
  [visible]="isOpenDetailPopup$ | async"
  modalSize="lg"
  [modal]="true"
  (visibleChange)="closeUpsertHandler()">
  <app-hotel-detail [data]="..."></app-hotel-detail>
</app-dialog>
```

The container holds an observable like `isOpenDetailPopup$` whose value gates the dialog. Click → service flips the observable to `true` → dialog renders. Close → flips back. NO route change, NO new URL.

**oh-admin's `<app-dialog>` attributes:**
- `header="..."` — title text shown in titlebar
- `modalSize="sm" | "md" | "lg" | "xl"` — width preset (oh-admin sm=480, md=720, lg=1080, xl=90vw)
- `modalContentClass="pd-all"` — adds padding to content
- `[visible]="...$ | async"` — show/hide gate
- `[modal]="true"` — backdrop blocks page interaction
- `[hasScroll]="false"` — disables internal scroll for short dialogs
- `[closable]="false"` — removes the X close button (forced flow)

**For prototypes**: read `dialog-detection.json` for the feature route — every header listed there is a flow that should appear in the prototype as an overlay overlay (not a separate page). The button that opens it is usually:
- In the same component as the dialog declaration (search the container's `.ts` for `openXxxPopup` / `Subject<boolean>`)
- A toolbar button with a label matching the dialog header (e.g. "New" → "Hotel Master", "Contents Mapping" → "Hotel Contents Mapping")

The control component (e.g. `*-control.component.html`) typically has the buttons that open these dialogs. Read it to confirm the trigger labels.

**Toasts in oh-admin** are usually `alertService.alert(msg)` (custom Angular service) or `window.alert(msg)`. Render the prototype's submit-success feedback as a toast that briefly appears at bottom-right with the same tone as the source samples in `dialog-detection.json` `toasts.samples`.

## What the agent should do when reading source-index.json for an Angular project

For ANY feature, navigate this way (most expensive last):

1. Read `themeFiles` first — `base-theme.scss`, `basic-theme.scss`, `*-theme.css`. Tokens live here.
2. Read `globalStyles` next, biggest first — `_layout.scss` (43KB in oh-admin), `_form.scss`, `_buttons.scss`, `_components.scss`, `_table.scss`. These define every class name the rest of the app uses.
3. **Use `routeGroups[<feature-route-name>]` to get the FEATURE files in one query.** Example: building `hotel-content-management` → query `routeGroups['ho-hotel-contents']` → returns templates / components / services for that feature only. Don't filter the global `templates` bucket of 1000+ files — that wastes tokens.
4. From the feature's templates, read the **container** first (e.g. `*-master.component.html`) — it composes the smaller pieces (`<app-foo-search>`, `<app-foo-grid>`, `<app-foo-control>`).
5. Then read the grid/list template — Kendo `<kendo-grid-column field="...">` tags reveal the EXACT columns the real product uses. Don't invent columns.
6. Read the search/filter template — `formGroupName="dateRange1"` + `formControlName="hotelCode"` reveal the EXACT filter fields. Don't invent fields.
7. When templates reference dynamic data (`*ngFor="let x of resultArray"`), grep for `resultArray` in the feature's `services/` folder. The service often has hardcoded label arrays (e.g. oh-admin's `contents-mapping-data.service.ts` has 62 mapping row labels).
8. Read at most 3-5 `componentStyles` files for the feature only if you need component-specific tweaks beyond what `globalStyles` covers.
9. **Custom tag resolution:** when you see an unfamiliar tag like `<app-layout-sidebar-menu-group>` in a feature template, look up `componentBySelector['app-layout-sidebar-menu-group']` to find the component file. Then read that file to understand how the tag is composed.
10. SKIP HTML demo pages (`src/app/html/...`) — they're internal style-guide samples, not real screens.

**Crucially: read source from `{themeDir}/source-copy/...`, NOT from the dev's machine.** The plugin copies all framework source files into the export so you can read them without source-repo access.
