# Prototype source parsing (v0.8.0)

Complement to browser MCP inspection (v0.5.0-v0.7.1). When a prototype's source code is accessible (local .tsx/.jsx/.html file), the plugin can **statically parse it** instead of (or alongside) browser inspection.

## Why source parsing matters

Browser MCP DOM inspection captures the **rendered output** — what the user sees. Source parsing captures the **logic** — what the developer wrote. Each has unique signal:

| Signal | Browser MCP | Source parse |
|---|---|---|
| Visible buttons + labels | ✓ | ✓ (via JSX) |
| Form field types | ✓ | ✓ |
| Table column headers | ✓ | ✓ |
| **Event handler names** (`handleSave`, `dispatch`) | ✗ (only handles fire on click) | ✓ |
| **Initial state shape** (`useState({mode:'booking'})`) | ✗ (state is internal) | ✓ |
| **API URLs** (`fetch('/api/...')`, `axios.get(...)`) | ✓ (if called during walk) | ✓ (even before runtime) |
| **Component composition** (`<Drawer><RuleTable/></Drawer>`) | ✓ (rendered tree) | ✓ (source tree) |
| Conditional rendering (else branch) | ✗ (only what's currently rendered) | ✓ (all branches) |
| Animation / CSS effects | ✓ (visual) | partial (className only) |
| Real network responses | ✓ (with backend) | ✗ |

Use both when possible; source for handler/state hints, browser for visual + runtime.

---

## Detection

`scripts/detect-prototype.mjs` (v0.8.0 upgrade):

When spec contains a bare filename in backticks/quotes plus a context keyword (vd `Prototype simulator v2 (\`remixed-ca0f0e7d.tsx\`)`), the detector now:

1. Searches common prototype dirs in order:
   - `<projectRoot>` (project root)
   - `<projectRoot>/docs/`
   - `<projectRoot>/docs/prototypes/`
   - `<projectRoot>/docs/mockups/`
   - `<projectRoot>/docs/design/`
   - `<projectRoot>/prototypes/`
   - `<projectRoot>/mockups/`
   - `<projectRoot>/design/`
   - `<projectRoot>/design/prototypes/`
   - `<projectRoot>/.spec/`
   - `<projectRoot>/specs/`
   - `<projectRoot>/specs/prototypes/`

2. If found, upgrades `confidence` from `low` → `medium` and populates `source` with absolute path.

3. If not found, keeps confidence `low` + suggests user provide path manually.

---

## Parser — `scripts/parse-prototype-source.mjs`

### TSX/JSX (TypeScript Compiler API)

Uses `typescript` package borrowed from project's `node_modules` (same pattern as `crawl-shared-modules.mjs` v0.2.0). Falls back to regex parsing when TS not available — accuracy degraded but functional.

Extracts:

- **events[]** — every JSX attribute matching `on[A-Z]\w*` (onClick, onChange, onSubmit, onClose, onSelect, ...). Captures `element` (tag name), `eventName`, `handler` text, line number.
- **state[]** — every `useState(...)`, `useReducer(...)`, `useRef(...)` call. Captures `name`, `setter`, `hookKind`, `initial` (the initializer expression, truncated to 200 chars), TypeScript `type` if explicit.
- **endpoints[]** — every `fetch('...')`, `axios.get('...')` / `.post(...)` / etc., `api.get(...)`, `http.get(...)` call where URL is a string literal or no-substitution template. Captures `url`, `method`, `source` (the call expression).
- **components[]** — every JSX element with uppercase tag name (React component, not HTML). Captures `name`, `props` (prop names), line number.

### HTML (regex-based)

Less rich than TSX but useful for static prototypes:

- **events** — inline `onclick="..."` attributes
- **endpoints** — `<a href>` to absolute URLs + `<form action method>`
- **state, components** — not applicable to HTML
- **Inline JSON data blocks** — `<script type="application/json">` counts logged as warnings (potential mock data source)

### String concatenation limitation

`fetch('/api/' + contractId + '/override')` is NOT captured because the URL is computed at runtime, not a string literal. Only static URLs work. Document via warning.

---

## How spec-analyzer consumes findings (v0.8.0)

Step 1.8 (new): if `prototype.sourceFindingsPath` exists, read and augment plan:

- **events → state.actions[]**: handler names become UI action proposals. `handleSave` → `saveDrawerStaging`. Don't duplicate spec-derived actions.
- **state → state.shape**: useState initializers become state field types. `useState('booking')` → `mode: 'booking' | 'stay' | 'combined'` (with enum inference from other useState calls or context).
- **endpoints → plan.endpoints[]**: match by URL path similarity. If match exists, add `prototypeSourceRef`; if not, propose new endpoint with `source: 'prototype-source-parse'`.
- **components → sections**: composed sub-components hint at section structure.

### Conflict detection

If both source findings AND DOM snapshot exist for same prototype, spec-analyzer cross-checks:

- DOM has buttons not in source → component may be conditional, flag openQuestion
- Source has handlers without DOM matches → handler may only fire in non-default state, flag info
- Endpoints in source not seen in DOM network requests → handler not yet exercised, OK

---

## Workflow choice (skill Step 5.6.2)

When prototype is local file with confidence ≥ medium, AskUserQuestion:

| Option | When to use |
|---|---|
| **Source parse only** (Recommended for .tsx/.jsx) | Fast, no browser, captures handler logic |
| **Browser inspect + source parse** | Full coverage — DOM visual + source logic |
| **Browser inspect only** | Source not interesting (e.g. obfuscated bundle) |
| **Skip** | User just wants spec-only plan |

For .html prototypes, browser inspect is usually preferred (regex source parse is shallow).
For .tsx/.jsx, source parse alone is often enough (handler + state + endpoints + component tree).

---

## Limitations

- **String concatenation URLs** not captured — use placeholders if API URL needs to be configurable
- **Dynamic imports** not traced (`React.lazy`, `import()`)
- **Higher-order components** (HOC) may obscure prop names
- **CSS-in-JS** styles (styled-components, emotion) not extracted — use design-tokens.md for the design system
- **Server-side rendered** state (Next.js getServerSideProps) requires fetching from server — out of scope
- **`useEffect` dependencies** not extracted — only direct state/event hooks
