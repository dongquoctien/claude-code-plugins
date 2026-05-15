# Mock-switch pattern

The plugin wires every feature's API service behind an Angular `InjectionToken` so the choice between real and mock is one flag, not a code change.

## Generated artifacts

For a feature whose real service is `XxxApiService`, `/aad-mock` produces:

```
{routesPath}/{feature}/
├── services/
│   ├── xxx-api.service.ts                        // existing — real
│   ├── xxx-api.service.interface.ts              // NEW — shared interface
│   ├── xxx-api-mock.service.ts                   // NEW — mock implementation
│   └── xxx-api.token.ts                          // NEW — InjectionToken<I...>
mocks/{feature}/
├── <endpoint-id>.json                            // one captured/synthetic per endpoint
└── _manifest.json                                // metadata (which is captured, which is synthetic)
```

And edits:

```
{feature}.module.ts                               // providers[] adds the token-based factory
```

## Files in detail

### `xxx-api.service.interface.ts`

Lifts the real service's public surface into an interface so both implementations satisfy the same contract.

```typescript
import { Observable } from 'rxjs';
import {
  IHardblockHistoryItem,
  IHardblockHistorySearchCondition,
  IHardblockActionOption,
} from '../models';

export interface IAdHardblockAllotmentHistoryApiService {
  getHardblockHistory(condition: IHardblockHistorySearchCondition): Observable<{ dataList: IHardblockHistoryItem[]; totalCount: number }>;
  exportHardblockHistoryExcel(condition: IHardblockHistorySearchCondition): Observable<Blob>;
  lookupHardblockActionCodes(): Observable<IHardblockActionOption[]>;
  autocompleteHotel(keyword: string): Observable<any[]>;
  loadRoomTypesByHotel(hotelCode: string): Observable<any[]>;
}
```

### `xxx-api.token.ts`

```typescript
import { InjectionToken } from '@angular/core';
import { IAdHardblockAllotmentHistoryApiService } from './ad-hardblock-allotment-history-api.service.interface';

export const AD_HARDBLOCK_ALLOTMENT_HISTORY_SERVICE_TOKEN =
  new InjectionToken<IAdHardblockAllotmentHistoryApiService>('AD_HARDBLOCK_ALLOTMENT_HISTORY_SERVICE');
```

### `xxx-api-mock.service.ts`

```typescript
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';

import { IAdHardblockAllotmentHistoryApiService } from './ad-hardblock-allotment-history-api.service.interface';
import {
  IHardblockHistoryItem,
  IHardblockHistorySearchCondition,
  IHardblockActionOption,
} from '../models';

@Injectable({ providedIn: 'root' })
export class AdHardblockAllotmentHistoryApiMockService implements IAdHardblockAllotmentHistoryApiService {
  // Per-feature mock root — fixtures live under mocks/<feature>/.
  private static readonly fixturesRoot = 'assets/mocks/ad-hardblock-allotment-history';

  constructor(private http: HttpClient) {}

  getHardblockHistory(condition: IHardblockHistorySearchCondition) {
    return this.http
      .get<{ dataList: IHardblockHistoryItem[]; totalCount: number }>(
        `${AdHardblockAllotmentHistoryApiMockService.fixturesRoot}/get-history.json`,
      )
      .pipe(delay(200));
  }

  exportHardblockHistoryExcel(_condition: IHardblockHistorySearchCondition): Observable<Blob> {
    // Return a tiny binary stub — real production blob lives behind the real API.
    const stub = new Blob(['mock-excel'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    return of(stub).pipe(delay(200));
  }

  lookupHardblockActionCodes() {
    return this.http
      .get<IHardblockActionOption[]>(`${AdHardblockAllotmentHistoryApiMockService.fixturesRoot}/lookup-action-codes.json`)
      .pipe(delay(150));
  }

  autocompleteHotel(_keyword: string) {
    return this.http
      .get<any[]>(`${AdHardblockAllotmentHistoryApiMockService.fixturesRoot}/autocomplete-hotel.json`)
      .pipe(delay(120));
  }

  loadRoomTypesByHotel(_hotelCode: string) {
    return this.http
      .get<any[]>(`${AdHardblockAllotmentHistoryApiMockService.fixturesRoot}/room-types.json`)
      .pipe(delay(150));
  }
}
```

Two important behaviors:

1. **Fixtures live under `src/assets/mocks/<feature>/`** (Angular's asset pipeline serves them at runtime). The `mocks/` directory at project root is where dev keeps **source** fixtures; `aad-mock` copies them to `src/assets/mocks/` so the dev server can serve them.
2. **No query-param filtering** — mock returns the whole fixture. Reasonable: P4 is "feature runs end-to-end without backend", not "fully simulate backend pagination". If the dev wants paged/filtered mocks they layer that on after.

### `{feature}.module.ts` providers wiring

Add to existing module file:

```typescript
import { AdHardblockAllotmentHistoryApiService } from './services';
import { AdHardblockAllotmentHistoryApiMockService } from './services/ad-hardblock-allotment-history-api-mock.service';
import { AD_HARDBLOCK_ALLOTMENT_HISTORY_SERVICE_TOKEN } from './services/ad-hardblock-allotment-history-api.token';
import { environment } from 'src/environments/environment';

@NgModule({
  // ... existing imports[] ...
  providers: [
    {
      provide: AD_HARDBLOCK_ALLOTMENT_HISTORY_SERVICE_TOKEN,
      useClass: environment.mockMode
        ? AdHardblockAllotmentHistoryApiMockService
        : AdHardblockAllotmentHistoryApiService,
    },
  ],
})
```

**Type-safety note (v0.4.0):** Use `environment.mockMode` directly — NOT `(environment as any).mockMode`. The `aad-mock` skill's Step 9 ensures **every** `src/environments/environment.*.ts` file declares the `mockMode` property (even if just `mockMode: false`), so TypeScript structural typing sees it on every build configuration.

If you find yourself wanting to cast `(environment as any)`, that's a signal `aad-mock` Step 9 didn't run on all env files. Re-run `/aad-mock <feature>` first.

### Effects rewiring

Effects must inject the **token**, not the concrete class:

```typescript
import { Inject } from '@angular/core';
import { AD_HARDBLOCK_ALLOTMENT_HISTORY_SERVICE_TOKEN } from '../services/ad-hardblock-allotment-history-api.token';
import { IAdHardblockAllotmentHistoryApiService } from '../services/ad-hardblock-allotment-history-api.service.interface';

constructor(
  private actions$: Actions,
  @Inject(AD_HARDBLOCK_ALLOTMENT_HISTORY_SERVICE_TOKEN)
  private service: IAdHardblockAllotmentHistoryApiService,
  private _errorService: ErrorHandlerService,
  private store: Store<fromModule.State>,
) {}
```

This is the only edit `/aad-mock` makes to existing generated code — the rest is additive.

## Environment flag

`/aad-mock` ensures every `src/environments/environment.*.ts` has a `mockMode` property:

```typescript
export const environment = {
  production: false,
  env: 'dev',
  API_URL: '...',
  mockMode: false,  // ← added if missing
  // ... existing fields ...
};
```

Default is `false` everywhere except `environment.local.ts`, where the plugin sets `true` (so devs running `npm run serve` get mocks out of the box).

## `/aad-switch` behavior

`aad-switch <feature> --on|--off`:

- `--on`  → set `mockMode: true`  in `environment.local.ts` (and any env file `aad-switch` was told to target)
- `--off` → set `mockMode: false` in same target

It does NOT edit non-`local` env files unless `--env <name>` is passed. Prod must never silently flip to mocks.

Plus: prints the feature's current state (mock vs real) by parsing the relevant `environment.*.ts`.

## Fixture sourcing (for `aad-mock`)

For each `plan.endpoints[]`:

1. Check `{projectRoot}/mocks/<feature>/<endpoint-id>.json` — if present, treat as **captured** and copy to `src/assets/mocks/<feature>/`.
2. Else, generate **synthetic** from the response interface (using `catalog.models` lookups):
   - Arrays get 3-5 items by default.
   - Strings get plausible values (Vietnamese names if `workingLanguage=vi`, English otherwise).
   - Numbers get plausible business values (qty: 5-50, price: 100000-2000000).
   - Dates get values from the last 30 days.
3. Wrap in the project's response envelope if known (`{ succeedYn: true, result: {...} }` for oh-admin).

Mark synthetic data with a top-level `_synthetic: true` field so dev can spot it and replace later.
