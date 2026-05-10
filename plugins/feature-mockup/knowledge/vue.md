# Stack knowledge — Vue 3 (Composition API)

Read this when `manifest.stack.framework === "vue"` or `"nuxt"`. Vue 2 (Options API) shares some patterns but has different syntax — flag and ask the user to confirm if you detect Vue 2.

## Single-file component anatomy

```vue
<template>
  <div class="card">
    <h2>{{ title }}</h2>
    <button @click="handleClick">Click</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
const title = ref('Hello')
const handleClick = () => alert('clicked')
</script>

<style scoped>
.card { padding: 16px; }
</style>
```

## Style scoped — what build does + how to undo

`<style scoped>` makes Vue add a `data-v-XXXXXXXX` attribute to every root element of the component AND append `[data-v-XXXXXXXX]` to every selector in that block. So `.card` becomes `.card[data-v-abc123]` at build time.

For a static prototype:
- Strip `[data-v-...]` attribute selectors entirely.
- The unscoped class names (`.card`, `.btn`, etc.) work directly.
- `:deep(.child)` is the explicit-leak operator — replace with just `.child` (drop `:deep()`).
- `:slotted(.x)` — drop the wrapper, keep the inner.
- `:global(.x)` — drop the wrapper, keep the inner.

## Style modules `<style module>`

Use CSS modules — class names are exposed via `$style.btn`. In templates: `<button :class="$style.btn">`. For prototype: extract class names without the hash and use them directly in HTML.

## Template syntax — translate to HTML

| Vue | Static HTML equivalent |
|---|---|
| `{{ expression }}` | The literal value |
| `v-if="cond"` | Render the matching branch only (don't conditionally show in prototype) |
| `v-for="x in items"` | Materialize the loop with sample data — 3-6 fake items |
| `:class="{ active: x }"` | Add `active` class to the relevant element |
| `:style="{ color: x }"` | Inline `style="color: red"` |
| `@click="handle"` | `onclick="alert('(prototype) ...')"` or a navigation `<a>` |
| `v-model="value"` | `value="..."` static |
| `<slot>` | Inline the default slot content |
| `<template #header>` | Render the named slot's HTML |
| `v-html="raw"` | Render as innerHTML (use sparingly) |

## Composition API → static

- `ref(0)`, `reactive({})`, `computed(...)` — drop. The prototype is static.
- Methods inside `<script setup>` — drop unless the function name appears as `@click` handler, in which case stub the behavior with `alert(...)`.
- `defineProps`, `defineEmits`, `defineExpose` — drop.
- `useRoute`, `useRouter` from vue-router — replace with `<a href="...">`.
- Pinia: `const store = useStore()` followed by `store.x` — drop the store import; inline sample data.

## Nuxt 3 quirks

- File-based routing in `pages/` directory: `pages/index.vue`, `pages/booking/[id].vue`. Same translation rules as Next.js — use sample IDs for dynamic segments.
- `definePageMeta({ layout: 'default' })` — read the layout file referenced; layout components live in `layouts/`.
- `<NuxtLink to="/path">` — replace with `<a href="path.html">`.
- `<NuxtImg>` / `<NuxtPicture>` — replace with `<img>`.
- Auto-imports: components in `components/` are auto-imported. When you see `<MyButton>` in a template, the source is in `components/MyButton.vue`.
- Server routes in `server/` — SKIP. Not part of the UI.

## Common Vue/Nuxt UI libraries

- **Vuetify** — `<v-btn>`, `<v-card>`, `<v-data-table>`. Heavy class hierarchy (`.v-btn--variant-elevated`). Cloning components rarely works because Vuetify pulls in the full design system. Prefer reading their docs for the prototype HTML equivalent.
- **Quasar** — `<q-btn>`, `<q-card>`. Similar to Vuetify in heaviness.
- **Element Plus** — `<el-button>`, `<el-input>`. Class names like `.el-button.el-button--primary`.
- **Naive UI** — emotion-based, harder to extract statically.
- **PrimeVue** — `<Button>`, `<DataTable>`. Class names from the imported preset (Lara, Aura).
- **Headless UI Vue** — unstyled, the team's own classes. These are easiest to mirror.

When the source uses a heavy UI library, prefer the team's own custom CSS in `globalStyles` over trying to reproduce the library's full design system.

## Composition patterns to recognize

- Composable functions in `composables/` (Nuxt) or `use*.ts` files (Vue) — these are pure logic, not UI. Skip in the prototype.
- Slots are the main way Vue components compose. When you see `<MyDialog><template #header>...</template>...</MyDialog>`, the prototype renders the dialog with the slot content inlined.

## What the agent should do when reading source-index.json for a Vue project

1. Read `configs.vite.config.*` or `nuxt.config.*` — UI library, plugins, alias paths.
2. Read `globalStyles` for design tokens — Vue projects often have a tokens file in `assets/styles/_variables.scss`.
3. Read `templates` (Vue components ARE templates) for the feature's domain.
4. Read 2-3 layout files if Nuxt — `layouts/default.vue`, `layouts/admin.vue`.
5. Read `components/Base*.vue` or `components/ui/*` for the design vocabulary.

## Copy-from-source discipline (Vue-specific)

When you read a Vue SFC from `source-copy/`, treat the `<template>` block as ground truth:

- **`v-for` materialization**: count items from the source's typical data shape, render that many in static HTML. Don't curate down.
- **`v-if` / `v-else`**: in source, only one branch shows at a time. In prototype, render the happy path branch and note the alternative.
- **`<Component :is="...">` dynamic components**: resolve to the most common variant.
- **Slots**: when a parent uses `<Modal><template #header>`, inline the slot content into the modal's header div in the prototype.

## Admin patterns (when uiLib is element-plus / vuetify / primevue)

Element Plus admins (KR/CN enterprise):
- `<el-table>` — `:data` is the rows, `<el-table-column prop="field">` are columns. Each `<el-table-column>` may have `label`, `width`, `formatter` slot, `template #default="scope"`. Mirror in static HTML.
- `<el-form>` with `:rules` — extract validation rules into prototype's inline JS.
- `<el-dialog>` — overlay pattern. Use `<dialog>` element or fixed-position overlay.
- `<el-pagination>` — render as the standard pagination component (`« ‹ 1 2 3 › »`).

Vuetify admins:
- `<v-data-table>` `headers` prop = column definitions; `items` = rows.
- `<v-card>` is the standard card; thin shadow + 4px radius.
- `<v-btn variant="elevated">` / `"flat"` / `"outlined"` — render with shadcn-equivalent classes.

PrimeVue admins:
- `<DataTable>` columns via `<Column field="...">`. Similar to Element Plus.
- `<Dialog>` overlay component with `:visible.sync` (Vue 2) or `v-model:visible` (Vue 3).

## Form validation patterns

- **VeeValidate v4 + zod/yup**: `const { errors, handleSubmit } = useForm({ validationSchema })`. Read schema, replicate.
- **Element Plus `<el-form :rules>`**: rules object maps field names to validators array.
- **Vuelidate**: `v$ = useVuelidate(rules, state)`. Read the rules object.
- **Native HTML5 attributes** on inputs work the same as React — keep verbatim.

## State management

- **Pinia** stores in `stores/`: `defineStore('id', { state, getters, actions })`. Read the state shape for mock-data hints; ignore actions (the prototype doesn't fetch).
- **Vuex** (Vue 2 legacy): same idea — read `state` and `getters` for shape only.
- **Composables in `composables/`**: pure logic + reactive state, no UI. Skip.
