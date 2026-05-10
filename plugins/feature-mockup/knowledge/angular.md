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

## What the agent should do when reading source-index.json for an Angular project

1. Read `themeFiles` first — `base-theme.scss`, `basic-theme.scss`, `*-theme.css`. Tokens live here.
2. Read `globalStyles` next, biggest first — `_layout.scss` (43KB in oh-admin), `_form.scss`, `_buttons.scss`, `_components.scss`, `_table.scss`. These define every class name the rest of the app uses.
3. Read `templates` for the FEATURE you're prototyping (filter by route folder name) — see how the team composes screens.
4. Read at most 3-5 `componentStyles` files matching the route, only if needed for component-specific tweaks.
5. SKIP HTML demo pages (`src/app/html/...`) — they're internal style-guide samples, not real screens.
