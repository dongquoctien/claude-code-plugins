# Stack knowledge — Astro

Read this when `manifest.stack.framework === "astro"`. Astro is an island-architecture meta-framework: pages render mostly as static HTML at build time, with islands of interactivity (React/Vue/Svelte/Solid components) hydrated selectively.

## Astro file anatomy

```astro
---
// Frontmatter — runs at BUILD TIME, server-only.
// Imports, data fetching, layout selection live here.
import BaseLayout from '../layouts/BaseLayout.astro';
import Card from '../components/Card.astro';
import { fetchHotels } from '../lib/hotels';

const hotels = await fetchHotels();
const title = 'Hotels';
---

<BaseLayout title={title}>
  <h1>{title}</h1>
  <ul>
    {hotels.map((h) => <Card title={h.name} desc={h.region} />)}
  </ul>

  {/* Hydration directive controls when/how this island runs */}
  <BookingForm client:load />
  <SearchBar client:idle />
  <ChatWidget client:visible />
</BaseLayout>

<style>
  /* Scoped to this component by default — Astro injects a hash class */
  h1 { color: var(--color-fg); }
</style>

<script>
  // Inline client-side script — runs in the browser
  document.querySelector('h1')?.addEventListener('click', () => {
    console.log('hello');
  });
</script>
```

Three blocks:
1. **Frontmatter** (`---` ... `---`): server-only JS/TS at the top
2. **Template body**: HTML-like with `{expression}` interpolation, `<Component />` imports, and hydration directives
3. **`<style>` / `<script>`**: scoped CSS + inline JS

## Hydration directives — what they mean for prototypes

| Directive | When component runs | Prototype translation |
|---|---|---|
| `client:load` | Hydrates immediately on page load | Treat as live JS — keep handlers |
| `client:idle` | Hydrates when browser is idle | Same — keep handlers |
| `client:visible` | Hydrates when scrolled into view | Treat as visible from start in static prototype |
| `client:media="(...)"` | Hydrates on media query match | Render once, drop the query |
| `client:only="<framework>"` | Skip server render, hydrate fully on client | Render the framework component as-is |
| (no directive) | Render-only HTML, never hydrates | Pure static HTML — drop event handlers |

When porting an Astro page to a static HTML prototype, treat any island WITHOUT `client:*` as pure HTML output. Islands WITH `client:*` get their handlers preserved.

## Frontmatter → static HTML translation

The frontmatter is server-only. For a static prototype:

| Frontmatter pattern | Static HTML translation |
|---|---|
| `await fetchX()` | Replace with hardcoded sample array of the same shape |
| `Astro.props` (in components) | Inline the prop value |
| `Astro.params` (in dynamic routes) | Pick a sample value |
| `Astro.url` / `Astro.request` | Drop |
| `import.meta.env.PUBLIC_X` | Inline the actual value |
| `Astro.glob('./posts/*.md')` | Replace with hardcoded array of post objects |
| `getCollection('blog')` (Content Collections) | Replace with hardcoded entries |

## Template syntax — translate to HTML

| Astro syntax | Static HTML equivalent |
|---|---|
| `{expression}` | The literal value |
| `{cond && <X />}` | Render the X branch (assume cond true for happy path) |
| `{cond ? <A /> : <B />}` | Render the matching branch |
| `{items.map(x => <Card .../>)}` | Materialize the loop with sample data |
| `<slot />` | Inline the default slot content |
| `<slot name="header" />` | Inline named slot HTML |
| `class:list={['a', cond && 'b']}` | Resolve to a static class string at edit time |
| `set:html={raw}` | Render as innerHTML (use sparingly) |
| `<Fragment>...</Fragment>` | Keep children, drop wrapper |
| `<Component />` | Inline the component's HTML output |

## Style scoping

Astro's `<style>` blocks are scoped by hash class (similar to Vue/Svelte). For a static prototype:
- Strip the hash suffix (`.btn-XXXXX` → `.btn`)
- Class names work directly
- `:global(.x)` — drop wrapper, keep `.x`
- `<style is:global>` — keep contents at root level

## Common Astro UI library integrations

Astro has no opinions about UI libraries; it embeds them as islands:

- **React + shadcn/ui** — most common modern stack. Components in `src/components/ui/` (shadcn convention). Use `client:load` for interactivity.
- **Vue + Vuetify / Element Plus** — same pattern with Vue components.
- **Svelte + skeleton-ui** — Svelte islands.
- **Solid** — Solid islands via `@astrojs/solid-js`.
- **No framework — Web Components / vanilla** — small `<script>` blocks per component.

When the source uses a JSX/Vue/Svelte component as an Astro island, read the corresponding `react.md` / `vue.md` / `svelte.md` knowledge file for component-level patterns.

## Routing — file-based

`src/pages/` directory:
- `src/pages/index.astro` → `/`
- `src/pages/about.astro` → `/about`
- `src/pages/blog/[slug].astro` → `/blog/:slug` (dynamic; `Astro.params.slug` reads the value)
- `src/pages/blog/[...slug].astro` → catch-all
- `src/pages/api/foo.ts` → API route (server endpoint, NOT a UI page — skip in prototype)

For prototype:
- Each `.astro` page becomes one prototype HTML file
- Dynamic routes: pick a sample param value
- `getStaticPaths()` for SSG: read it to pick representative paths

## Layouts

`src/layouts/BaseLayout.astro` (or any name) wraps page content:

```astro
---
const { title } = Astro.props;
---
<html>
  <head><title>{title}</title></head>
  <body>
    <header>...</header>
    <main><slot /></main>
    <footer>...</footer>
  </body>
</html>
```

Used as `<BaseLayout title="Hello">...</BaseLayout>`. For prototype, inline the layout's HTML structure into every page.

## Form patterns

Astro doesn't ship a form library. Common approaches:
- **Plain HTML form** with action URL → server endpoint at `src/pages/api/`. For prototype, use `<form onsubmit="event.preventDefault(); ...">`.
- **HTMX** — `hx-post="..."` etc. For prototype, replace with onclick + manual UI update.
- **React Hook Form / VeeValidate** in islands — read corresponding framework's knowledge file.

## Content Collections (Astro 3.0+)

`src/content/blog/post-1.md` with `astro:content` schema. For prototype:
- Read the schema in `src/content/config.ts` for shape
- Hardcode 5–10 sample entries

## What the agent should do when reading source-index.json for an Astro project

1. Read `astro.config.{js,ts,mjs}` — adapter (`@astrojs/node`, `@astrojs/vercel`), integrations (`@astrojs/tailwind`, `@astrojs/react`, etc.), site URL.
2. Read `src/styles/global.css` (or wherever the entry CSS lives) — Tailwind base + tokens.
3. Read `src/layouts/*.astro` — every page extends one of these.
4. Read 2–3 `src/pages/*.astro` files matching the feature's domain.
5. Read `src/components/*.astro` for the design vocabulary.
6. SKIP `src/pages/api/**` — server-only.

## Copy-from-source discipline (Astro-specific)

- **`{items.map}` in template**: count what the source's typical data has. Don't curate.
- **Frontmatter `await` data**: use the result shape; hardcode equivalent values.
- **Islands**: keep them as islands in the prototype IF prototype is also Astro. Otherwise, render the island's first-render HTML output and drop the framework wrapper.
- **`<slot>`**: always inline the slot's actual content from the parent's child markup.
- **`Astro.glob` results**: count the typical match count and hardcode.
