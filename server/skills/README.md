# Hanzi Browse Skills

Agent skills for [Hanzi Browse](https://browse.hanzilla.co) — give your AI agent a real browser.

## Core Skill

| Skill | Description |
|-------|-------------|
| [hanzi-browse](hanzi-browse/) | Browser automation via MCP — click, type, fill forms, read authenticated pages |

## Workflow Skills

| Skill | Description |
|-------|-------------|
| [e2e-tester](e2e-tester/) | Test web apps like a QA person with real browser interactions |
| [social-poster](social-poster/) | Draft and post content across LinkedIn, Twitter/X, Reddit |
| [linkedin-prospector](linkedin-prospector/) | Find and connect with prospects on LinkedIn |
| [a11y-auditor](a11y-auditor/) | Run accessibility audits in a real browser |
| [x-marketer](x-marketer/) | Twitter/X marketing workflows |

## Installation

### Claude Code
```bash
# Copy a skill to your project
cp -r hanzi-browse/ .claude/skills/hanzi-browse/

# Or install globally
cp -r hanzi-browse/ ~/.claude/skills/hanzi-browse/
```

### Cursor
```bash
cp -r hanzi-browse/ .cursor/skills/hanzi-browse/
```

### Other agents
Copy the skill directory to your agent's skills folder. See [awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) for paths.

## Setup

The skills require the Hanzi Browse MCP server:

```bash
npx hanzi-browse setup
```

This installs the Chrome extension and configures your AI agents automatically.
