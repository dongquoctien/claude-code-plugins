# i18n flow

Two flows exist in scope. Codegen behavior differs.

## Flow A — `scan-download` (partners-style)

When config has `profile.i18nFlow === 'scan-download'`:

- Templates use the project's translate pipe / directive. Confirm the exact form by grepping an existing partners template (it's typically `{{ 'key' | translate }}` from `@ngx-translate/core` if installed, or a custom directive).
- Codegen DOES NOT touch JSON translation files directly. The source-of-truth lives elsewhere (Google Sheets). Keys are picked up by `npm run scan:i18n`, which writes them into the scanned keys list, and translations are pulled by `npm run download:i18n`.
- Codegen's job is to emit:
  1. Template usage with the key (so scan picks it up).
  2. A consolidated list of new keys in `{featureDir}/i18n-keys.md` so the dev can paste into Google Sheets.

After generation, **always** remind the user to run:

```bash
npm run scan:i18n      # registers new keys
npm run download:i18n  # pulls latest translations
```

## Flow B — `none` (oh-admin-style — no i18n in routes/)

When `profile.i18nFlow === 'none'`:

- Generate strings inline in `workingLanguage`. No translate pipe.
- Still write `{featureDir}/i18n-keys.md` as a future-proof reference, but do not inject pipe calls into templates.

## Flow C — `json-inline` (hypothetical)

If a project later adopts inline JSON i18n, codegen writes new keys directly to `src/assets/i18n/{lang}.json`. Not currently used in oh-admin or partners.

## Key naming convention

Always: `<feature-camelCase>.<screen-id-camelCase>.<purpose>`

Examples:
- `bookingCancel.cancelForm.title`
- `bookingCancel.cancelForm.confirmBtn`
- `hardblockHistory.search.dateRangeLabel`
- `hardblockHistory.column.changedAt`

Keep keys flat — no deeper than 4 segments. Avoid generic names like `submit` at the leaf; prefer `cancelBtn`, `confirmBtn`, `applyBtn`.

## i18n-keys.md output

```markdown
# i18n keys — <feature>

These keys are introduced by this feature. After /aad-generate completes:

1. Paste into your translation source (Google Sheets / etc.).
2. Run `npm run scan:i18n` to register them in the project.
3. Run `npm run download:i18n` to fetch the latest translations.

| Key | Default ({workingLanguage}) | Context |
|---|---|---|
| `hardblockHistory.search.title` | "Tìm kiếm lịch sử" | history-list/search |
| `hardblockHistory.search.hotelLabel` | "Khách sạn" | history-list/search |
| ... | ... | ... |
```
