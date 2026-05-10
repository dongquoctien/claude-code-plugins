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

```bash
# 1. Set up once per project
/feature-mockup:init

# 2. Make your first prototype
/feature-mockup:make "booking-cancel-flow" ./screenshots/cancel-1.png ./refs/policy.md

# 3. (Phase 2) Import the real front-end design once devs export it
/feature-mockup:ingest-theme ./from-dev/theme-export.zip

# 4. (Phase 3) Open the result in a browser
/feature-mockup:preview "booking-cancel-flow"
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

| Skill | Status | Purpose |
|---|---|---|
| `/feature-mockup:init` | Phase 1 | Initialize `.claude/feature-mockup.json` |
| `/feature-mockup:make` | Phase 1 | Generate a prototype from inputs |
| `/feature-mockup:ingest-theme` | Phase 2 | Import the team's real FE design (tokens + components) |
| `/feature-mockup:preview` | Phase 3 | Open the generated prototype in a browser |

## What devs need to export (for `ingest-theme`, Phase 2)

A zip containing:
- `tailwind.config.{js,ts}` **or** `tokens.json` (Style Dictionary format)
- `globals.css` / `tokens.css` with CSS variables
- `components/` — only **presentational** components (Button, Input, Card, Badge…) — no API logic
- `_manifest.json` — list of components and their main props

Full spec: see `docs/fe-export-spec.md` (Phase 2).

## Status

- **Phase 1 (shipped):** `init`, `make`, `html-tailwind` template, `input-analyzer` + `prototype-builder` agents.
- **Phase 2 (shipped):** `ingest-theme` skill, `theme-extractor` agent, normalized tokens pipeline, component cloning with import rewriting, `docs/fe-export-spec.md` for devs.
- **Phase 3 (planned):** `react-vite` template, `preview` skill.

## License

MIT
