# Stack knowledge — Remix v2 (now React Router v7 framework)

Read this when `manifest.stack.framework === "remix"`. Remix is React Router's full-stack framework. Remix v2 ships with file-based flat routes in `app/routes/`. As of late 2024, Remix is being merged into React Router v7 — same patterns mostly apply.

## Project shape

```
app/
├── root.tsx              ← root layout — every page nests inside this
├── entry.client.tsx      ← client bootstrap (rarely touched)
├── entry.server.tsx      ← server bootstrap (rarely touched)
├── routes/
│   ├── _index.tsx        ← / (home)
│   ├── booking._index.tsx ← /booking (list)
│   ├── booking.$id.tsx   ← /booking/:id (detail)
│   ├── booking.$id.edit.tsx ← /booking/:id/edit
│   ├── booking.new.tsx   ← /booking/new
│   ├── _auth.login.tsx   ← /login (with _auth pathless layout)
│   └── api.bookings.tsx  ← /api/bookings (server-only API route)
├── components/           ← shared components (custom convention)
├── lib/                  ← helpers, db clients, etc.
└── tailwind.css          ← entry stylesheet (linked via root.tsx <Links>)
```

## Flat route conventions

The filename encodes nested routing via `.` separators:

| Filename | URL | Notes |
|---|---|---|
| `_index.tsx` | `/` | Root index |
| `about.tsx` | `/about` | Plain segment |
| `booking._index.tsx` | `/booking` | Index of `booking` segment |
| `booking.$id.tsx` | `/booking/:id` | Dynamic param |
| `booking.$id.edit.tsx` | `/booking/:id/edit` | Nested |
| `_auth.login.tsx` | `/login` | `_auth` is a pathless layout — wraps without adding to URL |
| `($lang).about.tsx` | `/about` and `/en/about` | Optional segment |
| `_index.($lang).about.tsx` | `/about` (with optional lang prefix) | Optional + index |
| `$.tsx` | catch-all | |

When generating prototype paths from Remix routes, strip `_` prefixes (pathless), drop `_index` suffix (becomes the directory's index page), substitute `$param` with sample values.

## Route file anatomy

```tsx
import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from '@remix-run/node';
import { useLoaderData, Form, useActionData } from '@remix-run/react';

// SERVER-ONLY: runs on every page request, returns data for the component
export async function loader({ params, request }: LoaderFunctionArgs) {
  const id = params.id;
  const booking = await db.booking.findUnique({ where: { id } });
  if (!booking) throw new Response('Not Found', { status: 404 });
  return json({ booking });
}

// SERVER-ONLY: runs on form submission (POST/PUT/DELETE)
export async function action({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const status = formData.get('status');
  await db.booking.update({ where: { id: params.id }, data: { status } });
  return json({ success: true });
}

// CLIENT COMPONENT: receives loader data, renders UI
export default function BookingDetail() {
  const { booking } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div>
      <h1>{booking.code}</h1>
      <Form method="post">
        <select name="status" defaultValue={booking.status}>
          <option>confirmed</option>
          <option>cancelled</option>
        </select>
        <button type="submit">Save</button>
      </Form>
      {actionData?.success && <p>Saved!</p>}
    </div>
  );
}
```

## Server vs client — what to keep in prototype

| Export | Runs where | Prototype handling |
|---|---|---|
| `loader` | Server only | Read for data SHAPE; hardcode sample matching that shape |
| `action` | Server only | Replace with `<form onsubmit="...">` + JS that mocks the action's behavior (toast + state mutation) |
| `clientLoader` | Browser | Convert to inline JS that runs on page load |
| `clientAction` | Browser | Convert to inline JS form handler |
| `default export` | Server (SSR) + Client | This is the React component — render its initial HTML output |
| `meta` | Server | Lift into prototype's `<head>` |
| `links` | Server | Lift into prototype's `<head>` |
| `headers` / `loader.headers` | Server | Drop |
| `ErrorBoundary` | Server + Client | Render only when prototype demonstrates errors |
| `HydrateFallback` (clientLoader-using routes) | Client | Render once during loading, then default content |

## Remix imports — strip or replace

| Import | Action in prototype |
|---|---|
| `import { Link } from '@remix-run/react'` | Drop. Replace `<Link to="X">` with `<a href="X.html">` |
| `import { Form } from '@remix-run/react'` | Drop. Replace `<Form method="post">` with `<form onsubmit="...">` |
| `import { useLoaderData } from '@remix-run/react'` | Drop. Inline the data the loader returned |
| `import { useActionData } from '@remix-run/react'` | Drop. Inline the action result OR remove the conditional |
| `import { useNavigation } from '@remix-run/react'` | Drop. Always render the "idle" state |
| `import { useFetcher } from '@remix-run/react'` | Drop. Replace with manual fetch + state |
| `import { redirect } from '@remix-run/node'` | Drop |
| `import { json } from '@remix-run/node'` | Drop, since the loader is gone |
| `import * as db from '~/lib/db'` | Drop. Hardcode sample data |

## Nested routes + outlets

When `app/routes/booking.tsx` exists alongside `app/routes/booking._index.tsx` and `app/routes/booking.$id.tsx`, the parent renders `<Outlet />` and child routes render in that slot:

```tsx
// app/routes/booking.tsx (parent layout)
import { Outlet } from '@remix-run/react';
export default function BookingLayout() {
  return (
    <div className="grid grid-cols-[200px_1fr]">
      <aside>... booking nav ...</aside>
      <main><Outlet /></main>
    </div>
  );
}
```

For prototype:
- Inline the parent's wrapping HTML into each child page (so each prototype HTML file shows the full nested layout)
- Replace `<Outlet />` with the child's rendered HTML

## Form validation patterns

Most common in Remix:
- **Native HTML5 + zod in `action`**: `parse(zodSchema, formData)` server-side. Read schema; emit equivalent client-side validation in prototype.
- **react-hook-form + zod**: same as react.md.
- **Conform** (`@conform-to/zod`): Remix-friendly form helper. Schema-driven; read the schema.

For prototype, always emit BOTH HTML5 attribute (`required`, `pattern`, etc.) AND inline JS check on submit.

## Common Remix UI library integrations

- **shadcn/ui** — same as react.md, components in `app/components/ui/`. Most common modern stack.
- **MUI / Chakra / antd** — work fine in Remix. Class names per library knowledge file.

## Authentication patterns

- **remix-auth** — sessions in cookies, `authenticator.isAuthenticated(request)` in loaders. For prototype, drop entirely.
- **Clerk / Auth0 SDK** — middleware in `entry.server.tsx`. For prototype, drop entirely.

## CSS approach

- **`links` export with stylesheet** — `export const links = () => [{ rel: 'stylesheet', href: tailwindUrl }]`. Lift href into prototype's `<head>`.
- **CSS modules** — same as react.md.
- **Tailwind** — most common. `app/tailwind.css` with directives.

## What the agent should do when reading source-index.json for a Remix project

1. Read `remix.config.{js,ts}` (or `vite.config.ts` for Vite-based Remix) — adapter, dev server config.
2. Read `app/root.tsx` — root layout, links, meta, ErrorBoundary.
3. Read `app/tailwind.css` (or whichever entry CSS the root links) — design tokens.
4. Read 3–5 route files (`app/routes/*.tsx`) matching the feature's domain.
5. Read `app/components/ui/*` (shadcn) or `app/components/*` for design vocabulary.
6. SKIP `app/routes/api.*.tsx` — server-only API routes.

## Copy-from-source discipline (Remix-specific)

- **Loader data shape**: read the loader's return type / Prisma query / database call to learn data shape; hardcode equivalent records.
- **`<Form>` action**: read the corresponding `action` function for what fields the form must send + what validation runs.
- **Nested layouts**: walk up from the route file to the deepest parent `app/routes/*.tsx` (without `.` separator extension) and inline each layout's wrapping HTML.
- **Pending UI** (`useNavigation()`'s `state === 'submitting'`): drop the pending branch; always render the idle state for the demo.
- **`useFetcher` calls**: ignore the fetcher's pending/optimistic states; render the resolved state.
