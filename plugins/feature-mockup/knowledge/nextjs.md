# Stack knowledge — Next.js (App Router with React Server Components)

Read this when `manifest.stack.framework === "nextjs"`. The App Router (`app/`) is the default since Next.js 13. Pages Router (`pages/`) is older but still common.

## App Router vs Pages Router (detect first)

- App Router: `app/` directory at root, files like `app/page.tsx`, `app/layout.tsx`, `app/about/page.tsx`. Server components by default.
- Pages Router: `pages/` directory, files like `pages/index.tsx`, `pages/about.tsx`. Client components by default.

Decide by checking `manifest.files.routes`. App Router routes will look like `app/booking/page.tsx`; Pages Router will look like `pages/booking/index.tsx`.

## Server vs client components (App Router only)

- A file with `'use client'` at the top is a CLIENT component. It can use `useState`, `onClick`, browser APIs.
- Files WITHOUT `'use client'` are SERVER components. They can `await` data, can't have `useState` or event handlers.
- For a static prototype: every component becomes "client-equivalent" (HTML page that runs in the browser). Drop the `'use client'` directive — irrelevant for prototypes.
- DO NOT generate a prototype that imports server-only APIs (`fs`, `next/headers`, `cookies()`, `auth()`). They won't run in the browser.

## Next-specific imports — strip or replace

| Import | Action in prototype |
|---|---|
| `import Image from 'next/image'` | Drop import. Replace `<Image src="..." width={X} height={Y}>` with `<img src="..." width={X} height={Y}>` |
| `import Link from 'next/link'` | Drop import. Replace `<Link href="X">` with `<a href="X.html">` |
| `import { useRouter } from 'next/navigation'` | Drop. The prototype uses static href links — not `router.push()` |
| `import { redirect } from 'next/navigation'` | Drop. Replace with a navigation link |
| `import { headers, cookies } from 'next/headers'` | Drop entirely. Those are server-only |
| `import dynamic from 'next/dynamic'` | Inline the dynamically-imported component |
| `import { Inter } from 'next/font/google'` | Replace with a `<link rel="stylesheet">` from Google Fonts CDN |

## Metadata API

- `export const metadata = { title: 'Foo' }` in `layout.tsx` or `page.tsx` becomes `<title>` and `<meta>` tags at build. For a prototype, lift these into `<head>` of the generated HTML.
- `generateMetadata()` async functions become a single static metadata in the prototype.

## Loading / error boundaries

- `loading.tsx` next to `page.tsx` is the loading skeleton. SKIP for prototype — show the page in its loaded state.
- `error.tsx` is shown on error. SKIP unless the prototype is specifically demonstrating error handling.
- `not-found.tsx` is the 404 page. Optionally generate as a separate prototype screen.

## File-based routing → prototype file structure

| Next.js path | Prototype file |
|---|---|
| `app/page.tsx` | `index.html` |
| `app/booking/page.tsx` | `pages/booking.html` |
| `app/booking/[id]/page.tsx` | `pages/booking-detail.html` (use a sample id) |
| `app/(auth)/login/page.tsx` | `pages/login.html` (drop the route group `(auth)`) |
| `app/api/...` | SKIP — these are API routes, not pages |

## Layouts

- `app/layout.tsx` is the root layout — wraps every page. Lift its outer JSX into a shared shell rendered on every prototype HTML.
- Nested `app/(group)/layout.tsx` wraps that segment. Inline its JSX where needed.
- For the html-tailwind template: write the layout once into a JS string and inject it at the top of every page's `<body>`.

## Server actions

- `'use server'` directive on functions creates server actions. Form `action={myAction}` would call them.
- Drop entirely. Replace with `<form onsubmit="event.preventDefault();alert('(prototype) submit')">`.

## Common Next.js + Tailwind + shadcn structure

```
app/
├── layout.tsx              ← root shell (header + footer)
├── page.tsx                ← /
├── (marketing)/
│   ├── about/page.tsx
│   └── pricing/page.tsx
├── (app)/
│   ├── layout.tsx          ← nested shell with sidebar
│   ├── dashboard/page.tsx
│   └── settings/page.tsx
├── globals.css             ← Tailwind directives + CSS custom properties (theme)
└── components/ui/          ← shadcn copied components
```

Read `app/layout.tsx` AND any nested layouts when generating an admin-shell prototype.

## What the agent should do when reading source-index.json for a Next.js project

1. Read `configs.next.config.*` — image domains, Tailwind setup hints.
2. Read `configs.tailwind.config.*` + `globalStyles.globals.css` — design tokens.
3. Read `app/layout.tsx` (or whichever layout file is present) — the shell wraps every page.
4. Read 2-4 layouts matching the feature's domain (e.g. `app/(app)/layout.tsx` for admin features).
5. Read `components/ui/*` for shadcn components.
6. Read 3-5 `page.tsx` files near the feature for composition patterns.
