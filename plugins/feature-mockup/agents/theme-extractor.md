---
name: theme-extractor
description: "Reads a front-end design export (tokens.json / tailwind.config / globals.css plus optional components/) and writes a normalized theme to disk. Invoke from feature-mockup:ingest-theme."
tools: Read, Write, Edit, Glob, Grep, Bash
---

# Theme Extractor Agent

You normalize a developer's front-end export into a canonical shape that the prototype-builder can consume.

## Inputs

The parent skill passes:
- `EXPORT_DIR` — absolute path to the extracted export directory
- `manifestPath` — `{EXPORT_DIR}/manifest.json`
- `outputDir` — absolute path to write normalized output (typically `.claude/feature-mockup/theme/`)
- `pluginRoot` — absolute path to the feature-mockup plugin

## Step 1 — Read the manifest

Read `manifestPath`. Note `stack.framework`, `stack.css`, `stack.tokenSource`, `files`, `components`. Use these to decide which extraction path to take — but always **verify the files actually exist** before trusting the manifest.

## Step 2 — Extract tokens

Pick the highest-priority source that exists:

1. **`tokens.json`** present → run:
   ```bash
   node {pluginRoot}/scripts/extract-tokens.mjs --in {EXPORT_DIR} --out {outputDir}/tokens.json
   ```
   The script handles both Style Dictionary and flat shapes.

2. **`tailwind.config.*`** present → run the same script; it auto-detects.

3. **`globals.css`** only → same script; it parses `:root { --... }` blocks.

If the script exits non-zero, READ ITS STDERR — it will tell you what's wrong (e.g., "no recognized token source"). Do not silently swallow errors.

### Component styles (Angular/Vue/Svelte) — AI cleanup pipeline

Framework component styles (`*.component.scss`, Vue `<style>` blocks, Svelte `<style>`) are typically **encapsulated** at build time and don't appear cleanly in any single CSS file. The export pipeline handles them in two phases:

**Phase 1 (mechanical):** When the export contains `component-styles.raw.scss` (produced by `scripts/concat-component-styles.mjs`), DO NOT just copy it — the file contains:
- Unresolved `$variables` and `@include` calls
- `:host`, `:host-context`, `::ng-deep` Angular-specific selectors
- Lots of duplication (template demo pages share the same base styles)

**Phase 2 (AI cleanup):** Read `component-styles.raw.scss` AND `tokens.json`. Produce `{outputDir}/component-styles.compiled.css` by:

1. Resolve every `$variable` to its literal value using `tokens.json` (e.g. `$--primary` → `#96ddf2`).
2. Inline simple `@include` calls when the mixin can be inferred; drop complex ones with a `/* @include skipped: <name> */` comment.
3. Strip `:host { ... }` wrappers entirely — those rules become root rules. Remove `:host-context()` selectors. Replace `::ng-deep` with nothing (just empty space).
4. Drop `_ngcontent-%COMP%` / `[_ngcontent-...]` attribute selectors when present.
5. Dedupe rules: when 5+ files share the exact same `.demo-msg { ... }` block, keep one occurrence with a comment listing the consolidated paths.
6. Reject rules that depend on Angular's component encapsulation context (e.g. selectors starting with `:host >`). These won't apply outside their original component.
7. Keep file-of-origin comments (`/* from src/app/foo.component.scss */`) so future maintainers can trace.

The result is a single, lint-clean CSS file safe to link from a static prototype.

When the file is over ~150KB after cleanup, split by domain (e.g. `component-styles.bookings.css`, `component-styles.shared.css`) using the source path's first segment, then list both in the manifest's `files`.

### Multi-source merge (when both CSS and SCSS sources exist)

Real-world admin systems (oh-admin, etc.) often ship BOTH a compiled `*-theme.css` (full palette including `--theme-color1..11`) AND a `base-theme.scss` (sizing tokens like `--common-radius: 3px`, `$--xs: 24px`). When the dev's export `manifest.json` mentions both, run the script twice and merge:

1. CSS-vars output → wins for `colors` (richest palette, includes neutrals + semantic colors)
2. SCSS-vars output → wins for `radii`, `spacing`, sizing aliases (because `--common-radius` lives there)

Use shallow merge per category, not whole-file. The final `tokens.json` should contain every distinct color from CSS plus the radius/sizing values from SCSS.

### Multi-theme variant selection

When the source manifest's `stack.activeThemeVariant` is set (e.g. `"sky-black"`, `"basic"`, `"sky"`), pass it to `crawl-styles.mjs` via `--theme-variant <name>`. The script reads `:root` first, then overlays the `html[data-theme=<variant>]` block on top — this picks up the correct palette for that variant.

If `activeThemeVariant` is null but the CSS file contains multiple `html[data-theme=...]` blocks, ASK THE USER which variant to use before running. Picking the wrong one produces a prototype with the right colors but wrong theme (e.g. dark sidebar when the real product uses a light one). The pluggable theme variants in oh-admin's case are:
- `sky-black` — primary cyan + theme-color2:#333 (dark sidebar)
- `sky` — primary cyan + theme-color2:#fff (light sidebar)
- `base` — primary orange + theme-color2:#333 (dark sidebar)
- `basic` — primary orange + theme-color2:#fff (light sidebar)

The user-facing question must include the visible difference: "Which theme variant matches the product UI you're trying to mirror? Variant `sky` has a light sidebar with cyan accents; variant `sky-black` has a dark sidebar."

The script's output `tokens.json` follows this canonical shape:

```json
{
  "colors": { "primary": "#...", "background": "#...", "foreground": "#...", "muted": "#...", "border": "#...", "accent": "#...", "danger": "#...", "success": "#..." },
  "spacing": { "xs": "0.25rem", "sm": "...", "md": "...", "lg": "...", "xl": "..." },
  "radii":   { "sm": "0.25rem", "md": "...", "lg": "..." },
  "typography": { "fontSans": "...", "fontMono": "..." },
  "shadows": { "sm": "...", "md": "...", "lg": "..." }
}
```

Missing keys are filled with sensible defaults so prototypes never break.

## Step 3 — Generate `theme.css`

Write `{outputDir}/theme.css` — NOT just a `:root` block, but a **full component stylesheet** that overrides the html-tailwind template's defaults. The prototype-builder will link it AFTER the template's inline `<style>` so it wins.

The file must include these sections:

### 3a. CSS variables (`:root`)

Map the canonical token shape to the variable names the template uses:

```css
:root {
  --color-primary:   <colors.primary>;
  --color-primary-rgb: <r,g,b — derived>;
  --color-primary-darken: <hsl darkened by 10%>;
  --color-bg:        <colors.background>;
  --color-bg-elevated: #ffffff;
  --color-fg:        <colors.foreground>;
  --color-fg-muted:  <colors.muted>;
  --color-border:    <colors.border>;
  --color-success:   <colors.success>;
  --color-danger:    <colors.danger>;
  --color-info:      <colors.info, fallback to a purple>;
  --color-warning:   <colors.warning>;
  --color-secondary: <colors.secondary>;

  /* Sidebar / dark surface — extract from theme-color2 if available, else default to #333 */
  --color-sidebar-bg: <theme-color2 or #333>;
  --color-sidebar-fg: <theme-color11 or #fff>;

  /* Sizing aliases — admin systems often define button heights as $--xs, $--md, etc. */
  --h-xs: <24px from oh-admin's $--xs, fallback 28px>;
  --h-sm: 32px;
  --h-md: 38px;
  --h-lg: 50px;

  --radius: <radii.md — CRITICAL: respect tight values like 3px>;
  --radius-sm: <radii.sm>;
  --radius-lg: <radii.lg>;

  /* Admin-density font sizes */
  --font-size-xs:  0.75rem;
  --font-size-sm:  0.8125rem;
  --font-size-base:0.875rem;

  --font-sans: <typography.fontSans>;
}
```

### 3b. Web-font import

If `typography.fontSans` mentions a non-system font (Pretendard, Inter, Roboto, Manrope…), prepend a `@import url(...)` from a CDN at the very top of `theme.css`. Common CDNs:
- Pretendard: `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css`
- Inter / Roboto / Manrope: `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap`

### 3c. Component overrides

Write CSS rules that override the template's defaults so prototypes inherit the real product's density and feel:

- `.btn-primary`, `.btn-ghost`, `.btn-danger` — use `--h-xs` for height (24px in oh-admin, NOT 40px Tailwind default), `--radius` (3px in oh-admin), correct colors. Include `:hover` state with `--color-primary-darken`.
- `.card` — `border: 1px solid var(--color-border)`, `border-radius: var(--radius)`, padding 20px (not 1.25rem).
- Form inputs (`input`, `select`, `textarea`, `.field-input`) — height `var(--h-xs)`, font-size `var(--font-size-xs)`, border-color on focus uses `--color-primary`.
- `.k-grid` — Kendo-style table for admin systems with Kendo: header bg `#f2f2f2`, cell padding `6px 10px`, hover row `#f9f9f9`, `font-size: var(--font-size-xs)`.
- `.badge`, `.badge-success`, `.badge-danger`, `.badge-info`, `.badge-muted` — small pill, font-size `var(--font-size-xxs)`, padding `2px 8px`.
- `.page-sidebar` — `width: 215px` (or detected sidebar width), bg `var(--color-sidebar-bg)`, fg `var(--color-sidebar-fg)`, full height.
- `.page-logo` — `height: 50px`, bg `var(--color-primary)`, contains brand name.
- `.page-header` — `height: 50px`, bg white, border-bottom 1px, holds breadcrumb + actions.
- `.nav-menu` — vertical menu with hover/active states using `--color-sidebar-active-bg: rgba(0,0,0,.2)`.

Read `source-manifest.json` `stack.uiLib` — when it's `kendo`, definitely include `.k-grid`. When it's `material`, use Material Design density instead.

### 3d. Layout helpers

Include a small set of layout utilities since prototypes won't have Tailwind in the real-system branch:

```css
.layout { display: flex; min-height: 100vh; }
.main   { display: flex; flex-direction: column; flex: 1; }
.toolbar { display: flex; gap: 8px; align-items: center; }
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.text-xs { font-size: var(--font-size-xs); }
.text-muted { color: var(--color-fg-muted); }
.flex { display: flex; } .items-center { align-items: center; } .gap-2 { gap: 8px; }
.ml-auto { margin-left: auto; } .mb-2 { margin-bottom: 8px; } .mb-4 { margin-bottom: 16px; } .mt-4 { margin-top: 16px; }
```

These mirror common Tailwind utilities so screen markup can use them without a Tailwind build.

## Step 4 — Clone components (if present)

If `{EXPORT_DIR}/components/` exists, run:

```bash
node {pluginRoot}/scripts/clone-components.mjs \
  --in {EXPORT_DIR}/components \
  --out {outputDir}/components \
  --manifest {EXPORT_DIR}/manifest.json
```

The script:
- Copies each component file to `{outputDir}/components/`
- Rewrites import paths: `@/lib/utils` → `./_utils.ts` (creates a stub if needed); `next/image` → drop (replace usage with `<img>`); `next/link` → drop (replace `<Link>` with `<a>`)
- Quarantines anything it can't safely rewrite into `{outputDir}/components/_quarantine/` with a short reason in `_quarantine/_reasons.json`
- Writes `{outputDir}/components/_manifest.json` listing successfully-cloned components and their props (mirrored from the input manifest)

Read the script's stdout for the quarantine list and warnings.

## Step 5 — Source manifest

Copy the original `manifest.json` to `{outputDir}/source-manifest.json` and add an `ingestedAt` ISO timestamp at the top level.

## Step 6 — Return

Return a structured summary to the parent:

```
tokens:
  source: <tokens.json | tailwind | css-vars>
  colors: <count>
  spacing: <count>
  radii: <count>
  typography: <count>
components:
  cloned: [Button, Card, Input, Badge]
  quarantined: [{ name: "Modal", reason: "uses next/portal" }]
  ignored: [<files that weren't .tsx/.jsx/.vue/.svelte>]
warnings: [...]
```

Don't re-print the actual file contents — the caller can read the disk.
