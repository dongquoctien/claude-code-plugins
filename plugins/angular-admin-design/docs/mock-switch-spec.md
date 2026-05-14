# Mock-switch spec

How the plugin makes a generated feature run end-to-end without backend, and how it lets the dev flip to real API without changing the feature's code.

## Core idea: one InjectionToken per feature service

Every feature has a real API service (`<Feature>ApiService`). After `/aad-mock`, the feature additionally has:

1. **Service interface** — `I<Feature>ApiService` — captures the public method signatures of the real service.
2. **InjectionToken** — `<FEATURE_UPPER>_SERVICE_TOKEN: InjectionToken<I<Feature>ApiService>`.
3. **Mock service** — `<Feature>ApiMockService implements I<Feature>ApiService`. Reads fixture JSON from `src/assets/mocks/<feature>/`.
4. **Module provider** — `{ provide: TOKEN, useClass: environment.mockMode ? Mock : Real }`.
5. **Effects rewire** — constructor changes from `private service: <Feature>ApiService` to `@Inject(TOKEN) private service: I<Feature>ApiService`.

The flip is just `environment.mockMode = true|false`. Effects, components, containers — none change.

## File layout after `/aad-mock`

```
src/app/routes/<feature>/
├── services/
│   ├── <feature>-api.service.ts                  [unchanged — real impl]
│   ├── <feature>-api.service.interface.ts        [new]
│   ├── <feature>-api.token.ts                    [new]
│   ├── <feature>-api-mock.service.ts             [new]
│   └── index.ts                                   [edited — exports new files]
├── <feature>.module.ts                            [edited — providers[] added]
└── effects/<feature>.effects.ts                  [edited — @Inject(TOKEN)]

mocks/<feature>/                                   [source — committed]
├── <endpoint-id>.json                             [captured or _synthetic]
└── _manifest.json                                 [provenance]

src/assets/mocks/<feature>/                       [runtime copy — served by Angular]
└── <endpoint-id>.json
```

## Fixture sourcing

For each `plan.endpoints[]`, `aad-mock` decides:

1. **Captured** — if `{projectRoot}/mocks/<feature>/<endpoint-id>.json` exists on disk, use it. Copy to `src/assets/mocks/<feature>/`.
2. **Synthetic** — else, AI generates a fixture from the response interface (`plan.endpoints[*].responseModel` → look up in `catalog.models`).
   - Strings get plausible business values (Vietnamese names if `workingLanguage=vi`).
   - Numbers / dates / arrays get sensible defaults.
   - Synthetic fixtures are tagged at the top:
     ```json
     {
       "_synthetic": true,
       "_generatedAt": "...",
       "_warning": "AI-synthesized data. Replace with a captured response before staging.",
       "succeedYn": true,
       "result": { ... }
     }
     ```

When the dev later captures a real response, they paste it into `mocks/<feature>/<endpoint-id>.json` and re-run `aad-mock` (or just copy by hand to `src/assets/mocks/`).

## Response-envelope handling

Real services typically check `res.succeedYn && res.result` and unwrap (`res.result.list`, `res.result.totalCount`). The mock service mirrors this so call sites don't see a different shape:

```typescript
// Mock service method body
return this.http.get<WrappedListResponse<T>>('.../endpoint.json').pipe(
  delay(200),
  switchMap((res) => {
    if (res && res.succeedYn) {
      const list = res.result?.list ?? res.list ?? [];
      const totalCount = res.result?.totalCount ?? res.totalCount ?? 0;
      return of({ dataList: this._addRowid(list), totalCount });
    }
    return throwError(res || 'mock response error');
  }),
);
```

Fixtures themselves include the wrapped envelope. This means a dev can drop a real captured response in `mocks/<feature>/` and the mock service unwraps it exactly the same way as production.

## Network delays

Each endpoint declares a `delayMs` (default 200). Reads use 120-200ms (autocomplete cheap, list slower); writes can go higher. The point is to make `loading$` states visible — without delay the spinner never appears and the UI feels suspicious.

## What the mock service DOES NOT do

- ❌ Filter / sort / paginate based on query params. `aad-mock` returns the whole fixture every time. Each method has a `// MOCK: returns full fixture regardless of <param>` comment so dev knows.
- ❌ Mutate state between calls. `POST /create` doesn't make `GET /list` return one extra row. (If you need this, hand-edit the mock service post-generation.)
- ❌ Simulate errors. Every mock method returns success. To test error paths, manually edit the mock to `throwError` for a specific call.

## Environment flag layout

`/aad-mock` ensures every `src/environments/environment.*.ts` has a `mockMode: boolean` property:

```typescript
export const environment = {
  production: false,
  mockMode: false,  // managed by /angular-admin-design:aad-switch
  // ... existing fields
};
```

Default: `false` everywhere. `environment.local.ts` gets `true` so `npm run serve` starts in mock mode out of the box.

`environment.prod.ts` is **never** touched by `aad-mock` (prod must not silently fall back to mock data). `aad-switch` refuses to flip prod without `--force`.

## `/aad-switch` semantics

```
aad-switch <feature> --on    →  environment.local.ts: mockMode = true   (use mock)
aad-switch <feature> --off   →  environment.local.ts: mockMode = false  (use real)
aad-switch <feature> --on --env dev      →  environment.dev.ts
aad-switch <feature> --on --env all      →  local + dev + staging (NEVER prod)
aad-switch <feature> --on --env prod --force   →  prod (only with --force)
```

## Known limitation: global mockMode

`mockMode` is one flag for the whole app. If 3 features have mocks wired, they share the flag — flipping it affects all of them.

Per-feature switching would require either:
- Per-feature env flags (`environment.mocks.<feature> = true`)
- A registry service that maps `feature → useMock` and the providers consult it

This is on the roadmap but not in v0.1. Surfaced to the user when more than one feature has `mock-spec.json`.

## Type safety guarantee

Because mock service implements the same interface as the real service:

- If the dev changes the real service's signature (adds a param, changes return type), TypeScript fails to compile until the mock and interface are updated.
- If the dev calls a method on `service` in effects, autocomplete works whether the bound implementation is mock or real.

This is the whole point of going through `InjectionToken<I<Feature>ApiService>` rather than `useClass: environment.mockMode ? Mock : Real` directly on the real service class — the latter loses type safety because the two classes don't share an explicit contract.
