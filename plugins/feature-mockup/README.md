# feature-mockup

> A Claude Code plugin for **Business Analysts and Planners**: turn a feature description plus screenshots and reference docs into a runnable prototype that stakeholders and devs can click through.

## Why

Most planning tools stop at a spec. By the time devs read it, the BA has already lost half the room to "I can't picture this." `feature-mockup` closes that gap by **generating a real, opens-in-a-browser prototype** from whatever you have on hand — text, screenshots, even just a vague idea.

## Highlights

- **One command, one prototype.** `/feature-mockup:make "<feature>" [inputs...]`
- **Multi-modal input.** Mix text, PNG/JPG screenshots, Markdown/PDF docs in any combination.
- **Two templates.** Pick between zero-install HTML+Tailwind (best for demos) and full React+Vite (best when devs will fork it).
- **Real-system theming.** When devs export your front-end's tokens and components, the prototype picks them up so it looks like the real product.
- **Safe defaults.** No theme imported? The plugin picks a sensible neutral + accent palette automatically.
- **Works in en / ko / vi.** Pick the working language at init; all prompts and generated copy follow it.

## Install

```bash
/plugin marketplace add dongquoctien/claude-code-plugins
/plugin install feature-mockup@dongquoctien-claude-plugins
```

## Quick start

### For developers (one-time, when shipping a design system update)

```bash
# Run from inside your front-end project root (where package.json or angular.json lives)
cd <path-to-your-frontend-project>
/feature-mockup:extract-design

# A wizard walks through stack detection, style sources, and component selection,
# then writes ./fe-design-export.zip. Hand that zip to your BA.
```

### For BAs

```bash
# 1. Set up once per project
/feature-mockup:init

# 2. (Optional, but highly recommended) Import the dev's design export
/feature-mockup:ingest-theme ./from-dev/fe-design-export.zip

# 3. Make your first prototype — text + screenshots + docs in any combination
/feature-mockup:make "<feature-name>" ./screenshots/some-screen.png ./refs/spec.md

# 4. Open the result in a browser
/feature-mockup:preview "<feature-name>"

# 5. (Optional) Compare prototype against the real admin or screenshots → gap report
/feature-mockup:verify "<feature-name>"

# 6. (Optional) Apply fixes from the report or describe issues yourself
/feature-mockup:fix "<feature-name>"
```

## How it works

```
/feature-mockup:make "feature" [inputs...]
        │
        ├─ input-analyzer agent
        │   reads description + images + docs (multi-modal)
        │   → docs/mockups/feature/brief.json
        │
        ├─ theme branch?
        │   ├─ real-system  →  use imported tokens + cloned components
        │   └─ default      →  Tailwind preset, AI-picked accent
        │
        └─ prototype-builder agent
            spec + theme + chosen template
            → docs/mockups/feature/  (runnable)
```

## Skills

| Skill | Audience | Purpose |
|---|---|---|
| `/feature-mockup:init` | BA | Initialize `.claude/feature-mockup.json` per project |
| `/feature-mockup:make` | BA | Generate a prototype from a description + screenshots/docs |
| `/feature-mockup:extract-design` | **Dev** | Crawl the front-end source and produce a zip for the BA (auto-detects Angular/React/Vue/Next) |
| `/feature-mockup:ingest-theme` | BA | Import the dev's zip — tokens + component vocabulary |
| `/feature-mockup:preview` | BA | Open the generated prototype in a browser (auto-detects static vs vite dev server) |
| `/feature-mockup:verify` | BA | Compare the prototype against the real admin (live URL via Chrome DevTools / Playwright MCP) or user screenshots, produce a prioritized gap report |
| `/feature-mockup:fix` | BA | Apply UI + interaction fixes — from a verify report or free-form description, with theme-rule guardrails and per-batch user confirmation |

## What devs need to export (for `ingest-theme`, Phase 2)

A zip containing:
- `tailwind.config.{js,ts}` **or** `tokens.json` (Style Dictionary format)
- `globals.css` / `tokens.css` with CSS variables
- `components/` — only **presentational** components (Button, Input, Card, Badge…) — no API logic
- `_manifest.json` — list of components and their main props

Full spec: see `docs/fe-export-spec.md` (Phase 2).

## Status

- **Phase 1 (shipped):** `init`, `make`, `html-tailwind` template, `input-analyzer` + `prototype-builder` agents. Lucide icons, no emoji.
- **Phase 2 (shipped):** `ingest-theme` skill, `theme-extractor` agent, normalized tokens pipeline, component cloning with import rewriting, `docs/fe-export-spec.md`.
- **Phase 2.5 (shipped):** `extract-design` skill (dev-side), `design-extractor` agent, stack detector (Angular / React / Vue / Next.js / Nuxt / Svelte), token crawlers for Tailwind / SCSS variables / CSS variables / Style Dictionary, component classifier (presentational / business / unknown).
- **Phase 3 (shipped):** `preview` skill (browser auto-launch), `verify` skill (Chrome DevTools / Playwright MCP comparison), `fix` skill (UI + interaction fixes with theme guardrails).
- **Phase 4 (planned):** per-library knowledge expansion (Kendo / AntD / MUI / Element Plus / shadcn / TanStack Table grid families), `react-vite` template revival.

## License

MIT
