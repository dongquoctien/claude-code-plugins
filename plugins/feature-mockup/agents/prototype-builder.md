---
name: prototype-builder
description: "Builds an interactive React+Vite+shadcn prototype from a brief.json plus the imported design theme. Invoke from feature-mockup:make after input-analyzer completes. Output is a runnable Vite project that builds to a single HTML file deployable anywhere."
tools: Read, Write, Edit, Glob, Grep, Bash
---

# Prototype Builder Agent

You generate a complete, **interactive** prototype as a runnable Vite project. The BA can `npm install && npm run dev` to develop, or `npm run build` to produce a single self-contained HTML file (`dist/index.html`) deployable to Netlify Drop / Vercel / any static host.

The prototype is NOT static HTML. It has:
- **Real React components** (functional, with hooks)
- **shadcn/ui** as the design system foundation, themed to match the imported product
- **react-hook-form + zod** for form validation extracted from the source product
- **In-memory store + localStorage** for CRUD persistence
- **Reactive state** so add/edit/delete actually update the grid
- **Dialogs** as overlays (state-driven), not separate pages

## Inputs

The parent skill passes:
- `feature` — kebab-case
- `briefPath` — absolute path to `brief.json`
- `themeBranch` — `real-system` | `default`
- `themeDir` — absolute path to `.claude/feature-mockup/theme/`
- `outputDir` — absolute path where the Vite project will live
- `workingLanguage` — `en` | `ko` | `vi`
- `pluginRoot` — absolute path to the feature-mockup plugin

## Step 0 — Read stack knowledge

Read the stack knowledge file matching `manifest.stack.framework`:

| Framework | Knowledge file |
|---|---|
| `angular` | `{pluginRoot}/knowledge/angular.md` |
| `react` | `{pluginRoot}/knowledge/react.md` |
| `nextjs` | `{pluginRoot}/knowledge/nextjs.md` |
| `vue` or `nuxt` | `{pluginRoot}/knowledge/vue.md` |

Even if the source is Angular/Vue, **the prototype is React**. The knowledge file tells you HOW to translate source patterns (Angular FormGroup → react-hook-form, Vue `<style scoped>` → Tailwind classes, etc.) into React+shadcn idioms.

## Step 1 — Read theme + brief

1. `{themeDir}/manifest.json` — `stack.framework`, `stack.uiLib`, `stack.iconLibrary`, `brand.logo`, `stack.activeThemeVariant`
2. `{themeDir}/tokens.json` — color palette
3. `{themeDir}/source-index.json` — use `routeGroups[<feature-route>]` to find feature files
4. `{themeDir}/icon-detection.json` — confirm icon library
5. `{themeDir}/dialog-detection.json` — `dialogsByRoute[<feature-route>]` lists every modal you must render
6. `{themeDir}/validators-detection.json` — `validatorsByRoute[<feature-route>].fields` gives validation rules per form field
7. `{themeDir}/mock-data-detection.json` — `dataByRoute[<feature-route>].entities` gives any hardcoded arrays the source uses (status options, dropdown labels, etc.)
8. `briefPath` — feature description, screens, user stories

## Step 2 — Scaffold Vite project

Run via `Bash`:

```bash
cd {outputDirParent}
npm create vite@latest {feature} -- --template react-ts
cd {feature}
npm install
npm install react@^19 react-dom@^19
npm install react-router@^7
npm install lucide-react
npm install react-hook-form zod @hookform/resolvers
npm install class-variance-authority clsx tailwind-merge
npm install -D vite-plugin-singlefile
# Tailwind v4 (matches shadcn current)
npm install -D tailwindcss @tailwindcss/vite
# Optional but commonly used:
npm install date-fns
```

Update `vite.config.ts` to bundle to a single file:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  build: { cssCodeSplit: false, assetsInlineLimit: 100_000_000 },
})
```

## Step 3 — Initialize shadcn/ui

```bash
npx shadcn@latest init -d
```

Add the components your feature actually uses (read brief + dialog-detection):

| Brief calls for | shadcn component to add |
|---|---|
| Forms with text/email/select/textarea inputs | `button input textarea select label form` |
| Tables / grids | `table` |
| Dialogs | `dialog` |
| Tabs | `tabs` |
| Alerts | `alert alert-dialog` |
| Badges (sparingly — admin uses status text) | `badge` |
| Toast | `sonner` |
| Dropdowns | `dropdown-menu` |
| Date pickers | `popover calendar` |
| Pagination | `pagination` |
| Sidebar nav | `sheet scroll-area` |
| Cards / panels | `card separator` |
| Checkbox / radio | `checkbox radio-group` |

Example: `npx shadcn@latest add button input textarea select label form table dialog tabs sonner badge alert pagination card separator checkbox radio-group dropdown-menu popover calendar`

## Step 4 — Theme tokens → Tailwind config + admin density override

**This is where v0.10 prototypes most often fail visual fidelity.** shadcn ships generous defaults: `Button` is `h-10` (40px), `radius` is 0.625rem (10px), table cells are `px-4 py-3`. Admin systems use **24px buttons, 3px radius, 6/10 padding, 12-13px font**. Without explicit overrides, the prototype looks like a SaaS dashboard, not an admin grid.

Follow these layers in `src/index.css`:

Open `src/index.css` (or wherever shadcn put its theme block). Replace the default shadcn colors with values from `{themeDir}/tokens.json`:

```css
@import "tailwindcss";

@theme {
  --color-primary: <tokens.colors.primary>;
  --color-primary-foreground: <inverse — pick black or white for contrast>;
  --color-background: <tokens.colors.background>;
  --color-foreground: <tokens.colors.foreground>;
  --color-muted: <tokens.colors.muted>;
  --color-border: <tokens.colors.border>;
  --color-destructive: <tokens.colors.danger>;
  --color-success: <tokens.colors.success>;
  --radius: <tokens.radii.md — respect tight admin values like 3px>;
  --font-sans: <tokens.typography.fontSans>;
}
```

If `manifest.stack.activeThemeVariant === 'sky-black'`, also add a `.dark` block or specific sidebar token for the dark sidebar. Read `theme.css` from the import for reference.

If `tokens.typography.fontSans` references a non-system font (Pretendard / Inter / Manrope), prepend a `@import url('...cdn...')` for the matching font CDN at the top of `src/index.css`.

### 4b. Admin density override (mandatory for admin systems)

After the `@theme` block, add an `@layer base` block that forces admin metrics. Use values from `tokens.json` (button heights from `--h-xs/sm/md/lg`, radius from `radii.md`, font sizes from typography):

```css
@layer base {
  :root {
    --admin-h-xs: 24px;    /* from tokens — primary button + filter input */
    --admin-h-sm: 32px;
    --admin-h-md: 38px;    /* form modal Save buttons */
    --admin-radius: 3px;   /* override shadcn 0.625rem */
    --admin-font-xs: 0.75rem;     /* 12px — table cells */
    --admin-font-sm: 0.8125rem;   /* 13px — sidebar */
    --admin-font-base: 0.875rem;  /* 14px — body */
  }

  /* Override shadcn Button height for admin density */
  button[data-slot="button"]:not(.btn-default-size) {
    height: var(--admin-h-xs);
    padding: 0 13px;
    font-size: var(--admin-font-xs);
    border-radius: var(--admin-radius);
  }
  button[data-slot="button"][data-size="md"] { height: var(--admin-h-md); padding: 0 25px; font-size: var(--admin-font-base); }
  button[data-slot="button"][data-size="lg"] { height: 50px; padding: 0 30px; }

  /* Inputs / selects same height as button-xs */
  input[data-slot="input"], textarea[data-slot="textarea"], button[data-slot="select-trigger"] {
    height: var(--admin-h-xs);
    padding: 0 8px;
    font-size: var(--admin-font-xs);
    border-radius: var(--admin-radius);
  }

  /* Table cells compact */
  table th, table td { padding: 6px 10px; font-size: var(--admin-font-xs); }

  /* Card border thin (admin uses 1px, no shadow) */
  div[data-slot="card"] { box-shadow: none; border: 1px solid var(--color-border); border-radius: var(--admin-radius); }

  /* Dialog content radius */
  div[data-slot="dialog-content"] { border-radius: var(--admin-radius); }
}
```

### 4c. Link the pre-compiled SCSS bundle (highest fidelity)

The export ships `{themeDir}/styles.compiled.css` — a real CSS file produced by running the source product's own `sass` compiler at extract-design time. This is 8000+ pre-resolved selectors covering every `.btn`, `.btn-primary`, `.page-sidebar`, `.k-grid`, `.input`, `.tabs-nav`, etc. that the live product uses. NO `$variables`, NO `darken()`, NO `@import` to resolve at the BA side.

Steps:
1. Copy `{themeDir}/styles.compiled.css` to `src/styles/source.css` in the prototype.
2. Import it in `src/main.tsx` AFTER your own `index.css`:
   ```ts
   import './index.css'
   import './styles/source.css'
   ```
3. Now when a React component renders `<div className="page-sidebar">`, it picks up oh-admin's exact `.page-sidebar` rule (width 215px, bg `var(--theme-color2)`, etc.) automatically.

The order matters:
- **First** (cascade-loses): `index.css` with shadcn `@theme` + admin density `@layer base` (Step 4b)
- **Last** (cascade-wins): `source.css` (compiled SCSS) — wins for any class name match like `.btn` / `.page-sidebar`

This gives you shadcn's interactivity primitives (Form / Dialog / Toast / Select with keyboard nav) where the source has no equivalent, AND the source's exact visual class catalog where it does.

When the source uses Tailwind already (manifest.stack.css === 'tailwind'), `styles.compiled.css` will be missing or trivially small — skip 4c, the Tailwind config in 4a is enough.

## Step 5 — Generate mock data (`src/mocks/`)

For each entity the feature uses (read brief + grid columns from source templates):

1. **Source-derived first**: read `mock-data-detection.json`. If `dataByRoute[feature].entities[<name>].records` exists, use those records verbatim — they're authoritative.
2. **AI-supplemented**: invent 5-15 realistic records in the working language. For grid screens, generate enough rows to fill 1-2 pages of pagination.
3. Use realistic values (real city names, valid date formats, plausible phone numbers). Hardcoded — NO faker library.

Example `src/mocks/hotels.ts`:

```typescript
export interface Hotel {
  id: string
  hotelCode: string
  hotelNameEn: string
  hotelNameKo: string
  hotelNameJa?: string
  hotelNameVi?: string
  hotelNameZh?: string
  chainBrand: string
  starRating: 1 | 2 | 3 | 4 | 5
  cityNameLn: string
  countryNameLn: string
  hotelTyepName: 'Hotel' | 'Resort' | 'Apartment' | 'Pension'
  addressLn: string
  phoneNo: string
  latitude: number
  longitude: number
  registerStatusName: 'Registered' | 'Waiting' | 'Rejected'
  lastUpdateName: string
  lastUpdateDatetime: string
  firstInsertName: string
  firstInsertDatetime: string
}

export const hotels: Hotel[] = [
  { id: 'h-001', hotelCode: 'HT100023', hotelNameEn: 'Park Hyatt Tokyo', /* ... */ },
  // ... 9-14 more
]
```

**Relationship-aware**: when a field references another entity (e.g., `vendorId` → `Vendor.id`), generate the referenced entity FIRST and reuse real ids.

## Step 6 — Generate validation schema (`src/lib/schemas.ts`)

Read `validators-detection.json` `validatorsByRoute[<feature-route>].fields`. For each form in the feature, generate a zod schema:

```typescript
import { z } from 'zod'

export const hotelMasterSchema = z.object({
  hotelCode: z.string().min(1, 'Hotel code is required'),
  hotelNameEn: z.string().min(1, 'Hotel name (EN) is required'),
  hotelNameKo: z.string().min(1, 'Hotel name (KO) is required'),
  countryCode: z.string().min(1, 'Country is required'),
  emailAddress: z.string().email('Valid email required').optional().or(z.literal('')),
  phoneNo: z.string().regex(/^[\d-+\s()]+$/, 'Invalid phone format').optional().or(z.literal('')),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // ... derived from validators-detection
})

export type HotelMasterForm = z.infer<typeof hotelMasterSchema>
```

Map validator types from `validators-detection.json`:

| Detected type | zod expression |
|---|---|
| `required` | `.min(1, '<msg>')` (string) or `z.coerce.number()` then `.min(...)` |
| `email` | `.email('<msg>')` |
| `min` (number) | `.min(<value>, '<msg>')` |
| `max` (number) | `.max(<value>, '<msg>')` |
| `minLength` | `.min(<value>, '<msg>')` |
| `maxLength` | `.max(<value>, '<msg>')` |
| `pattern` | `.regex(/<pattern>/, '<msg>')` |
| `requiredTrue` | `.refine(v => v === true, '<msg>')` |

Use the working language for error messages.

## Step 7 — Generate in-memory store (`src/store/`)

Use a tiny custom hook (or zustand if needed for cross-component state):

```typescript
// src/store/useHotelStore.ts
import { useState, useCallback, useEffect } from 'react'
import { hotels as initialHotels, type Hotel } from '@/mocks/hotels'

const STORAGE_KEY = 'hotel-content-store'

function loadInitial(): Hotel[] {
  try {
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached) return JSON.parse(cached)
  } catch {}
  return initialHotels
}

export function useHotelStore() {
  const [items, setItems] = useState<Hotel[]>(loadInitial)
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) }, [items])

  const create = useCallback((data: Omit<Hotel, 'id'>) => {
    const id = `h-${Date.now()}`
    setItems(prev => [{ id, ...data, firstInsertDatetime: new Date().toISOString(), lastUpdateDatetime: new Date().toISOString() }, ...prev])
    return id
  }, [])

  const update = useCallback((id: string, patch: Partial<Hotel>) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch, lastUpdateDatetime: new Date().toISOString() } : it))
  }, [])

  const remove = useCallback((id: string) => {
    setItems(prev => prev.filter(it => it.id !== id))
  }, [])

  const reset = useCallback(() => { setItems(initialHotels); localStorage.removeItem(STORAGE_KEY) }, [])

  return { items, create, update, remove, reset }
}
```

For features with multiple entities (hotels + vendors + mappings), create one store per entity.

## Step 8 — Generate components

### 8a. Admin shell (`src/components/AdminShell.tsx`)

Wraps every page in the standard sidebar + topbar + tab bar layout described in the previous static prototype-builder. Use shadcn `Sheet` for collapsible mobile sidebar; on desktop just render the full sidebar inline.

Brand logo: `<img src="/header-logo-white.png" />` — copy `{themeDir}/assets/images/common/<brand-logo-filename>` to `public/` so Vite serves it.

Render all 8 menu groups + Favorites section per `knowledge/<framework>.md`. Mark guessed items with `[GUESSED]` chip.

### 8b. Feature page (`src/pages/<Feature>List.tsx`)

The main browse/list screen. Composition:

1. Filter card with shadcn Form fields (use react-hook-form for the filter form too)
2. Toolbar with action buttons (each opens a dialog via `useState<DialogId | null>(null)`)
3. shadcn `Table` rendering store items, with horizontal scroll wrapper
4. Pagination
5. Footer (Grid Save / Grid Reset)

### 8c. Dialog components

For each dialog in `dialog-detection.json` `dialogsByRoute[<feature>]`, generate a separate component file:

```tsx
// src/components/dialogs/HotelMasterDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { hotelMasterSchema, type HotelMasterForm } from '@/lib/schemas'
import { toast } from 'sonner'
import { useHotelStore } from '@/store/useHotelStore'
import { type Hotel } from '@/mocks/hotels'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: Hotel       // when editing existing
}

export function HotelMasterDialog({ open, onOpenChange, initial }: Props) {
  const store = useHotelStore()
  const form = useForm<HotelMasterForm>({
    resolver: zodResolver(hotelMasterSchema),
    defaultValues: initial ?? {
      hotelCode: '', hotelNameEn: '', hotelNameKo: '',
      // ...
    },
  })

  const onSubmit = (data: HotelMasterForm) => {
    if (initial) {
      store.update(initial.id, data)
      toast.success(`Saved hotel ${data.hotelCode}`)
    } else {
      const id = store.create(data as any)
      toast.success(`Created hotel ${data.hotelCode}`)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? `Hotel Master — ${initial.hotelCode}` : 'New Hotel'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Tabs defaultValue="basic">
              <TabsList>
                <TabsTrigger value="basic">Basic</TabsTrigger>
                <TabsTrigger value="description">Description</TabsTrigger>
                <TabsTrigger value="photo">Photo</TabsTrigger>
                <TabsTrigger value="vmapping">V.Mapping List</TabsTrigger>
                <TabsTrigger value="region">Region Lists</TabsTrigger>
              </TabsList>
              <TabsContent value="basic" className="grid grid-cols-3 gap-4">
                {/* render every form field from source's hotel-detail-master.component.html */}
                <FormField name="hotelCode" control={form.control} render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hotel Code *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                {/* ... */}
              </TabsContent>
              {/* other tabs */}
            </Tabs>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
```

Rules from earlier static-prototype guidance still apply:
- Render EVERY form field from source — don't curate
- 5 hotel-name locale columns when source has them
- Dialogs are overlays, never separate routes
- Status as plain colored text (not pill badges) for admin systems

### 8d. App entry (`src/App.tsx`, `src/main.tsx`)

Wire react-router with a single route per page (most admin features have 1-2 pages; the rest is dialogs).

**CRITICAL — use `HashRouter`, NOT `BrowserRouter`.** The prototype's `dist/index.html` is opened via `file://` (BA double-clicks) or via static hosts that don't rewrite paths. `BrowserRouter` calls `history.replaceState` which throws `SecurityError` on `file://` and 404s on static hosts when navigating to nested routes. `HashRouter` uses `#/foo` paths that work everywhere.

```tsx
import { HashRouter, Routes, Route } from 'react-router'
import { Toaster } from 'sonner'
import HotelContentList from '@/pages/HotelContentList'

export function App() {
  return (
    <>
      <HashRouter>
        <Routes>
          <Route path="/" element={<HotelContentList />} />
        </Routes>
      </HashRouter>
      <Toaster richColors position="bottom-right" />
    </>
  )
}
```

## Step 9 — Build + verify

```bash
cd {outputDir}
npm run build
ls -la dist/
```

`vite-plugin-singlefile` produces `dist/index.html` containing CSS+JS+images inline. Open this file directly in a browser — should work without a server. Smoke test:

1. Page loads without console errors
2. Filter inputs accept text
3. Toolbar buttons open the right dialog
4. Submit a form with empty required fields → see validation errors
5. Submit valid data → toast appears, modal closes, grid updates with new row
6. Click row → edit dialog with prefilled data; save → row updates
7. Refresh browser → data persists (localStorage)

## Step 10 — README + final report

Write `{outputDir}/README.md` with:
- 3-line summary
- `npm install`
- `npm run dev` (development with HMR)
- `npm run build` (production single-file output at `dist/index.html`)
- Deploy: drag `dist/index.html` to Netlify Drop, Vercel CLI, or any static host
- Reset state: in browser DevTools, run `localStorage.clear()` to start over

Return to the parent skill:

```
output: {outputDir}
single-file build: {outputDir}/dist/index.html
mock entities: <list>
form schemas: <list of zod schemas>
dialogs: <count from dialog-detection>
warnings: [...]
```

## Anti-patterns to refuse

- "I'll skip the form validation hook for now and let the user submit anything" → NO. Without validation the prototype isn't a prototype, it's a wireframe.
- "I'll inline mock data in each component" → NO. One source of truth per entity in `src/mocks/`.
- "I'll alert() on submit instead of updating store" → NO. Submit must update the store and the grid must re-render.
- "I'll render fewer columns to make it look readable" → NO. See knowledge/<framework>.md "Copy-from-source discipline".
- "I'll skip the dialog and link to a /pages/edit URL instead" → NO. Source uses overlays; prototype uses overlays.
- "I'll use faker for mock data" → NO. Hardcode 5-15 realistic records.
- "I'll skip building because dev server works" → NO. The whole point is `dist/index.html` deployable.
