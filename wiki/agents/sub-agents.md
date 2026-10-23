---
title: Sub-agents
sources:
  - agents/sub-agent-pattern.ts
---

# Sub-agents

## Purpose

This module turns sub-agent configuration into `ToolInput`s so a parent agent can call a sub-agent like any other tool. It provides two flavours: a volatile sub-agent (a fresh, stateless `RawPiAgent` per call) and a persistent sub-agent (a single reused instance that keeps context between calls).

## How it works

1. `createSubAgentTool(config)` returns a tool whose `execute` builds a new `RawPiAgent` on every call using `config.model`, `config.systemPrompt`, `config.builtInTools`, and `config.playground`. It runs the sub-agent, reads the last assistant message as the tool result, and returns it as text. It runs in `parallel` mode and forwards the sub-agent's events through `onUpdate` so the caller can observe them.
2. `createPersistentSubAgentTool(config, agent)` reuses an already-constructed agent (`agent.chat(task)`), then reads the last assistant message as the result. It runs in `sequential` mode because it mutates a shared agent.
3. Both flatten the incoming `params` object into a `key: value` text block that becomes the sub-agent's task.

## Key code

- `agents/sub-agent-pattern.ts`
  - `createSubAgentTool` — volatile, stateless sub-agent tool.
  - `createPersistentSubAgentTool` — persistent, stateful sub-agent tool.

## Data & config

- Consumes `SubAgentToolConfig` and `PersistantSubAgentToolConfig` from [Config & types](config-and-types.md).
- No file or environment access of its own.

## Gotchas

- The volatile sub-agent uses `sessionMode: "memory"`, so nothing is persisted to disk.
- `createSubAgentTool` wraps errors as `Error: subagent didn't get launched <message>` in the tool result rather than throwing.
- `createPersistentSubAgentTool` here is essentially duplicated in `PiAgent._createPersistentSubAgentTool` and `RawPiAgent._createPersistentSubAgentTool`; the three copies can drift.
- Sub-agent events are re-emitted to the parent with `details.subagentEvent = true`, which [event handling](event-handling.md) translates into `subagent_event` SSE messages.

## Related

- [Config & types](config-and-types.md) — the sub-agent config shapes.
- [RawPiAgent](raw-pi-agent.md) — where sub-agent tools are injected into the system prompt.
- [PiAgent](pi-agent.md) — exposes `createSubAgentTool(key)` for configured sub-agents.
