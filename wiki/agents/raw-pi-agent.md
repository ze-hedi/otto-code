---
title: RawPiAgent
sources:
  - agents/raw-pi-agent.ts
---

# RawPiAgent

## Purpose

`RawPiAgent` extends `PiAgent` to take full control of the system prompt. Instead of appending a suffix to the SDK's default prompt, the caller supplies a complete `systemPrompt`, and `RawPiAgent` appends a generated "Available Tools" section describing every built-in, custom, MCP, and sub-agent tool. It also disables loading of project context files (`AGENTS.md` / `CLAUDE.md`).

## How it works

1. The constructor splits `systemPrompt` out of the config and stores it as `_baseSystemPrompt`; the rest is passed to `PiAgent`. It sets `_noContextFiles = true`.
2. If `persistantSubAgents` are configured, it instantiates a nested `RawPiAgent` for each and builds its tool via `_createPersistentSubAgentTool`.
3. On session creation, the `_createSessionWith` override appends `_buildToolsSection()` to `_baseSystemPrompt`, then delegates to the parent to create the session.
4. `_buildToolsSection()` renders sections for built-in tools, custom tools, MCP tools (connecting to all configured servers first), volatile sub-agents, and persistent sub-agents.

## Key code

- `agents/raw-pi-agent.ts`
  - `RawPiAgent` — the subclass; constructor and `fullSystemPrompt` getter.
  - `_buildToolsSection` — assembles the markdown tool listing injected into the prompt.
  - `builtInToolFactories` — maps `read`/`bash`/`edit`/`write` to their SDK `ToolDefinition` factories.
  - `_createSessionWith` — override that prepends the tools section to the system prompt.
  - `_persistentSubAgents` / `_persistentSubAgentsTool` — maps holding persistent sub-agent instances and their tools.

## Data & config

- Uses the `RawPiAgentConfig` type (see [Config & types](config-and-types.md)), which replaces `systemPromptSuffix` with a full `systemPrompt`.
- No additional files or environment variables beyond what `PiAgent` reads.

## Gotchas

- `RawPiAgent` always skips project context files (`_noContextFiles = true`), unlike the base class.
- Persistent sub-agents are built recursively (`new RawPiAgent(...)`), so they inherit the same full-control prompt behaviour.
- The `_createPersistentSubAgentTool` helper here duplicates logic that also lives in `PiAgent` and in [sub-agent-pattern](sub-agents.md).
- The `_createSessionWith` override contains commented-out code that would strip the date/cwd lines from the built prompt; it is currently disabled.

## Related

- [PiAgent](pi-agent.md) — the base class.
- [Config & types](config-and-types.md) — `RawPiAgentConfig`.
- [Sub-agents](sub-agents.md) — the `createSubAgentTool` / `createPersistentSubAgentTool` factories.
