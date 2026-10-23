---
title: Agents
sources:
  - agents/**
---

# Agents

This folder holds the building blocks of the Otto agentic platform. It is organized as a set of TypeScript classes and factories around the Pi coding agent SDK: a core wrapper, a subclass with full system-prompt control, tool/sub-agent factories, an MCP client, an event-translation layer, a decision agent, a consensus meeting, a swarm orchestrator, and a graph workflow engine.

Each file is intentionally small and focused. The bigger behaviours — workflows, meetings, and swarms — are composed from the smaller pieces rather than baked into the core agent.

## Parts

- [PiAgent](pi-agent.md) — the core wrapper around the Pi coding agent SDK.
- [RawPiAgent](raw-pi-agent.md) — a subclass that builds and controls the full system prompt.
- [Config & types](config-and-types.md) — configuration interfaces and shared type definitions.
- [Sub-agents](sub-agents.md) — factories that turn sub-agent configs into tools.
- [MCP bridge](mcp-bridge.md) — a thin MCP client over Streamable HTTP.
- [Event handling](event-handling.md) — translates agent events into SSE or terminal output.
- [Workflow](workflow.md) — a graph engine for multi-agent pipelines.
- [JevAgent](jev-agent.md) — a decision model for picking one option.
- [Meeting](meeting.md) — a round-robin consensus discussion among agents.
- [Swarm](swarm.md) — coordinator-led orchestration with an MCP task manager.

## How the parts connect

`PiAgent` is the base class; `RawPiAgent` extends it and is what the higher-level features instantiate. `Workflow` builds a DAG of `RawPiAgent`s and wires them through interface nodes defined in the same file. `Meeting` and `Swarm` both drive `RawPiAgent` instances directly: `Swarm` embeds a `Meeting` and an MCP bridge. `sub-agent-pattern` produces tools that `RawPiAgent` injects into its system prompt. `mcp-bridge` is used by both `PiAgent` (for arbitrary MCP servers) and `Swarm` (for its task manager).
