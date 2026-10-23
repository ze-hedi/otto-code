---
title: Config & types
sources:
  - agents/pi-agent-configs.ts
  - agents/pi-agent-types.ts
---

# Config & types

## Purpose

These two files define the configuration and type surface shared across the agent classes. `pi-agent-configs.ts` describes how to construct a `PiAgent` or `RawPiAgent`; `pi-agent-types.ts` defines the building-block types for tools, skills, sub-agents, and event callbacks.

## How it works

- `PiAgentConfig` is the public config interface consumed by `PiAgent`. Its fields control the model, system prompt suffix, thinking level, working directory/playground, skills, custom tools, workflow interfaces, tool guardrails, MCP servers, built-in tools, sub-agents, compaction, and session file layout.
- `RawPiAgentConfig` derives from `PiAgentConfig`: it drops `systemPromptSuffix` and adds a full `systemPrompt` override.
- `pi-agent-types.ts` provides `SkillInput`, `ToolInput`, `PersistantSubAgentToolConfig`, `SubAgentToolConfig`, and `EventCallback`.

## Key code

- `agents/pi-agent-configs.ts`
  - `PiAgentConfig` — full agent configuration, including `mcpServers`, `builtInTools`, `subAgents`, `persistantSubAgents`, `compaction`, `workflowId`, and `workflowSessionId`.
  - `RawPiAgentConfig` — `Omit<PiAgentConfig, "systemPromptSuffix">` plus a full `systemPrompt`.
- `agents/pi-agent-types.ts`
  - `SkillInput` — a named skill plus its raw markdown content.
  - `ToolInput` — a tool's name, label, description, TypeBox schema, prompt hints, execution mode, `terminate` flag, and `execute` handler.
  - `SubAgentToolConfig` — config for a volatile (stateless) sub-agent tool.
  - `PersistantSubAgentToolConfig` — config for a persistent (stateful) sub-agent tool.
  - `EventCallback` — a callback receiving the full `AgentSessionEvent` union.

## Data & config

- None of these files read or write anything; they are pure type declarations.

## Gotchas

- The `persistantSubAgents` field maps a key to a tuple `[RawPiAgentConfig, PersistantSubAgentToolConfig]` — the first element is the nested agent's own config.
- "Persistant" is misspelled throughout the codebase (e.g. `PersistantSubAgentToolConfig`, `persistantSubAgents`). Match the typo when writing config.
- `ToolInput.terminate` (when `true`) ends the agent loop after the tool runs; the `terminate` field is also returned by `PiAgent._createToolDefinition`.
- `SubAgentToolConfig` and `PersistantSubAgentToolConfig` differ only in whether the sub-agent keeps state between calls.

## Related

- [PiAgent](pi-agent.md) — consumes `PiAgentConfig`.
- [RawPiAgent](raw-pi-agent.md) — consumes `RawPiAgentConfig`.
- [Sub-agents](sub-agents.md) — consumes `SubAgentToolConfig` and `PersistantSubAgentToolConfig`.
