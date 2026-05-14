# Angular 9 — project conventions

These rules are extracted by reading oh-admin and partners. They apply to **both** projects unless noted.

## Class & file shape

| Type | Suffix | Class | Example |
|---|---|---|---|
| Component | `.component.ts` | `XxxComponent` | `bs-event.component.ts` → `BsEventComponent` |
| Module | `.module.ts` | `XxxModule` | `bs-event.module.ts` → `BsEventModule` |
| Routing module | `-routing.module.ts` | `XxxRoutingModule` | `bs-event-routing.module.ts` |
| Service | `.service.ts` | `XxxService` | `bs-event-api.service.ts` |
| Models file | `.model.ts` / `.models.ts` | n/a | `bs-event.models.ts` |
| Actions | `<feature>.actions.ts` | n/a | `bs-event.actions.ts` |
| Reducer | `<feature>.reducer.ts` | n/a | `bs-event.reducer.ts` |
| Effects | `<feature>.effects.ts` | `XxxEffects` | `bs-event.effects.ts` |

**No standalone components.** Angular 9 has no standalone API. Every component must be declared in an `@NgModule`.

## Identifier conventions

- **Interface** — `I` prefix, PascalCase: `IUser`, `IPaymentEntity`, `IBookingCancelRequest`. Always use `interface`, not `type`, for data models.
- **Observable property** — `$` suffix: `users$`, `loading$`, `selectedRow$`.
- **Private property** — leading underscore: `private _unsubscribe$`, `private _data`.
- **Component class property order**: private → public → @Input → @Output → getter/setter → constructor → @ngOnInit → other lifecycle → public methods → private methods.
- **Enum** — UPPER_SNAKE for the type, UPPER_SNAKE for values: `enum DEPOSIT_FORM_TYPE { DETAILS = 'DETAILS', REGISTER = 'REGISTER' }`.

## Folder / file naming

- **Kebab-case** for everything filesystem-related: folders, file names, route paths.
- Files inside `routes/<feature>/` follow `<feature>.<role>.ts` — e.g. `bs-event.reducer.ts` (not `reducer.ts` plain).
- Sub-components inside a feature follow `<feature>-<sub>.component.ts` — e.g. `bs-event-form.component.ts`.

## Imports order (top of file)

```typescript
// 1. Angular core
import { Component, OnInit } from '@angular/core';

// 2. Third-party
import { Store } from '@ngrx/store';
import * as _ from 'lodash';

// 3. Internal absolute (src/app/...)
import { ApiService } from 'src/app/core/services/api/api.service';

// 4. Same-feature relative
import { ThisActions } from '../actions';
import { IUser } from '../models';
```

Section headers (`// services`, `// models`, `// ngrx`) are common — preserve when generating.

## Component class structure

```typescript
@Component({
  selector: 'app-<feature-kebab>',
  templateUrl: './<feature>.component.html',
  styleUrls: ['./<feature>.component.css'],   // .css not .scss when matching project default
})
export class FeatureComponent implements OnInit, OnDestroy {
  // 1. Private fields
  private _unsubscribe$: Subject<void> = new Subject();

  // 2. Public observable bindings (from store)
  list$: Observable<IItem[]> = this.store.pipe(select(selectList));
  loading$: Observable<boolean> = this.store.pipe(select(selectLoading));

  // 3. Public state
  form: FormGroup;

  // 4. @Input / @Output (presentational only)
  @Input() data: IItem;
  @Output() rowClick = new EventEmitter<IItem>();

  constructor(
    private store: Store,
    private fb: FormBuilder,
  ) {}

  ngOnInit(): void { ... }

  ngOnDestroy(): void {
    this._unsubscribe$.next();
    this._unsubscribe$.complete();
  }
}
```

## Forms

- **Reactive Forms only** — never use `[(ngModel)]` in routes/. (Templates module has `FormsModule` imported but stays for legacy.)
- `FormBuilder` always injected.
- Validators: built-in (`Validators.required`, `Validators.pattern`) plus custom in `shared/services/validators.service.ts` if needed.
- Form value patched via `patchValue` not `setValue` (more forgiving with partial state).

## Korean input quirk (BOTH projects)

`app.module.ts` sets `COMPOSITION_BUFFER_MODE: false` — required so Korean IME doesn't break two-way binding. Don't regress this.

## Build memory

Both projects need `--max_old_space_size=8048` for `ng build` and `ng serve` to avoid OOM. All scripts in `package.json` already include this. Don't strip the flag.

## DON'T

- ❌ Standalone components (Angular 14+)
- ❌ Inject() function (Angular 14+) — use constructor DI
- ❌ Signals API (Angular 16+) — use RxJS Observables
- ❌ `private readonly store = inject(Store)` — use constructor
- ❌ Switch from `.css` to `.scss` at component level unless the existing module uses `.scss`
- ❌ Add `BrowserAnimationsModule` to feature modules — it's a root-only module
- ❌ Inline templates for non-trivial components — separate `.html` file
