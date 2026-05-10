# Front-end design export — spec for developers

This is the contract between **front-end devs** and **BAs using `feature-mockup`**.

When a BA runs `/feature-mockup:ingest-theme <path>`, the plugin reads a snapshot of your real design system and uses it to theme prototypes. The closer the snapshot matches production, the more faithful the prototype looks.

## What to export

A directory or zip with this layout:

```
fe-theme-export/
├── manifest.json              REQUIRED — points to the rest
├── tokens.json                OPTIONAL — Style Dictionary or custom flat shape
├── tailwind.config.js         OPTIONAL — your real Tailwind config (or .ts/.cjs/.mjs)
├── globals.css                OPTIONAL — CSS variables, base styles
├── components/                OPTIONAL — presentational components only
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── Input.tsx
│   ├── Badge.tsx
│   └── ...
└── README.md                  OPTIONAL — notes for the BA
```

At minimum, ship `manifest.json` plus **either** `tokens.json` **or** `tailwind.config.*` **or** `globals.css`. Components are optional but strongly recommended — without them the prototype gets the right colors but a generic shape language.

## `manifest.json` shape

```json
{
  "name": "ohmyhotel-design-system",
  "version": "2.4.0",
  "exportedAt": "2026-05-10",
  "stack": {
    "framework": "react",
    "css": "tailwind",
    "tokenSource": "tokens.json | tailwind | css-vars",
    "language": "typescript"
  },
  "files": {
    "tokens": "tokens.json",
    "tailwindConfig": "tailwind.config.ts",
    "globalsCss": "globals.css",
    "components": "components/"
  },
  "components": [
    { "name": "Button",  "path": "components/Button.tsx",
      "props": ["variant", "size", "disabled", "children"],
      "variants": ["primary", "secondary", "ghost", "danger"] },
    { "name": "Card",    "path": "components/Card.tsx",
      "props": ["children", "padded"] },
    { "name": "Input",   "path": "components/Input.tsx",
      "props": ["type", "value", "placeholder", "error", "disabled"] },
    { "name": "Badge",   "path": "components/Badge.tsx",
      "props": ["variant", "children"], "variants": ["default", "success", "warning", "danger"] }
  ]
}
```

## Token shapes accepted

`feature-mockup` normalizes everything into one schema. You can ship any of these and the plugin will figure it out:

### Option A — Style Dictionary–style `tokens.json`

```json
{
  "color": {
    "primary": { "value": "#6366f1" },
    "background": { "value": "#ffffff" },
    "foreground": { "value": "#0f172a" }
  },
  "spacing": { "sm": { "value": "0.5rem" }, "md": { "value": "1rem" } },
  "radius":  { "default": { "value": "0.5rem" } },
  "typography": { "fontSans": { "value": "Inter, sans-serif" } }
}
```

### Option B — Flat `tokens.json`

```json
{
  "colors": { "primary": "#6366f1", "background": "#ffffff" },
  "spacing": { "sm": "0.5rem", "md": "1rem" },
  "radii":   { "default": "0.5rem" },
  "typography": { "fontSans": "Inter, sans-serif" }
}
```

### Option C — Just `tailwind.config.js`

The plugin parses `theme.extend.colors`, `theme.extend.spacing`, `theme.borderRadius`, `theme.fontFamily`. Anything more exotic falls back to defaults.

### Option D — Just `globals.css`

The plugin reads CSS variables from `:root` and any `[data-theme=...]` blocks. Naming conventions it understands: `--color-*`, `--bg-*`, `--text-*`, `--radius-*`, `--space-*`, `--font-*`.

## Component constraints (read me, devs)

For `components/` to be usable in a static prototype, each component must:

1. **Be presentational only** — no API calls, no global state, no router hooks (`useNavigate`, `useParams`). Pure props in, JSX out.
2. **Self-contained styling** — Tailwind classes, CSS modules co-located, or styled-components. No imports from `@/lib/...`, `@/hooks/...`, or anything outside `components/`.
3. **Avoid framework-specific imports** the prototype can't satisfy:
   - ❌ `next/image`, `next/link` — use `<img>` and `<a>`
   - ❌ `@/lib/utils` — inline the helper or skip it
   - ✅ `clsx`, `tailwind-merge` — fine, they're popular and the plugin can install them
4. **Export as default OR named with the component's name** so re-import is mechanical.
5. **List in `manifest.json`** under `components` so the plugin knows what's available.

If a component breaks any of these, leave it out. A working subset (Button + Card + Input + Badge) is more useful than a complete set the plugin can't render.

## What devs should NOT export

- Anything with auth/PII (e.g., a fully populated mock database)
- Components that import from `pages/`, `app/`, `lib/api/`, `hooks/`
- Whole `node_modules` or `.next` — the plugin only needs source files
- `.env`, secrets, internal docs

## How the BA uses this

```bash
# BA imports your export — once per project, or whenever you ship updates
/feature-mockup:ingest-theme ./from-dev/fe-theme-export.zip

# From now on, every /feature-mockup:make uses the imported tokens + components
/feature-mockup:make "booking-cancel-flow" ./screenshots/...
```

The plugin writes the normalized output to `.claude/feature-mockup/theme/`:

```
.claude/feature-mockup/theme/
├── tokens.json        normalized canonical shape
├── theme.css          generated CSS variables for prototype injection
├── components/        cloned, import-rewritten components ready to use
│   ├── Button.tsx
│   ├── _manifest.json
│   └── ...
└── source-manifest.json  copy of what was imported (for traceability)
```

## Versioning

When you bump your design system, re-export and ship the new zip. The BA re-runs `ingest-theme` and existing prototypes can be regenerated (`/feature-mockup:make` with `--rebuild`).

## Quick template

A starter `manifest.json` lives at `templates/fe-export-manifest.template.json` in this plugin (Phase 2.1).
