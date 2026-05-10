# claude-code-plugins

A personal [Claude Code](https://claude.com/claude-code) plugin marketplace — slash commands, skills, agents, and hooks I use in my own AI workflow.

## Installation

Add this repo as a marketplace, then install plugins by name:

```bash
/plugin marketplace add dongquoctien/claude-code-plugins
/plugin install <plugin-name>
```

## Plugins

_None yet — this marketplace is just getting started._

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
