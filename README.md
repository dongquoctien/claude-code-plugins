# claude-code-plugins

A personal [Claude Code](https://claude.com/claude-code) plugin marketplace — slash commands, skills, agents, and hooks I use in my own AI workflow.

## Installation

Add this repo as a marketplace, then install plugins by name:

```bash
/plugin marketplace add dongquoctien/claude-code-plugins
/plugin install <plugin-name>
```

## Plugins

| Plugin | Audience | Purpose |
|---|---|---|
| [`feature-mockup`](./plugins/feature-mockup) | BA / planner | Turn feature description + screenshots into a runnable HTML/React mockup, optionally themed with the team's real front-end design |
| [`angular-admin-design`](./plugins/angular-admin-design) | Dev | Spec.md or Jira task → reuse-map → scaffold Angular NgRx feature module with shared-module reuse + mock fixtures behind a one-flag InjectionToken switch |

## Repository layout

```
.claude-plugin/
  marketplace.json    # marketplace manifest (lists every plugin in this repo)
plugins/
  <plugin-name>/      # each plugin lives in its own folder
    .claude-plugin/
      plugin.json     # plugin manifest
    commands/         # slash commands (optional)
    skills/           # skills (optional)
    agents/           # subagents (optional)
    hooks/            # hooks (optional)
```

## License

MIT
