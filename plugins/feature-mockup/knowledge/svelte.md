# Stack knowledge — Svelte / SvelteKit

Read this when `manifest.stack.framework === "svelte"` or `"sveltekit"`.

## Svelte file anatomy

```svelte
<script lang="ts">
  let count = 0;
  $: doubled = count * 2;          // reactive declaration
  function handleClick() { count++; }
</script>

<div class="card">
  <h2>{count}</h2>
  <button on:click={handleClick}>Increment</button>
  {#if count > 5}
    <p>Big!</p>
  {/if}
  {#each items as item}
    <li>{item.name}</li>
  {/each}
</div>

<style>
  .card { padding: 16px; }
</style>
```

## Style scoping — Svelte adds class hashes

`<style>` blocks in Svelte components are scoped by adding a hash class to every selector and the rendered DOM (`.card.svelte-abc123`). For a static prototype:

- Strip the hash (`.svelte-XXXXXX`) suffix from class names.
- Unscoped class names work directly.
- `:global(.x)` in Svelte's `<style>` — drop the `:global()` wrapper, keep `.x`.
- `:global` block syntax — keep all rules inside but at root level.

## Template syntax — translate to HTML

| Svelte | Static HTML equivalent |
|---|---|
| `{expression}` | The literal value |
| `{#if cond}...{/if}` | Render the matching branch only |
| `{#each items as item}` | Materialize the loop with sample data |
| `{#await promise}...{:then val}` | Render the resolved branch |
| `{:else if cond}` | Pick the matching branch |
| `class:active={cond}` | Add `active` class statically |
| `class={`item ${cond ? 'active' : ''}`}` | Resolve template literal to a static class string |
| `style:color={x}` | Inline `style="color: red"` |
| `on:click={handle}` | `onclick="alert('(prototype) ...')"` |
| `bind:value={x}` | `value="..."` static |
| `<slot />` | Inline default slot content |
| `<slot name="header" />` | Inline named slot HTML |

## Reactive declarations / stores

- `$: derived = expr` — drop. The prototype is static; compute the value once and inline.
- `import { writable } from 'svelte/store'` — drop store imports.
- `$count` syntax (auto-subscription) — replace with the literal current value.

## SvelteKit routing

File-based: `routes/about/+page.svelte` → `/about`.

- `+page.svelte` is the page component
- `+page.server.ts` is server-only data loading (skip — prototype is client-only)
- `+layout.svelte` wraps every child route in this folder (similar to Next.js layouts)
- `+error.svelte` is the error fallback
- `+page.ts` is the universal load function — read for state shape

For prototype:
- Route `routes/booking/[id]/+page.svelte` → prototype path `pages/booking-detail.html` with a sample `id`.
- Route `routes/+layout.svelte` → wrap every prototype page in this layout's HTML structure (header / sidebar / etc).

`<a href="...">` is the standard navigation in Svelte (no special `<Link>` component needed). Keep verbatim, just rewrite the path to the prototype's flat structure.

## Common SvelteKit patterns

- **Form actions** in `+page.server.ts` — server-side, skip.
- **`<form action="?/submit" use:enhance>`** — replace with `<form onsubmit="...">` + JS.
- **`enhance` action** — drops the form's progressive-enhancement layer; the prototype runs JS only.
- **`page.data` / `page.params`** — replace with hardcoded values.
- **`goto('/path')`** — replace with `window.location.href = './path.html'`.

## Common Svelte UI libraries

- **Skeleton UI** — Tailwind-based, classes like `.btn .variant-filled-primary`. Mirror by extracting the utility chain.
- **Flowbite Svelte** — wraps Flowbite (Tailwind) components. Class names match Flowbite conventions.
- **Carbon Components Svelte** — IBM Carbon system. Heavy class hierarchy (`.bx--btn.bx--btn--primary`).
- **SvelteKit-native admin templates** (e.g. shadcn-svelte) — port of shadcn for Svelte; same `--primary` / `--destructive` token system.

When the source uses no UI library, the team's own classes in `<style>` blocks are the design system — extract these.

## Form validation patterns

- **Felte + zod/yup**: `const { form } = createForm({ validate: validator({ schema }) })`. Read schema for rules.
- **Superforms (SvelteKit)**: `superValidate(zod(schema))`. Read schema.
- **Native HTML5 attributes**: `<input required pattern="...">` — keep verbatim.

## Copy-from-source discipline (Svelte-specific)

- **`{#each items as item}` count**: derive from typical source data. Don't curate.
- **`{#if loaded}` branches**: render the loaded branch (happy path).
- **Slots**: inline the slot content.
- **Reactive `$:` blocks**: compute once and inline the result.
- **Custom actions (`use:tooltip`)**: skip — prototype doesn't run actions.

## What the agent should do when reading source-index.json for a Svelte project

1. Read `configs.svelte.config.*` and `vite.config.*` — alias paths, preprocessor setup.
2. Read `app.css` / `app.html` for global styles + tokens.
3. Read `+layout.svelte` files (root + nested) — these wrap every page.
4. Read 2-3 `+page.svelte` files matching the feature's domain.
5. Read `lib/components/*` for the design vocabulary (`Button.svelte`, `Card.svelte`).
6. SKIP `+page.server.ts` and `routes/api/**` — server-only.
