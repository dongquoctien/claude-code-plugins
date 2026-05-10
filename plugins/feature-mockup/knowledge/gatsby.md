# Stack knowledge — Gatsby

Read this when `manifest.stack.framework === "gatsby"`. Gatsby is a React-based static site generator with a heavy GraphQL data layer and a plugin ecosystem.

## Project shape

```
src/
├── pages/                ← file-based routes (auto-discovered)
│   ├── index.tsx         ← /
│   ├── about.tsx         ← /about
│   └── blog/
│       └── [slug].tsx    ← /blog/:slug (file-system route API)
├── templates/            ← templates used by gatsby-node.js createPages
│   └── blog-post.tsx
├── components/           ← shared components
├── styles/
│   └── global.css        ← global stylesheet (imported from gatsby-browser.js)
├── images/               ← bundled images
└── html.tsx              ← custom HTML shell (rare; usually default)

gatsby-config.{js,ts}     ← site metadata + plugins list
gatsby-node.{js,ts}       ← programmatic page creation, sourceNodes
gatsby-browser.{js,ts}    ← client-side hooks (wrapPageElement, onRouteUpdate)
gatsby-ssr.{js,ts}        ← SSR-time hooks
```

## Page file anatomy (Gatsby 5)

```tsx
import * as React from 'react';
import { graphql, type HeadFC, type PageProps } from 'gatsby';
import Layout from '../components/Layout';

// Page query — runs at build time, result injected as `data` prop
export const query = graphql`
  query BlogIndex {
    allMarkdownRemark(sort: { frontmatter: { date: DESC } }) {
      nodes {
        id
        excerpt
        frontmatter {
          title
          slug
          date
        }
      }
    }
  }
`;

const BlogIndex: React.FC<PageProps<Queries.BlogIndexQuery>> = ({ data }) => {
  return (
    <Layout>
      <h1>Blog</h1>
      <ul>
        {data.allMarkdownRemark.nodes.map((post) => (
          <li key={post.id}>
            <a href={`/blog/${post.frontmatter?.slug}`}>{post.frontmatter?.title}</a>
          </li>
        ))}
      </ul>
    </Layout>
  );
};

export default BlogIndex;

// SEO head (Gatsby 4.19+)
export const Head: HeadFC = () => <title>Blog</title>;
```

## Gatsby-specific imports — strip or replace

| Import | Action in prototype |
|---|---|
| `import { Link } from 'gatsby'` | Drop. Replace `<Link to="X">` with `<a href="X.html">` |
| `import { graphql } from 'gatsby'` | Drop. Replace query data with hardcoded sample matching the query shape |
| `import { useStaticQuery } from 'gatsby'` | Drop. Inline the query result |
| `import { StaticImage, GatsbyImage } from 'gatsby-plugin-image'` | Replace with `<img src="..." />`. The original image source path lives in the component or a sibling sharp transform |
| `import { Slice } from 'gatsby'` (Slice API) | Inline the slice's HTML output |
| `import { withPrefix, navigate } from 'gatsby'` | Replace `withPrefix('/x')` with `'/x'`; replace `navigate(path)` with `window.location.href = path + '.html'` |

## Page query vs static query

| Construct | Use case | Where defined |
|---|---|---|
| `export const query = graphql\`...\`` | Page-level query, data injected into the page's `data` prop | Page components only |
| `useStaticQuery(graphql\`...\`)` | Component-level query, runs at build time | Any component |
| `gatsby-node.js` `createPages` | Programmatic route creation from external data sources | gatsby-node.js |

For prototype:
- Read the query schema for data shape
- Hardcode sample data matching that shape
- For `createPages` programmatic routes, read the `templates/<name>.tsx` file the route uses

## File System Route API (Gatsby 3+)

Pages with brackets in the filename auto-create dynamic routes:

| Filename | URL |
|---|---|
| `src/pages/blog/{MarkdownRemark.frontmatter__slug}.tsx` | `/blog/:slug` (sourced from data layer) |
| `src/pages/products/[id].tsx` | `/products/:id` (client-only when no template) |
| `src/pages/[...].tsx` | catch-all |

For prototype, pick representative URLs and create one HTML file per representative.

## gatsby-config plugins — what matters

The plugin list in `gatsby-config.{js,ts}` determines the data layer + UI integrations:

| Plugin | Effect |
|---|---|
| `gatsby-plugin-image` | Image processing — replace with plain `<img>` in prototype |
| `gatsby-source-filesystem` | Sources files into the data layer (Markdown, images) |
| `gatsby-transformer-remark` | Parses Markdown with frontmatter — read for sample post shape |
| `gatsby-plugin-mdx` | MDX support — same as remark plus React |
| `gatsby-plugin-emotion` | Emotion CSS-in-JS — see react.md emotion section |
| `gatsby-plugin-styled-components` | styled-components — same |
| `gatsby-plugin-postcss` | PostCSS — Tailwind usually configured here |
| `gatsby-plugin-react-i18next` | i18n — locales typically in `static/locales` |
| `gatsby-plugin-google-analytics` | Analytics — drop |
| `gatsby-plugin-manifest` | PWA manifest — drop |
| `gatsby-plugin-offline` | Service worker — drop |

## Routing + navigation

- `<Link to="/path">` → `<a href="path.html">`. Note `to` paths are absolute from site root.
- `navigate('/path')` → `window.location.href = './path.html'`.
- `getPath` / `withPrefix` (used when site has a path prefix) → drop the prefix wrapper.

## CSS approach

- **Global stylesheet**: imported from `gatsby-browser.js` (e.g. `import './src/styles/global.css'`). Read the imports here for design tokens.
- **CSS modules**: `Foo.module.css` — same as react.md.
- **styled-components / emotion**: same as react.md CSS-in-JS section.
- **Tailwind**: configured via `gatsby-plugin-postcss` + `tailwind.config.{js,ts}`.

## Form patterns

Gatsby is mostly static, so forms typically:
- POST to a serverless function (Netlify Functions, Vercel Functions, Lambda) — drop the submit handler in prototype, replace with toast.
- Use Netlify Forms — `<form name="X" data-netlify="true">`. For prototype, replace handler with toast + page nav.
- Use react-hook-form + zod — same as react.md.

## Common Gatsby UI library integrations

- **MUI / Chakra / antd / shadcn** — work fine. Same patterns as react.md.
- **gatsby-plugin-theme-ui** — Theme UI design system. Tokens in `theme.ts`.

## What the agent should do when reading source-index.json for a Gatsby project

1. Read `gatsby-config.{js,ts}` — site metadata, plugin list, theme, prefix path.
2. Read `gatsby-node.{js,ts}` — programmatic page creation (templates/X.tsx routes).
3. Read `src/styles/global.css` (or whatever gatsby-browser imports) — design tokens.
4. Read `src/components/Layout.tsx` (or equivalent) — the shell wraps every page.
5. Read 3–5 `src/pages/*.tsx` files matching the feature's domain.
6. Read `src/templates/*.tsx` for programmatic-route pages.
7. Read `src/components/*` for design vocabulary.

## Copy-from-source discipline (Gatsby-specific)

- **Page query result shape**: read the `graphql\`...\`` query for fields; hardcode sample objects matching.
- **`useStaticQuery` shape**: same.
- **Markdown frontmatter**: when the source uses `gatsby-transformer-remark`, the frontmatter fields define data shape — sample 5–10 posts with that shape.
- **`StaticImage` / `GatsbyImage`**: read the source `src` prop or sibling image file; copy the actual image into prototype's `assets/` and use plain `<img src>`.
- **Slice API**: inline the slice's rendered HTML at every alias point.
- **Plugin-injected components** (e.g. `gatsby-plugin-mdx` provides MDX components): if the prototype uses one, render its HTML output once.

## i18n with gatsby-plugin-react-i18next

Locales typically in `static/locales/<lang>/<namespace>.json`. The plugin auto-creates routes per locale (`/en/about`, `/ja/about`). For prototype:
- Read each locale JSON
- Use the runtime language switcher pattern (see `prototype-builder.md` "Language switcher" section), no per-locale prototype files.
