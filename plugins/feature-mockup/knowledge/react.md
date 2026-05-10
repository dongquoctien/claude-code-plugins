# Stack knowledge — React (with Tailwind / shadcn / MUI / AntD)

Read this when `manifest.stack.framework === "react"` and uiLib is one of `shadcn`, `chakra`, `material`, `antd`, or `none`.

## How styles flow

- React itself is style-agnostic. Source of truth depends on `manifest.stack.uiLib` and `manifest.stack.css`:
  - `tailwind` → utility classes inline on JSX. Theme lives in `tailwind.config.{js,ts}`.
  - `shadcn` → Tailwind + components copied into `components/ui/` (button.tsx, card.tsx). Uses `cn()` helper from `@/lib/utils`. Class-variance-authority (cva) for variant patterns.
  - `material` → `@mui/material` components with `sx` prop or `styled()` from `@mui/system`.
  - `antd` → `antd` components with className overrides via `theme.token`.
  - `chakra` → `@chakra-ui/react` with style props (`color`, `fontSize` directly on components).
  - CSS modules (`.module.css`) → scoped class names, hash-based.
  - styled-components / emotion → CSS-in-JS, styles co-located in component files.

## Tailwind quirks

- Tailwind classes must exist in the JIT scan list. If you generate a class the user's `tailwind.config.content` doesn't cover, it won't render. Stick to standard utility names (`bg-blue-500`, `px-4`, `rounded-md`).
- Custom theme keys (`bg-brand`, `text-accent`) only work if defined in `theme.extend.colors`. Read `tailwind.config.*` from `manifest.files.tokens` source — the plugin already extracted these.
- `@apply` is build-time only. Don't use `@apply` in prototype CSS; inline the utilities instead.
- `@layer` directives stratify base/components/utilities. In a static prototype, drop `@layer` and write rules at root level.

## shadcn patterns (most common modern React)

Components copied into the codebase use these patterns:

```tsx
// Class merging with cn() — uses clsx + tailwind-merge
import { cn } from "@/lib/utils"

// CVA for variants
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium",
  {
    variants: {
      variant: { default: "bg-primary text-primary-foreground", destructive: "bg-destructive ..." },
      size: { default: "h-10 px-4", sm: "h-9 px-3", lg: "h-11 px-8" },
    },
  }
)
```

When generating a prototype:
- Match shadcn class conventions: `bg-primary`, `bg-destructive`, `text-muted-foreground`, `border-input`, `ring-ring`. These map to CSS custom properties: `--primary`, `--destructive`, etc.
- shadcn theme is in `globals.css` via `:root { --primary: 222.2 47.4% 11.2%; ... }` (HSL components, no `hsl()` wrapper). Inject these literally.
- `--radius` is the canonical radius variable (default 0.5rem). All `rounded-md` derivatives compute from it.
- Prefer `<Button variant="outline">` over hand-rolling button classes when the cloned components folder has `button.tsx`.

## CSS-in-JS extraction (styled-components / emotion)

- Source files have tagged templates: `` const Btn = styled.button`background: red` ``. The plugin's concat-component-styles only catches `.module.css`, NOT styled-components.
- For prototype: read the JSX, extract the styled name, and write equivalent Tailwind utilities OR a small `<style>` block. The `cn`/`tw` patterns most teams use map cleanly.
- emotion's `css` prop: `<div css={{ color: 'red' }}>` — convert to inline `style={{ color: 'red' }}` for the prototype.

## CSS modules

`Button.module.css` exports class names hashed at build (`Button_btn__a9f2K`). For a prototype:
- Read `.module.css` content, generate equivalent classes WITHOUT the hash, scoped via a parent class name (e.g. `.button-root .btn`).
- Or copy the CSS verbatim and use the original class names — works fine in static HTML.

## Form patterns

- `react-hook-form` with `<input {...register('email')}>` — strip the spread, replace with `name="email"`.
- Controlled `<input value={x} onChange={...}>` — replace with `<input value="..." onchange="...">` static value.
- `<form onSubmit={...}>` — replace with `<form onsubmit="event.preventDefault();alert('(prototype) submit')">`.

## Routing

- React Router: `<Link to="/path">` → `<a href="./path.html">` for the prototype's flat file structure.
- Next.js Link: `<Link href="/path">` → same.
- File-based routing: when the source uses `app/` or `pages/` directories with `+page.tsx` files, generate one `.html` per route in the prototype (already the html-tailwind template's behavior).

## What the agent should do when reading source-index.json for a React project

1. Read `configs.tailwind.config.*` — tells you the theme palette and extends.
2. Read `globalStyles` — `globals.css` with `:root { --primary: ... }` shadcn-style is the second source of tokens.
3. Read `components` bucket filtered to `components/ui/` (shadcn) or root `components/` (custom). These define your design vocabulary: Button, Card, Input, Dialog.
4. Read `templates` is empty for React — JSX components ARE the templates. Read 3-5 component files matching the feature's domain.
5. SKIP `node_modules` references — the prototype won't have those.

## Copy-from-source discipline (React-specific)

When you read a React component file from `source-copy/`, treat its rendered JSX tree as ground truth:

- **Map children**: `{items.map(item => <Row .../>)}` — count what the source renders. If a typical sample data has 17 fields, render 17 columns in the prototype, not "the important ones".
- **Conditional rendering**: `{cond && <Foo />}` and `{cond ? <A /> : <B />}` — render BOTH branches with comments, OR pick the most common branch (for the demo's happy path) and note the alternative in the report.
- **Props with defaults**: `<Button variant={variant ?? "default"}>` — use the default in the prototype unless the brief specifies otherwise.
- **Spread props `{...rest}`**: when a component spreads, look up its definition and inline the props it actually consumes.
- **Custom hooks (`useFooData`)**: don't try to execute. Read the hook body to see what shape it returns, then hardcode mock-data of that shape in the prototype.

## Admin patterns (when uiLib is shadcn / mui / antd / chakra)

Modern React admins built with shadcn:
- `<DataTable>` from `@tanstack/react-table` + shadcn wrappers. Cells often have nested formatters; copy the formatter logic into prototype HTML manually.
- `<Form>` from `react-hook-form` + zod schemas. Read the schema for validation rules; the prototype's inline JS replicates them.
- `<Dialog>` from `@radix-ui/react-dialog` or shadcn's wrapped version. Anatomy: `Dialog → DialogTrigger → DialogContent → DialogHeader → DialogTitle → DialogFooter`. Mirror that structure in static HTML with `<dialog>` element + helper functions.
- `<Sheet>`, `<Drawer>`, `<Popover>` — radix primitives. Prototype these as fixed-position panels with backdrop overlays.

MUI admins:
- `<DataGrid>` from `@mui/x-data-grid` — column definitions are arrays of objects with `field`, `headerName`, `valueFormatter`. Read these; render as `<table>` columns.
- `<Paper>` is the card primitive — `box-shadow`, white bg, 4px radius.
- `<Typography variant="h6">` — match font-size from theme.typography.

Ant Design admins:
- `<Table>` `columns` prop is the source of truth. `dataIndex` = field name; `render` function = cell formatter.
- `<Form.Item>` — label position, validation rules.
- `<Drawer>`, `<Modal>` — render as fixed-position overlays.

## Form validation patterns

- **react-hook-form + zod**: `const schema = z.object({ email: z.string().email() })`. Read the schema; emit equivalent HTML5 validation + JS rules in prototype.
- **Formik + Yup**: `Yup.object({ email: Yup.string().email().required() })`. Same approach.
- **react-final-form**: similar; less common.
- **Native HTML5**: `<input required pattern="...">` — keep verbatim.
